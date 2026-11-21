'use strict';

const { parseCNJ } = require('./cnj');

/**
 * Modelo normalizado de processo, comum a todos os provedores.
 *
 * {
 *   numero, numeroFormatado, tribunal: {sigla, nome, segmento}, classe: {codigo, nome},
 *   assuntos: [{codigo, nome}], orgaoJulgador: {codigo, nome, municipioIBGE},
 *   graus: ['G1', ...], dataAjuizamento, ultimaAtualizacao, sistema, formato,
 *   nivelSigilo, valorCausa, situacao,
 *   partes: [{polo: 'ativo'|'passivo'|'outros', tipo, nome, documento, advogados: [{nome, oab}]}],
 *   movimentos: [{data, codigo, nome, complementos: [string], orgao, grau}],  // mais recente primeiro
 *   fontes: ['datajud', ...]
 * }
 */
function novoProcesso(numero) {
  const info = parseCNJ(numero);
  return {
    numero: info ? info.digitos : String(numero),
    numeroFormatado: info ? info.formatado : String(numero),
    tribunal: info?.tribunal
      ? { sigla: info.tribunal.sigla, nome: info.tribunal.nome, segmento: info.tribunal.segmento }
      : null,
    classe: null,
    assuntos: [],
    orgaoJulgador: null,
    graus: [],
    dataAjuizamento: null,
    ultimaAtualizacao: null,
    sistema: null,
    formato: null,
    nivelSigilo: 0,
    valorCausa: null,
    situacao: null,
    juiz: null,
    area: null,
    partes: [],
    movimentos: [],
    fontes: [],
  };
}

function ordenarMovimentos(movs) {
  return movs.sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')));
}

function chaveMovimento(m) {
  return `${(m.data || '').slice(0, 16)}|${m.codigo || ''}|${(m.nome || '').toLowerCase().slice(0, 60)}`;
}

/** Une dois processos normalizados (ex.: dados do DataJud + partes do Escavador). */
function mesclarProcessos(base, extra) {
  if (!base) return extra;
  if (!extra) return base;
  const r = { ...base };
  for (const campo of ['classe', 'orgaoJulgador', 'dataAjuizamento', 'sistema', 'formato', 'valorCausa', 'situacao', 'tribunal', 'juiz', 'area']) {
    if (!r[campo] && extra[campo]) r[campo] = extra[campo];
  }
  if (extra.ultimaAtualizacao && (!r.ultimaAtualizacao || extra.ultimaAtualizacao > r.ultimaAtualizacao)) {
    r.ultimaAtualizacao = extra.ultimaAtualizacao;
  }
  r.graus = [...new Set([...(base.graus || []), ...(extra.graus || [])])];
  const assuntos = new Map([...(base.assuntos || []), ...(extra.assuntos || [])].map((a) => [a.codigo || a.nome, a]));
  r.assuntos = [...assuntos.values()];
  if (!r.partes?.length) r.partes = extra.partes || [];
  // Fontes descrevem o mesmo andamento com textos diferentes (ex.: TPU do DataJud
  // x texto do portal do tribunal). Se as prioridades diferem, fica a lista da
  // fonte mais detalhada; se são iguais, une sem duplicar.
  const pb = base.movimentos?.length ? (base.prioridadeMovimentos ?? 1) : -1;
  const pe = extra.movimentos?.length ? (extra.prioridadeMovimentos ?? 1) : -1;
  if (pb !== pe) {
    r.movimentos = ordenarMovimentos([...((pe > pb ? extra : base).movimentos || [])]);
    r.prioridadeMovimentos = Math.max(pb, pe);
  } else {
    const movs = new Map();
    for (const m of [...(base.movimentos || []), ...(extra.movimentos || [])]) {
      if (!movs.has(chaveMovimento(m))) movs.set(chaveMovimento(m), m);
    }
    r.movimentos = ordenarMovimentos([...movs.values()]);
  }
  r.avisos = [...new Set([...(base.avisos || []), ...(extra.avisos || [])])];
  r.fontes = [...new Set([...(base.fontes || []), ...(extra.fontes || [])])];
  return r;
}

/** Resumo enxuto para listas de resultados. */
function resumo(p) {
  const ult = p.movimentos?.[0];
  return {
    numero: p.numero,
    numeroFormatado: p.numeroFormatado,
    tribunal: p.tribunal,
    classe: p.classe,
    assuntos: (p.assuntos || []).slice(0, 3),
    orgaoJulgador: p.orgaoJulgador,
    graus: p.graus,
    dataAjuizamento: p.dataAjuizamento,
    ultimaAtualizacao: p.ultimaAtualizacao,
    partes: (p.partes || []).slice(0, 4).map(({ polo, nome, tipo }) => ({ polo, nome, tipo })),
    ultimoMovimento: ult ? { data: ult.data, nome: ult.nome } : null,
    totalMovimentos: p.movimentos?.length || 0,
    fontes: p.fontes,
  };
}

module.exports = { novoProcesso, mesclarProcessos, ordenarMovimentos, resumo, chaveMovimento };
