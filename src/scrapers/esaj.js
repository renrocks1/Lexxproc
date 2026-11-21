'use strict';

/**
 * Raspador do e-SAJ (Softplan) — consulta pública de 1º grau (cpopg).
 * Usado por TJSP, TJAL, TJAM, TJMS, TJAC e TJCE.
 *
 * Fluxo:
 *  1. search.do → lista de processos (ou redireciona direto para show.do
 *     quando há um único resultado, comum na busca por número).
 *  2. show.do → capa e partes.
 *  3. carregarMovimentacoesAjax.do → movimentações (TJSP carrega sob demanda,
 *     com paginação por cursor; outros tribunais já trazem na própria página).
 *
 * Os seletores foram levantados a partir das páginas reais (nov/2026).
 */

const cheerio = require('cheerio');
const { novoProcesso, ordenarMovimentos } = require('../lib/modelo');
const { parseCNJ } = require('../lib/cnj');
const { ProviderError } = require('../lib/http');

const limpar = (s) => String(s ?? '').replace(/ /g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
const umaLinha = (s) => limpar(s).replace(/\n+/g, ' ');

/** "17/11/2026" ou "07/08/2026 às 20:00" → ISO local. */
function dataBR(texto) {
  const m = /(\d{2})\/(\d{2})\/(\d{4})(?:\D+(\d{2}):(\d{2}))?/.exec(texto || '');
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}T${m[4] || '00'}:${m[5] || '00'}:00`;
}

const ATIVO = /^(reqte|requerente|autor|autora|exeqte|exequente|imptte|impetrante|reclamante|reclte|embargte|embargante|apelante|apelte|agravante|agvte|recorrente|recorrte|denunciante|querelante|alimentando|alimentanda|demandante|promovente|suscitante|interessado ativo)/i;
const PASSIVO = /^(reqdo|reqda|requerido|requerida|réu|ré|reu|exectdo|exectda|executado|executada|imptdo|impetrado|impetrada|reclamado|reclamada|recldo|embargdo|embargado|embargada|apelado|apelada|apeldo|agravado|agravada|agvdo|recorrido|recorrida|recorrdo|denunciado|denunciada|querelado|querelada|alimentante|demandado|demandada|promovido|promovida|suscitado|averiguado|indiciado|investigado|acusado|acusada)/i;

function poloDe(tipo) {
  const t = umaLinha(tipo).replace(/[:.]$/, '');
  if (ATIVO.test(t)) return 'ativo';
  if (PASSIVO.test(t)) return 'passivo';
  return 'outros';
}

/** Identifica bloqueios por verificação humana. Não confundir com o script que sempre cita "captcha". */
function exigeCaptcha(html) {
  const $ = cheerio.load(html);
  return $([
    '.g-recaptcha', '.h-captcha', '.cf-turnstile', 'iframe[src*="recaptcha"]', 'iframe[src*="hcaptcha"]',
    'iframe[src*="challenges.cloudflare.com"]', 'script[src*="challenges.cloudflare.com/turnstile"]',
    '#captchaInfo', 'img[src*="captcha" i]', 'input[name="g-recaptcha-response"]',
  ].join(', ')).length > 0;
}

/** Mensagens de retorno do formulário de pesquisa. */
function mensagemRetorno($) {
  const texto = umaLinha($('#mensagemRetorno').text() || $('#spwTabelaMensagem').text());
  if (!texto) return null;
  if (/muitos processos/i.test(texto)) return { tipo: 'muitos', texto };
  if (/n[ãa]o exist|nenhum processo|n[ãa]o foram encontrad/i.test(texto)) return { tipo: 'vazio', texto };
  return { tipo: 'outro', texto };
}

/** Lista de resultados (search.do / trocarPagina.do). */
function parseLista(html, base) {
  const $ = cheerio.load(html);
  const msg = mensagemRetorno($);
  const itens = [];
  let foro = null;
  $('#listagemDeProcessos').find('h2.foroDosProcessos, div[id^="divProcesso"]').each((_, el) => {
    const $el = $(el);
    if ($el.is('h2')) {
      foro = umaLinha($el.text());
      return;
    }
    const $link = $el.find('a.linkProcesso').first();
    const numero = parseCNJ(umaLinha($link.text()) || umaLinha($el.find('.nuProcesso').text()));
    if (!numero) return;
    const href = $link.attr('href') ? new URL($link.attr('href'), base) : null;
    const distrib = umaLinha($el.find('.dataLocalDistribuicaoProcesso').text());
    const [, dataTxt, vara] = /^([\d/]+)\s*-\s*(.*)$/.exec(distrib) || [];
    const tipo = umaLinha($el.find('.tipoDeParticipacao').first().text()).replace(/:$/, '');
    const nome = umaLinha($el.find('.nomeParte').first().text());
    itens.push({
      numero: numero.digitos,
      codigo: href?.searchParams.get('processo.codigo') || null,
      foro: href?.searchParams.get('processo.foro') || null,
      nomeForo: foro,
      classe: umaLinha($el.find('.classeProcesso').text()) || null,
      assunto: umaLinha($el.find('.assuntoPrincipalProcesso').text()) || null,
      dataDistribuicao: dataTxt ? dataBR(dataTxt) : null,
      vara: vara || null,
      parte: nome ? { polo: poloDe(tipo), tipo: tipo || null, nome } : null,
    });
  });
  const total = Number((umaLinha($('#contadorDeProcessos').text()).match(/[\d.]+/) || ['0'])[0].replace(/\./g, '')) || itens.length;
  const proxima = $('a[title="Próxima página"]').attr('href');
  return { mensagem: msg, total, itens, proximaPagina: proxima ? new URL(proxima, base).toString() : null };
}

function parsePartes($, $tabela) {
  const partes = [];
  $tabela.find('tr').each((_, tr) => {
    const $tr = $(tr);
    const tipo = umaLinha($tr.find('.tipoDeParticipacao').text());
    const $cel = $tr.find('td.nomeParteEAdvogado');
    if (!$cel.length) return;
    // Percorre os nós: o primeiro texto é a parte; cada rótulo "Advogado:" introduz um advogado.
    let nome = '';
    const advogados = [];
    let lendoAdvogado = false;
    $cel.contents().each((__, no) => {
      if (no.type === 'text') {
        const t = umaLinha(no.data);
        if (!t) return;
        if (lendoAdvogado) advogados.push({ nome: t, oab: null });
        else nome = nome ? `${nome} ${t}` : t;
        lendoAdvogado = false;
      } else if (no.type === 'tag' && no.name === 'span') {
        lendoAdvogado = /advogad|defensor|procurador/i.test($(no).text());
      }
    });
    if (nome) partes.push({ polo: poloDe(tipo), tipo: tipo.replace(/[:.]$/, '') || null, nome, documento: null, advogados });
  });
  return partes;
}

/** Linhas de movimentação: tanto da página quanto do retorno AJAX. */
function parseMovimentacoes(html) {
  const $ = cheerio.load(html.includes('<table') ? html : `<table><tbody>${html}</tbody></table>`);
  const movs = [];
  $('tr.containerMovimentacao').each((_, tr) => {
    const $tr = $(tr);
    const data = dataBR($tr.find('.dataMovimentacao').text());
    const $desc = $tr.find('.descricaoMovimentacao').clone();
    const complemento = limpar($desc.find('span').text());
    $desc.find('span').remove();
    const nome = umaLinha($desc.text());
    if (!data && !nome) return;
    movs.push({ data, codigo: null, nome: nome || 'Movimentação', complementos: complemento ? [complemento] : [], orgao: null, grau: 'G1' });
  });
  const cursor = $('#trCursorMovimentacoes').attr('data-cursor') || $('#cursorMovimentacoesPaginado').attr('value') || null;
  const erro = umaLinha($('.mensagemErroMovimentacoes').text()) || null;
  return { movimentos: movs, cursor, erro };
}

/** Página de detalhe (show.do). */
function parseDetalhe(html, { sigla } = {}) {
  const $ = cheerio.load(html);
  const numero = parseCNJ(umaLinha($('#numeroProcesso').text()));
  if (!numero) {
    const sigilo = /segredo de justi|senha do processo/i.test($('#popupSenha').text()) && !umaLinha($('.unj-entity-header__summary__barra').text());
    return { sigiloso: sigilo, processo: null };
  }
  const p = novoProcesso(numero.digitos);
  const txt = (sel) => umaLinha($(sel).first().text()) || null;

  p.classe = txt('#classeProcesso') ? { codigo: null, nome: txt('#classeProcesso') } : null;
  const assuntos = [txt('#assuntoProcesso')];
  $('#maisDetalhes .unj-label').each((_, el) => {
    if (/outros assuntos/i.test($(el).text())) assuntos.push(...umaLinha($(el).next().text()).split(/\s*,\s*/));
  });
  p.assuntos = [...new Set(assuntos.filter(Boolean))].map((nome) => ({ codigo: null, nome }));
  const foro = txt('#foroProcesso');
  const vara = txt('#varaProcesso');
  p.orgaoJulgador = vara || foro ? { codigo: null, nome: [vara, foro].filter(Boolean).join(' - '), municipioIBGE: null } : null;
  p.juiz = txt('#juizProcesso');
  p.area = txt('#areaProcesso');
  p.dataAjuizamento = dataBR(txt('#dataHoraDistribuicaoProcesso'));
  p.valorCausa = txt('#valorAcaoProcesso')?.replace(/R\$\s+/, 'R$ ') || null;
  p.situacao = txt('#labelSituacaoProcesso');
  p.graus = ['G1'];
  p.sistema = 'e-SAJ';
  p.formato = 'Eletrônico';

  const $partes = $('#tableTodasPartes').length ? $('#tableTodasPartes') : $('#tablePartesPrincipais');
  p.partes = parsePartes($, $partes);

  const { movimentos } = parseMovimentacoes($('#tabelaTodasMovimentacoes').length
    ? $.html($('#tabelaTodasMovimentacoes'))
    : $.html($('#tabelaUltimasMovimentacoes')));
  p.movimentos = ordenarMovimentos(movimentos.map((m) => ({ ...m, orgao: vara })));
  p.ultimaAtualizacao = p.movimentos[0]?.data || null;
  p.fontes = [`raspagem:${(sigla || 'esaj').toLowerCase()}`];
  p.prioridadeMovimentos = 2;

  return {
    processo: p,
    codigo: /codigoProcesso:\s*'([^']+)'/.exec(html)?.[1] || null,
    movimentacoesSobDemanda: $('#btnExibirMovimentacoes').length > 0,
  };
}

const CAMPOS = {
  nome: 'NMPARTE',
  cpf: 'DOCPARTE',
  cnpj: 'DOCPARTE',
  oab: 'NUMOAB',
  advogado: 'NMADVOGADO',
};

function formatarDocumento(tipo, valor) {
  const d = String(valor).replace(/\D/g, '');
  if (tipo === 'cpf' && d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (tipo === 'cnpj' && d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return valor;
}

function urlPesquisa(base, tipo, valor) {
  const u = new URL(`${base}/search.do`);
  const q = u.searchParams;
  q.set('conversationId', '');
  if (tipo === 'cnj') {
    const n = parseCNJ(valor);
    q.set('cbPesquisa', 'NUMPROC');
    q.set('dadosConsulta.tipoNuProcesso', 'UNIFICADO');
    q.set('numeroDigitoAnoUnificado', `${n.sequencial}-${n.dv}.${n.ano}`);
    q.set('foroNumeroUnificado', n.origem);
    q.set('dadosConsulta.valorConsultaNuUnificado', n.formatado);
    q.set('dadosConsulta.valorConsulta', '');
  } else {
    q.set('cbPesquisa', CAMPOS[tipo]);
    q.set('dadosConsulta.valorConsulta', tipo === 'oab' ? `${valor.numero}${valor.uf}` : formatarDocumento(tipo, valor));
    if (tipo === 'nome') q.set('chNmCompleto', 'true');
  }
  q.set('cdForo', '-1');
  return u.toString();
}

/**
 * Cria o raspador para um tribunal e-SAJ.
 * @param {{sigla: string, base: string}} tribunal  ex.: { sigla: 'TJSP', base: 'https://esaj.tjsp.jus.br/cpopg' }
 * @param {() => object} novaSessao  fábrica de sessões HTTP (cliente.criarSessao)
 */
function criarRaspadorEsaj(tribunal, novaSessao, { maxPaginas = 4, maxPaginasMovimentacoes = 20 } = {}) {
  const base = tribunal.base.replace(/\/$/, '');

  async function carregarMovimentacoes(sessao, codigo) {
    const movs = [];
    let cursor = null;
    for (let i = 0; i < maxPaginasMovimentacoes; i++) {
      const u = new URL(`${base}/carregarMovimentacoesAjax.do`);
      u.searchParams.set('processo.codigo', codigo);
      if (cursor) u.searchParams.set('cursor', cursor);
      const { html } = await sessao.obter(u.toString(), { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
      const r = parseMovimentacoes(html);
      if (r.erro && !r.movimentos.length) throw new ProviderError(`${tribunal.sigla}: ${r.erro}`, { provider: 'raspagem' });
      movs.push(...r.movimentos);
      if (!r.cursor || r.cursor === cursor) break;
      cursor = r.cursor;
    }
    return movs;
  }

  async function detalhar(sessao, url) {
    const { html } = await sessao.obter(url);
    return completarDetalhe(sessao, html);
  }

  async function completarDetalhe(sessao, html) {
    const d = parseDetalhe(html, tribunal);
    if (!d.processo) {
      if (d.sigiloso) throw new ProviderError('Processo em segredo de justiça', { status: 404, provider: 'raspagem' });
      return null;
    }
    if (d.movimentacoesSobDemanda && d.codigo) {
      try {
        const movs = await carregarMovimentacoes(sessao, d.codigo);
        const vara = d.processo.orgaoJulgador?.nome?.split(' - ')[0] || null;
        d.processo.movimentos = ordenarMovimentos(movs.map((m) => ({ ...m, orgao: vara })));
        d.processo.ultimaAtualizacao = d.processo.movimentos[0]?.data || null;
      } catch (err) {
        // Mantém capa e partes mesmo sem movimentações.
        d.processo.avisos = [`Movimentações indisponíveis: ${err.message}`];
        d.processo.prioridadeMovimentos = 0;
      }
    }
    return d.processo;
  }

  return {
    sigla: tribunal.sigla,
    sistema: 'esaj',

    /** Busca e detalha um processo pelo número CNJ. */
    async buscarPorNumero(numero) {
      const sessao = novaSessao();
      const r = await sessao.obter(urlPesquisa(base, 'cnj', numero));
      if (/show\.do/.test(r.url) || /id="numeroProcesso"/.test(r.html)) return completarDetalhe(sessao, r.html);
      const lista = parseLista(r.html, r.url);
      const alvo = lista.itens.find((i) => i.numero === parseCNJ(numero).digitos) || lista.itens[0];
      if (!alvo?.codigo) return null;
      return detalhar(sessao, `${base}/show.do?processo.codigo=${encodeURIComponent(alvo.codigo)}&processo.foro=${encodeURIComponent(alvo.foro || '')}`);
    },

    /** Pesquisa por nome, documento (CPF/CNPJ) ou OAB; percorre até `maxPaginas`. */
    async pesquisar(tipo, valor) {
      const sessao = novaSessao();
      let r = await sessao.obter(urlPesquisa(base, tipo, valor));
      if (/show\.do/.test(r.url) || /id="numeroProcesso"/.test(r.html)) {
        // Resultado único: o portal abre direto o processo.
        const d = parseDetalhe(r.html, tribunal);
        if (!d.processo) return { total: 0, itens: [], truncado: false };
        const p = d.processo;
        return {
          total: 1,
          truncado: false,
          itens: [{
            numero: p.numero, classe: p.classe?.nome, assunto: p.assuntos[0]?.nome, dataDistribuicao: p.dataAjuizamento,
            vara: p.orgaoJulgador?.nome, parte: p.partes[0] ? { polo: p.partes[0].polo, tipo: p.partes[0].tipo, nome: p.partes[0].nome } : null,
          }],
        };
      }
      const itens = [];
      let total = 0;
      for (let pagina = 1; pagina <= maxPaginas; pagina++) {
        const lista = parseLista(r.html, r.url);
        if (lista.mensagem?.tipo === 'muitos') {
          throw new ProviderError(`${tribunal.sigla}: muitos processos encontrados — refine a busca (nome completo, CPF/CNPJ ou OAB).`, { status: 422, provider: 'raspagem' });
        }
        if (lista.mensagem?.tipo === 'vazio') break;
        total = lista.total;
        itens.push(...lista.itens);
        if (!lista.proximaPagina || pagina === maxPaginas) break;
        r = await sessao.obter(lista.proximaPagina);
      }
      return { total: Math.max(total, itens.length), itens, truncado: total > itens.length };
    },
  };
}

module.exports = {
  criarRaspadorEsaj, parseLista, parseDetalhe, parseMovimentacoes, exigeCaptcha, urlPesquisa, poloDe, dataBR,
};
