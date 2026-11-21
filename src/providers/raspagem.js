'use strict';

/**
 * Provedor: raspagem direta das consultas públicas dos tribunais.
 *
 * Complementa o DataJud com o que ele não oferece — partes, advogados, juiz,
 * valor da causa, situação e o texto das movimentações — e permite buscar por
 * nome, CPF/CNPJ e OAB sem depender de provedores pagos, nos tribunais com
 * raspador disponível (ver src/scrapers/registro.js).
 */

const { parseCNJ } = require('../lib/cnj');
const { novoProcesso, resumo } = require('../lib/modelo');
const { ProviderError } = require('../lib/http');
const { criarControleHosts, criarSessao } = require('../scrapers/cliente');
const { criarRaspadorEsaj, exigeCaptcha } = require('../scrapers/esaj');
const { TRIBUNAIS_RASPAGEM } = require('../scrapers/registro');
const { tribunalPorSigla } = require('../lib/tribunais');

const NOME = 'raspagem';

function criarRaspagem(config, { tribunais = TRIBUNAIS_RASPAGEM, fetchSessao } = {}) {
  const cfg = config.raspagem;
  const permitidos = cfg.tribunais?.length ? new Set(cfg.tribunais.map((s) => s.toUpperCase())) : null;
  const ativos = tribunais.filter((t) => !permitidos || permitidos.has(t.sigla));

  const controle = criarControleHosts({ intervaloMinimoMs: cfg.intervaloMs, pausaMinutos: cfg.pausaMinutos });
  const novaSessao = fetchSessao || (() => criarSessao({
    controle,
    userAgent: cfg.userAgent,
    timeoutMs: config.requestTimeoutMs,
    esperaBaseMs: cfg.esperaBaseMs ?? 1000,
    detectarCaptcha: exigeCaptcha,
  }));

  const raspadores = new Map(ativos.map((t) => [t.sigla, criarRaspadorEsaj(t, novaSessao, {
    maxPaginas: cfg.maxPaginas, maxPaginasMovimentacoes: cfg.maxPaginasMovimentacoes,
  })]));

  /** Converte um item da lista de resultados no resumo padrão. */
  function itemParaResumo(sigla, item) {
    const p = novoProcesso(item.numero);
    if (!p.tribunal) {
      const t = tribunalPorSigla(sigla);
      p.tribunal = t ? { sigla: t.sigla, nome: t.nome, segmento: t.segmento } : { sigla, nome: sigla, segmento: null };
    }
    p.classe = item.classe ? { codigo: null, nome: item.classe } : null;
    p.assuntos = item.assunto ? [{ codigo: null, nome: item.assunto }] : [];
    p.orgaoJulgador = item.vara || item.nomeForo ? { codigo: null, nome: [item.vara, item.nomeForo].filter(Boolean).join(' - ') } : null;
    p.dataAjuizamento = item.dataDistribuicao;
    p.graus = ['G1'];
    p.partes = item.parte ? [{ ...item.parte, documento: null, advogados: [] }] : [];
    p.fontes = [`${NOME}:${sigla.toLowerCase()}`];
    return resumo(p);
  }

  async function pesquisarEmTodos(tipo, valor, opcoes = {}) {
    const filtro = opcoes.tribunais?.length ? new Set(opcoes.tribunais.map((s) => s.toUpperCase())) : null;
    const alvos = [...raspadores.values()].filter((r) => !filtro || filtro.has(r.sigla));
    if (!alvos.length) return { total: 0, resultados: [], proximoCursor: null, erros: [], avisos: [] };

    const respostas = await Promise.allSettled(alvos.map((r) => r.pesquisar(tipo, valor)));
    const resultados = [];
    const erros = [];
    const avisos = [];
    respostas.forEach((resp, i) => {
      const sigla = alvos[i].sigla;
      if (resp.status === 'rejected') {
        erros.push({ provedor: `${NOME}:${sigla}`, mensagem: resp.reason?.message || String(resp.reason) });
        return;
      }
      resultados.push(...resp.value.itens.map((it) => itemParaResumo(sigla, it)));
      if (resp.value.truncado) {
        avisos.push(`${sigla}: exibindo ${resp.value.itens.length} de ${resp.value.total} processos — refine a busca para ver os demais`);
      }
    });
    if (!resultados.length && erros.length === alvos.length) {
      const primeiro = respostas.find((r) => r.status === 'rejected').reason;
      throw new ProviderError(erros.map((e) => `${e.provedor}: ${e.mensagem}`).join('; '), { status: primeiro?.status || 502, provider: NOME });
    }
    return { total: resultados.length, resultados, proximoCursor: null, erros, avisos };
  }

  return {
    nome: NOME,
    rotulo: 'Raspagem dos tribunais',
    habilitado: cfg.enabled && raspadores.size > 0,
    suporta: ['cnj', 'nome', 'cpf', 'cnpj', 'oab'],
    tribunais: ativos.map(({ sigla, sistema, base, verificado }) => ({ sigla, sistema, portal: base, verificado })),
    estadoHosts: () => controle.estado(),

    async buscarPorNumero(numero) {
      const info = parseCNJ(numero);
      const raspador = info?.tribunal && raspadores.get(info.tribunal.sigla);
      if (!raspador) throw new ProviderError('Tribunal sem raspador disponível', { status: 404, provider: NOME });
      return raspador.buscarPorNumero(info.digitos);
    },
    buscarPorNome: (nome, opcoes) => pesquisarEmTodos('nome', nome, opcoes),
    buscarPorDocumento: (doc, opcoes) => pesquisarEmTodos(doc.length === 14 ? 'cnpj' : 'cpf', doc, opcoes),
    buscarPorOAB: (oab, opcoes) => pesquisarEmTodos('oab', oab, opcoes),
  };
}

module.exports = { criarRaspagem };
