'use strict';

/**
 * Provedor: API Pública do DataJud (CNJ).
 * Documentação: https://datajud-wiki.cnj.jus.br/api-publica/
 *
 * Fonte oficial e gratuita com metadados e movimentações de processos de
 * praticamente todos os tribunais do país (exceto STF). Não expõe partes nem
 * processos em segredo de justiça — por isso a busca por nome/CPF/OAB é
 * delegada a provedores comerciais (Escavador, Judit).
 */

const { parseCNJ } = require('../lib/cnj');
const { tribunalPorSigla } = require('../lib/tribunais');
const { novoProcesso, mesclarProcessos, ordenarMovimentos, resumo } = require('../lib/modelo');
const { requestJSON, ProviderError } = require('../lib/http');

const NOME = 'datajud';
const GRAUS = {
  G1: '1º Grau', G2: '2º Grau', JE: 'Juizado Especial', TR: 'Turma Recursal', TRU: 'Turma Regional de Uniformização',
  TNU: 'Turma Nacional de Uniformização', SUP: 'Tribunal Superior', CJF: 'Conselho da Justiça Federal',
};

/** Converte datas do DataJud ("20180502000000", "2018-05-02T00:00:00.000Z") em ISO. */
function dataISO(v) {
  if (!v) return null;
  const s = String(v);
  if (/^\d{14}$/.test(s)) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}`;
  }
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T00:00:00`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().replace('.000Z', 'Z');
}

/** Normaliza um documento (_source) do DataJud. */
function normalizarHit(src) {
  const p = novoProcesso(src.numeroProcesso);
  const trib = tribunalPorSigla(src.tribunal);
  if (trib) p.tribunal = { sigla: trib.sigla, nome: trib.nome, segmento: trib.segmento };
  else if (!p.tribunal && src.tribunal) p.tribunal = { sigla: src.tribunal, nome: src.tribunal, segmento: null };

  p.classe = src.classe ? { codigo: src.classe.codigo, nome: src.classe.nome } : null;
  p.assuntos = (src.assuntos || []).flat().filter(Boolean).map((a) => ({ codigo: a.codigo, nome: a.nome }));
  p.orgaoJulgador = src.orgaoJulgador
    ? { codigo: src.orgaoJulgador.codigo, nome: src.orgaoJulgador.nome, municipioIBGE: src.orgaoJulgador.codigoMunicipioIBGE }
    : null;
  p.graus = src.grau ? [src.grau] : [];
  p.dataAjuizamento = dataISO(src.dataAjuizamento);
  p.ultimaAtualizacao = dataISO(src.dataHoraUltimaAtualizacao || src['@timestamp']);
  p.sistema = src.sistema?.nome || null;
  p.formato = src.formato?.nome || null;
  p.nivelSigilo = src.nivelSigilo || 0;
  p.movimentos = ordenarMovimentos((src.movimentos || []).map((m) => ({
    data: dataISO(m.dataHora),
    codigo: m.codigo ?? null,
    nome: m.nome || 'Movimento',
    complementos: (m.complementosTabelados || []).map((c) =>
      [c.nome, c.descricao && c.descricao !== c.nome ? c.descricao.replace(/_/g, ' ') : null].filter(Boolean).join(': ')),
    orgao: m.orgaoJulgador?.nomeOrgao || m.orgaoJulgador?.nome || null,
    grau: src.grau || null,
  })));
  p.fontes = [NOME];
  return p;
}

function criarDataJud(config) {
  const cfg = config.datajud;

  async function pesquisar(alias, corpo) {
    if (!alias) throw new ProviderError('Tribunal não disponível no DataJud (ex.: STF)', { status: 404, provider: NOME });
    const url = `${cfg.baseUrl.replace(/\/$/, '')}/${alias}/_search`;
    return requestJSON(url, {
      method: 'POST',
      headers: { Authorization: `APIKey ${cfg.apiKey}` },
      body: corpo,
      timeoutMs: config.requestTimeoutMs,
      provider: 'DataJud',
    });
  }

  return {
    nome: NOME,
    rotulo: 'DataJud (CNJ)',
    habilitado: cfg.enabled,
    suporta: ['cnj', 'avancada'],

    /** Busca um processo pelo número CNJ; une os registros de cada grau. */
    async buscarPorNumero(numero) {
      const info = parseCNJ(numero);
      if (!info) throw new ProviderError('Número de processo inválido', { status: 400, provider: NOME });
      const dados = await pesquisar(info.tribunal?.alias, {
        size: 10,
        query: { match: { numeroProcesso: info.digitos } },
      });
      const hits = dados?.hits?.hits || [];
      if (!hits.length) return null;
      return hits.map((h) => normalizarHit(h._source)).reduce((acc, p) => mesclarProcessos(acc, p), null);
    },

    /**
     * Busca avançada por metadados em um tribunal: classe, órgão julgador,
     * assunto, grau e período de ajuizamento. Paginação via search_after.
     */
    async buscaAvancada({ tribunal, classeCodigo, orgaoCodigo, assuntoCodigo, grau, dataInicio, dataFim, tamanho = 20, cursor }) {
      const t = tribunalPorSigla(tribunal);
      if (!t) throw new ProviderError('Tribunal inválido', { status: 400, provider: NOME });
      const must = [];
      if (classeCodigo) must.push({ match: { 'classe.codigo': Number(classeCodigo) } });
      if (orgaoCodigo) must.push({ match: { 'orgaoJulgador.codigo': Number(orgaoCodigo) } });
      if (assuntoCodigo) must.push({ match: { 'assuntos.codigo': Number(assuntoCodigo) } });
      if (grau) must.push({ match: { grau } });
      if (dataInicio || dataFim) {
        must.push({ range: { dataAjuizamento: { ...(dataInicio ? { gte: dataInicio } : {}), ...(dataFim ? { lte: dataFim } : {}) } } });
      }
      const corpo = {
        size: Math.min(Number(tamanho) || 20, 100),
        query: must.length ? { bool: { must } } : { match_all: {} },
        sort: [{ '@timestamp': { order: 'desc' } }],
        _source: { excludes: ['movimentos'] },
      };
      if (cursor) corpo.search_after = JSON.parse(Buffer.from(cursor, 'base64url').toString());
      const dados = await pesquisar(t.alias, corpo);
      const hits = dados?.hits?.hits || [];
      const ultimo = hits[hits.length - 1];
      return {
        total: dados?.hits?.total?.value ?? hits.length,
        resultados: hits.map((h) => resumo(normalizarHit(h._source))),
        proximoCursor: hits.length === corpo.size && ultimo?.sort
          ? Buffer.from(JSON.stringify(ultimo.sort)).toString('base64url') : null,
      };
    },
  };
}

module.exports = { criarDataJud, normalizarHit, dataISO, GRAUS };
