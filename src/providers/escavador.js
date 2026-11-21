'use strict';

/**
 * Provedor: API v2 do Escavador (pago, requer token).
 * Documentação: https://api.escavador.com/v2/docs
 *
 * Usado para busca por nome, CPF/CNPJ e OAB, e para enriquecer processos
 * com partes e advogados.
 */

const { novoProcesso, ordenarMovimentos, resumo } = require('../lib/modelo');
const { requestJSON } = require('../lib/http');
const { dataISO } = require('./datajud');

const NOME = 'escavador';

function polo(p) {
  const v = String(p || '').toUpperCase();
  if (v.includes('ATIVO')) return 'ativo';
  if (v.includes('PASSIVO')) return 'passivo';
  return 'outros';
}

/** Normaliza um processo da API do Escavador para o modelo comum. */
function normalizar(item, movimentacoes = []) {
  const p = novoProcesso(item.numero_cnj);
  const fontes = item.fontes || [];
  const principal = fontes.find((f) => f.tipo === 'TRIBUNAL') || fontes[0] || {};
  const capa = principal.capa || {};

  if (!p.tribunal && principal.tribunal) {
    p.tribunal = { sigla: principal.tribunal.sigla, nome: principal.tribunal.nome, segmento: principal.tribunal.categoria || null };
  }
  p.classe = capa.classe ? { codigo: null, nome: capa.classe } : null;
  p.assuntos = (capa.assuntos_normalizados || []).map((a) => ({ codigo: a.id || null, nome: a.nome || a.nome_com_pai }))
    .concat(capa.assunto && !capa.assuntos_normalizados?.length ? [{ codigo: null, nome: capa.assunto }] : []);
  p.orgaoJulgador = capa.orgao_julgador ? { codigo: null, nome: capa.orgao_julgador } : null;
  p.graus = [...new Set(fontes.map((f) => f.grau_formatado || f.grau).filter(Boolean).map(String))];
  p.dataAjuizamento = dataISO(capa.data_distribuicao || item.data_inicio);
  p.ultimaAtualizacao = dataISO(item.data_ultima_movimentacao);
  p.sistema = principal.sistema || null;
  p.valorCausa = capa.valor_causa?.valor_formatado || null;
  p.situacao = principal.arquivado ? 'Arquivado' : capa.situacao || null;
  p.nivelSigilo = principal.segredo_justica ? 1 : 0;

  const vistos = new Set();
  for (const f of fontes) {
    for (const e of f.envolvidos || []) {
      const chave = `${e.nome}|${e.polo}`;
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      p.partes.push({
        polo: polo(e.polo),
        tipo: e.tipo_normalizado || e.tipo || null,
        nome: e.nome,
        documento: e.cpf || e.cnpj || null,
        advogados: (e.advogados || []).map((a) => ({
          nome: a.nome,
          oab: (a.oabs || []).map((o) => `${o.numero}/${o.uf}`).join(', ') || null,
        })),
      });
    }
  }
  if (!p.partes.length) {
    if (item.titulo_polo_ativo) p.partes.push({ polo: 'ativo', tipo: null, nome: item.titulo_polo_ativo, documento: null, advogados: [] });
    if (item.titulo_polo_passivo) p.partes.push({ polo: 'passivo', tipo: null, nome: item.titulo_polo_passivo, documento: null, advogados: [] });
  }
  p.movimentos = ordenarMovimentos(movimentacoes.map((m) => ({
    data: dataISO(m.data),
    codigo: null,
    nome: m.conteudo || m.tipo || 'Movimentação',
    complementos: [],
    orgao: m.fonte?.nome || null,
    grau: m.fonte?.grau_formatado || null,
  })));
  p.fontes = [NOME];
  return p;
}

function criarEscavador(config) {
  const cfg = config.escavador;
  const get = (caminho, params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''));
    return requestJSON(`${cfg.baseUrl.replace(/\/$/, '')}${caminho}${qs.size ? `?${qs}` : ''}`, {
      headers: { Authorization: `Bearer ${cfg.token}`, 'X-Requested-With': 'XMLHttpRequest' },
      timeoutMs: config.requestTimeoutMs,
      provider: 'Escavador',
    });
  };

  const listar = async (caminho, params) => {
    const dados = await get(caminho, params);
    const itens = (dados?.items || []).map((i) => resumo(normalizar(i)));
    return { total: itens.length, resultados: itens, proximoCursor: dados?.links?.next ? encodeURIComponent(dados.links.next) : null };
  };

  return {
    nome: NOME,
    rotulo: 'Escavador',
    habilitado: Boolean(cfg.token),
    suporta: ['cnj', 'nome', 'cpf', 'cnpj', 'oab'],

    async buscarPorNumero(numero) {
      let item;
      try {
        item = await get(`/processos/numero_cnj/${numero}`);
      } catch (err) {
        if (err.status === 404) return null;
        throw err;
      }
      let movs = [];
      try {
        movs = (await get(`/processos/numero_cnj/${numero}/movimentacoes`, { limit: 100 }))?.items || [];
      } catch { /* movimentações são opcionais */ }
      return normalizar(item, movs);
    },
    buscarPorNome: (nome) => listar('/envolvido/processos', { nome }),
    buscarPorDocumento: (doc) => listar('/envolvido/processos', { cpf_cnpj: doc }),
    buscarPorOAB: ({ numero, uf }) => listar('/advogado/processos', { oab_numero: numero, oab_estado: uf }),
  };
}

module.exports = { criarEscavador, normalizar };
