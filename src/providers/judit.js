'use strict';

/**
 * Provedor: API da Judit (pago, requer api-key).
 * Documentação: https://docs.judit.io
 *
 * A Judit trabalha de forma assíncrona: cria-se uma requisição (POST /requests)
 * e consulta-se o resultado (GET /responses) até que o status seja "completed".
 */

const { novoProcesso, ordenarMovimentos, resumo } = require('../lib/modelo');
const { requestJSON, ProviderError } = require('../lib/http');
const { dataISO } = require('./datajud');

const NOME = 'judit';
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

function polo(side) {
  const v = String(side || '').toLowerCase();
  if (v.startsWith('active') || v.includes('ativo')) return 'ativo';
  if (v.startsWith('passive') || v.includes('passivo')) return 'passivo';
  return 'outros';
}

function normalizar(d) {
  const p = novoProcesso(d.code);
  if (!p.tribunal && d.tribunal_acronym) p.tribunal = { sigla: d.tribunal_acronym, nome: d.tribunal_acronym, segmento: d.justice_description || null };
  const cls = d.classifications?.[0];
  p.classe = cls ? { codigo: Number(cls.code) || null, nome: cls.name } : null;
  p.assuntos = (d.subjects || []).map((s) => ({ codigo: Number(s.code) || null, nome: s.name }));
  const corte = d.courts?.[0];
  p.orgaoJulgador = corte ? { codigo: Number(corte.code) || null, nome: corte.name } : null;
  p.graus = d.instance ? [`${d.instance}º Grau`] : [];
  p.dataAjuizamento = dataISO(d.distribution_date);
  p.ultimaAtualizacao = dataISO(d.last_step?.step_date || d.updated_at);
  p.valorCausa = typeof d.amount === 'number'
    ? d.amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : null;
  p.situacao = d.situation || d.status || null;
  p.nivelSigilo = d.secrecy_level || 0;
  p.partes = (d.parties || []).map((pt) => ({
    polo: polo(pt.side),
    tipo: pt.person_type || null,
    nome: pt.name,
    documento: pt.main_document || null,
    advogados: (pt.lawyers || []).map((l) => ({
      nome: l.name,
      oab: (l.documents || []).filter((x) => /oab/i.test(x.document_type)).map((x) => x.document).join(', ') || null,
    })),
  }));
  p.movimentos = ordenarMovimentos((d.steps || []).map((s) => ({
    data: dataISO(s.step_date),
    codigo: Number(s.step_type) || null,
    nome: s.content || 'Movimentação',
    complementos: [],
    orgao: null,
    grau: d.instance ? `${d.instance}º Grau` : null,
  })));
  p.fontes = [NOME];
  return p;
}

function criarJudit(config) {
  const cfg = config.judit;
  const base = cfg.baseUrl.replace(/\/$/, '');
  const headers = { 'api-key': cfg.apiKey };
  const opts = { headers, timeoutMs: config.requestTimeoutMs, provider: 'Judit' };

  async function consultar(searchType, searchKey) {
    const req = await requestJSON(`${base}/requests`, {
      ...opts, method: 'POST', body: { search: { search_type: searchType, search_key: searchKey } },
    });
    const id = req?.request_id;
    if (!id) throw new ProviderError('Judit não retornou request_id', { provider: NOME });

    for (let i = 0; i < cfg.pollMaxAttempts; i++) {
      await espera(cfg.pollIntervalMs);
      const st = await requestJSON(`${base}/requests/${id}`, opts);
      if (st?.status === 'completed') break;
      if (i === cfg.pollMaxAttempts - 1) throw new ProviderError('Judit: consulta ainda em processamento, tente novamente', { status: 504, provider: NOME });
    }
    const resp = await requestJSON(`${base}/responses?request_id=${id}&page=1&page_size=100`, opts);
    return (resp?.page_data || [])
      .filter((r) => r.response_type === 'lawsuit' && r.response_data?.code)
      .map((r) => normalizar(r.response_data));
  }

  const listar = async (tipo, chave) => {
    const procs = await consultar(tipo, chave);
    return { total: procs.length, resultados: procs.map(resumo), proximoCursor: null };
  };

  return {
    nome: NOME,
    rotulo: 'Judit',
    habilitado: Boolean(cfg.apiKey),
    suporta: ['cnj', 'nome', 'cpf', 'cnpj', 'oab'],
    async buscarPorNumero(numero) {
      const procs = await consultar('lawsuit_cnj', numero);
      return procs[0] || null;
    },
    buscarPorNome: (nome) => listar('name', nome),
    buscarPorDocumento: (doc) => listar(doc.length === 14 ? 'cnpj' : 'cpf', doc),
    buscarPorOAB: ({ numero, uf }) => listar('oab', `${numero}${uf}`),
  };
}

module.exports = { criarJudit, normalizar };
