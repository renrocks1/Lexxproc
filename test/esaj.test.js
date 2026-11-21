'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  parseLista, parseDetalhe, parseMovimentacoes, exigeCaptcha, urlPesquisa, poloDe, dataBR, criarRaspadorEsaj,
} = require('../src/scrapers/esaj');
const { criarControleHosts, criarSessao, CaptchaError, HostPausadoError } = require('../src/scrapers/cliente');
const { portalSimulado } = require('./helpers/portal');

const fx = (nome) => fs.readFileSync(path.join(__dirname, 'fixtures', 'esaj', nome), 'utf8');
const BASE = 'https://esaj.tjsp.jus.br/cpopg';

// ------------------------------------------------------------ parsers

test('parseLista extrai processos, foros, partes e paginação', () => {
  const r = parseLista(fx('lista.html'), `${BASE}/search.do`);
  assert.equal(r.total, 32);
  assert.equal(r.itens.length, 3);
  const [a, , c] = r.itens;
  assert.equal(a.numero, '10000019520268260053');
  assert.equal(a.codigo, '1H0011FPM0000');
  assert.equal(a.foro, '53');
  assert.equal(a.nomeForo, 'Foro Central - Fazenda Pública/Acidentes');
  assert.equal(a.classe, 'Produção Antecipada da Prova');
  assert.equal(a.vara, '15ª Vara da Fazenda Pública');
  assert.equal(a.dataDistribuicao, '2026-08-25T00:00:00');
  assert.deepEqual(a.parte, { polo: 'ativo', tipo: 'Reqte', nome: 'EMPRESA EXEMPLO DE COMUNICAÇÃO S.A.' });
  assert.equal(c.nomeForo, 'Foro de Guarulhos');
  assert.equal(c.parte.polo, 'passivo');
  assert.match(r.proximaPagina, /^https:\/\/esaj\.tjsp\.jus\.br\/cpopg\/trocarPagina\.do\?paginaConsulta=2/);
});

test('parseLista reconhece "muitos processos" e lista vazia', () => {
  assert.equal(parseLista(fx('lista-muitos.html'), BASE).mensagem.tipo, 'muitos');
  const vazia = parseLista(fx('lista-vazia.html'), BASE);
  assert.equal(vazia.mensagem.tipo, 'vazio');
  assert.equal(vazia.itens.length, 0);
});

test('parseDetalhe (TJSP) extrai capa e partes com advogados', () => {
  const d = parseDetalhe(fx('detalhe-tjsp.html'), { sigla: 'TJSP' });
  const p = d.processo;
  assert.equal(p.numeroFormatado, '1000002-70.2025.8.26.0100');
  assert.equal(p.tribunal.sigla, 'TJSP');
  assert.equal(p.classe.nome, 'Mandado de Segurança Cível');
  assert.deepEqual(p.assuntos.map((a) => a.nome), ['Licitações', 'Atos Administrativos']);
  assert.equal(p.orgaoJulgador.nome, '3ª Vara de Fazenda Pública - Foro Central - Fazenda Pública/Acidentes');
  assert.equal(p.juiz, 'JUIZ FICTÍCIO DE TAL');
  assert.equal(p.area, 'Cível');
  assert.equal(p.valorCausa, 'R$ 1.621,00');
  assert.equal(p.situacao, 'Em grau de recurso');
  assert.equal(p.dataAjuizamento, '2025-08-03T02:04:00');
  assert.equal(p.partes.length, 3, 'usa a tabela com todas as partes');
  assert.deepEqual(p.partes[1], {
    polo: 'passivo', tipo: 'Imptdo', nome: 'EMPRESA EXEMPLO DE COMUNICAÇÃO S.A.', documento: null,
    advogados: [{ nome: 'Advogada Fictícia Dois', oab: null }, { nome: 'Advogado Fictício Três', oab: null }],
  });
  assert.equal(p.partes[2].polo, 'outros');
  assert.equal(d.movimentacoesSobDemanda, true);
  assert.equal(d.codigo, '1H00112CM0000');
  assert.deepEqual(p.fontes, ['raspagem:tjsp']);
});

test('parseDetalhe (TJAL) lê movimentações da própria página', () => {
  const { processo: p, movimentacoesSobDemanda } = parseDetalhe(fx('detalhe-tjal.html'), { sigla: 'TJAL' });
  assert.equal(movimentacoesSobDemanda, false);
  assert.equal(p.movimentos.length, 3, 'usa a lista completa, não só as últimas');
  assert.equal(p.movimentos[0].nome, 'Ato Publicado');
  assert.equal(p.movimentos[0].complementos[0], 'Relação: 0535/2026\nData da Publicação: 18/11/2026');
  assert.equal(p.movimentos[1].nome, 'Ato ordinatório praticado', 'texto dentro de link');
  assert.deepEqual(p.movimentos[2].complementos, [], 'complemento vazio é ignorado');
  assert.equal(p.ultimaAtualizacao, '2026-11-17T00:00:00');
  assert.equal(p.partes[0].advogados[0].nome, 'Advogada Fictícia Quatro');
  assert.equal(p.partes[1].polo, 'passivo');
});

test('parseMovimentacoes lida com bloco inicial e linhas soltas (AJAX)', () => {
  const p1 = parseMovimentacoes(fx('movs-ajax-1.html'));
  assert.equal(p1.movimentos.length, 2);
  assert.equal(p1.movimentos[1].nome, 'Sentença Registrada');
  assert.match(p1.movimentos[1].complementos[0], /DENEGO A SEGURANÇA/);
  assert.equal(p1.cursor, 'Y3Vyc29yLTI');
  const p2 = parseMovimentacoes(fx('movs-ajax-2.html'));
  assert.equal(p2.movimentos.length, 2);
  assert.equal(p2.cursor, null);
});

test('detecção de CAPTCHA não dispara com o script padrão da página', () => {
  assert.equal(exigeCaptcha(fx('captcha.html')), true);
  assert.equal(exigeCaptcha(fx('turnstile.html')), true, 'Cloudflare Turnstile (eproc do TJSP)');
  assert.equal(exigeCaptcha(fx('detalhe-tjsp.html')), false);
});

test('auxiliares: polos, datas e URLs de pesquisa', () => {
  assert.equal(poloDe('Reqte:'), 'ativo');
  assert.equal(poloDe('Exectdo'), 'passivo');
  assert.equal(poloDe('Terceiro'), 'outros');
  assert.equal(dataBR('07/08/2026 às 20:00 - Sorteio'), '2026-08-07T20:00:00');
  const u = new URL(urlPesquisa(BASE, 'cnj', '10000027020258260100'));
  assert.equal(u.searchParams.get('cbPesquisa'), 'NUMPROC');
  assert.equal(u.searchParams.get('numeroDigitoAnoUnificado'), '1000002-70.2025');
  assert.equal(u.searchParams.get('foroNumeroUnificado'), '0100');
  assert.equal(new URL(urlPesquisa(BASE, 'oab', { numero: '123456', uf: 'SP' })).searchParams.get('dadosConsulta.valorConsulta'), '123456SP');
  assert.equal(new URL(urlPesquisa(BASE, 'cpf', '52998224725')).searchParams.get('dadosConsulta.valorConsulta'), '529.982.247-25');
  assert.equal(new URL(urlPesquisa(BASE, 'nome', 'Fulano de Tal')).searchParams.get('chNmCompleto'), 'true');
});

// ------------------------------------------------------------ fluxo com portal simulado

function montar(base, opcoes = {}) {
  const controle = criarControleHosts({ intervaloMinimoMs: 0, pausaMinutos: 30 });
  const novaSessao = () => criarSessao({ controle, userAgent: 'teste', tentativas: 1, esperaBaseMs: 1, detectarCaptcha: exigeCaptcha });
  return { controle, raspador: criarRaspadorEsaj({ sigla: 'TJSP', base }, novaSessao, opcoes) };
}

test('busca por número: segue redirecionamento, mantém sessão e pagina movimentações', async (t) => {
  const portal = await portalSimulado();
  t.after(() => portal.server.close());
  const { raspador } = montar(portal.base);
  const p = await raspador.buscarPorNumero('10000027020258260100');
  assert.equal(p.numeroFormatado, '1000002-70.2025.8.26.0100');
  assert.equal(p.movimentos.length, 4, 'duas páginas de movimentações');
  assert.equal(p.movimentos[0].nome, 'Remetidos os Autos para o Tribunal de Justiça/Colégio Recursal - Processo Digital');
  assert.equal(p.movimentos[0].orgao, '3ª Vara de Fazenda Pública');
  assert.equal(p.movimentos.at(-1).data, '2025-08-03T00:00:00');
  assert.equal(p.prioridadeMovimentos, 2);
  assert.ok(portal.log.some((l) => l.includes('cursor=Y3Vyc29yLTI')));
});

test('sem sessão válida, mantém capa e partes e avisa sobre movimentações', async (t) => {
  const portal = await portalSimulado();
  t.after(() => portal.server.close());
  const controle = criarControleHosts({ intervaloMinimoMs: 0, pausaMinutos: 30 });
  // Sessão que "perde" cookies: nova sessão a cada requisição.
  const sessaoSemCookies = () => ({
    obter: (url, o) => criarSessao({ controle, userAgent: 't', tentativas: 1, esperaBaseMs: 1 }).obter(url, o),
  });
  const r = criarRaspadorEsaj({ sigla: 'TJSP', base: portal.base }, sessaoSemCookies);
  const p = await r.buscarPorNumero('10000027020258260100');
  assert.equal(p.partes.length, 3);
  assert.equal(p.movimentos.length, 0);
  assert.match(p.avisos[0], /Movimentações indisponíveis/);
  assert.equal(p.prioridadeMovimentos, 0, 'não sobrepõe movimentações de outra fonte');
});

test('pesquisa por nome percorre páginas até o limite', async (t) => {
  const portal = await portalSimulado();
  t.after(() => portal.server.close());
  const { raspador } = montar(portal.base, { maxPaginas: 2 });
  const r = await raspador.pesquisar('nome', 'Empresa Exemplo');
  assert.equal(r.itens.length, 6, '3 por página x 2 páginas');
  assert.equal(r.total, 32);
  assert.equal(r.truncado, true);
  const vazio = await raspador.pesquisar('nome', 'Ninguem');
  assert.equal(vazio.itens.length, 0);
  await assert.rejects(raspador.pesquisar('nome', 'Muitos'), /refine a busca/);
});

test('CAPTCHA pausa o host e não é contornado', async (t) => {
  const portal = await portalSimulado({ captcha: true });
  t.after(() => portal.server.close());
  const { raspador, controle } = montar(portal.base);
  await assert.rejects(raspador.pesquisar('nome', 'Empresa Exemplo'), CaptchaError);
  const total = portal.log.length;
  await assert.rejects(raspador.pesquisar('nome', 'Empresa Exemplo'), HostPausadoError);
  assert.equal(portal.log.length, total, 'nenhuma nova requisição enquanto pausado');
  assert.ok(controle.estado()[0].pausadoAte);
  assert.equal(controle.estado()[0].motivo, 'CAPTCHA');
});

test('ritmo mínimo entre requisições ao mesmo host', async () => {
  const controle = criarControleHosts({ intervaloMinimoMs: 80, pausaMinutos: 1 });
  const marcas = [];
  await Promise.all([1, 2, 3].map(() => controle.agendar('h', async () => marcas.push(Date.now()))));
  assert.ok(marcas[1] - marcas[0] >= 75 && marcas[2] - marcas[1] >= 75, `intervalos: ${marcas[1] - marcas[0]}, ${marcas[2] - marcas[1]}`);
});
