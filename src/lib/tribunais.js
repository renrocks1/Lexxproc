'use strict';

/**
 * Mapa de tribunais segundo a Resolução CNJ nº 65/2008 (numeração única)
 * e os aliases (índices) da API Pública do DataJud.
 *
 * Segmento J (justiça):
 *  1 STF | 2 CNJ | 3 STJ | 4 Justiça Federal | 5 Justiça do Trabalho
 *  6 Justiça Eleitoral | 7 Justiça Militar da União | 8 Justiça Estadual
 *  9 Justiça Militar Estadual
 */

// Códigos TR da Justiça Estadual / Eleitoral (ordem alfabética das UFs)
const UFS = [
  null, 'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SE', 'SP', 'TO',
];

const UF_NOMES = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará',
  DF: 'Distrito Federal e Territórios', ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão',
  MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba',
  PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte',
  RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina', SE: 'Sergipe',
  SP: 'São Paulo', TO: 'Tocantins',
};

const SEGMENTOS = {
  1: 'Supremo Tribunal Federal',
  2: 'Conselho Nacional de Justiça',
  3: 'Superior Tribunal de Justiça',
  4: 'Justiça Federal',
  5: 'Justiça do Trabalho',
  6: 'Justiça Eleitoral',
  7: 'Justiça Militar da União',
  8: 'Justiça Estadual',
  9: 'Justiça Militar Estadual',
};

/** Lista completa de tribunais com alias do DataJud. */
function buildLista() {
  const lista = [];
  const add = (sigla, nome, segmento, j, tr, alias) =>
    lista.push({ sigla, nome, segmento, j, tr, alias: alias ? `api_publica_${alias}` : null });

  add('STF', 'Supremo Tribunal Federal', SEGMENTOS[1], 1, '00', null);
  add('STJ', 'Superior Tribunal de Justiça', 'Tribunais Superiores', 3, '00', 'stj');
  add('TST', 'Tribunal Superior do Trabalho', 'Tribunais Superiores', 5, '00', 'tst');
  add('TSE', 'Tribunal Superior Eleitoral', 'Tribunais Superiores', 6, '00', 'tse');
  add('STM', 'Superior Tribunal Militar', 'Tribunais Superiores', 7, '00', 'stm');

  for (let i = 1; i <= 6; i++) {
    add(`TRF${i}`, `Tribunal Regional Federal da ${i}ª Região`, SEGMENTOS[4], 4, pad(i), `trf${i}`);
  }
  for (let i = 1; i <= 27; i++) {
    const uf = UFS[i];
    const sigla = uf === 'DF' ? 'TJDFT' : `TJ${uf}`;
    const alias = uf === 'DF' ? 'tjdft' : `tj${uf.toLowerCase()}`;
    add(sigla, `Tribunal de Justiça ${preposicao(uf)} ${UF_NOMES[uf]}`, SEGMENTOS[8], 8, pad(i), alias);
  }
  for (let i = 1; i <= 24; i++) {
    add(`TRT${i}`, `Tribunal Regional do Trabalho da ${i}ª Região`, SEGMENTOS[5], 5, pad(i), `trt${i}`);
  }
  for (let i = 1; i <= 27; i++) {
    const uf = UFS[i];
    add(`TRE-${uf}`, `Tribunal Regional Eleitoral ${preposicao(uf)} ${UF_NOMES[uf]}`, SEGMENTOS[6], 6, pad(i),
      `tre-${uf.toLowerCase()}`);
  }
  add('TJMMG', 'Tribunal de Justiça Militar de Minas Gerais', SEGMENTOS[9], 9, '13', 'tjmmg');
  add('TJMRS', 'Tribunal de Justiça Militar do Rio Grande do Sul', SEGMENTOS[9], 9, '21', 'tjmrs');
  add('TJMSP', 'Tribunal de Justiça Militar de São Paulo', SEGMENTOS[9], 9, '26', 'tjmsp');
  return lista;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

const PREPOSICOES = {
  AC: 'do', AL: 'de', AP: 'do', AM: 'do', BA: 'da', CE: 'do', DF: 'do', ES: 'do', GO: 'de',
  MA: 'do', MT: 'de', MS: 'de', MG: 'de', PA: 'do', PB: 'da', PR: 'do', PE: 'de', PI: 'do',
  RJ: 'do', RN: 'do', RS: 'do', RO: 'de', RR: 'de', SC: 'de', SE: 'de', SP: 'de', TO: 'do',
};

function preposicao(uf) {
  return PREPOSICOES[uf] || 'do';
}

const TRIBUNAIS = buildLista();
const BY_KEY = new Map(TRIBUNAIS.map((t) => [`${t.j}.${t.tr}`, t]));
const BY_SIGLA = new Map(TRIBUNAIS.map((t) => [t.sigla.toUpperCase(), t]));

/** Encontra o tribunal a partir dos segmentos J e TR da numeração única. */
function tribunalPorSegmento(j, tr) {
  const jn = Number(j);
  // Tribunais superiores usam TR 00; STJ (3) e STF (1) sempre 00.
  if (jn === 1 || jn === 3 || jn === 7) return BY_KEY.get(`${jn}.00`) || null;
  return BY_KEY.get(`${jn}.${tr}`) || null;
}

function tribunalPorSigla(sigla) {
  if (!sigla) return null;
  return BY_SIGLA.get(String(sigla).toUpperCase().replace(/^TRE(?!-)/, 'TRE-')) || null;
}

module.exports = { TRIBUNAIS, SEGMENTOS, UFS, UF_NOMES, tribunalPorSegmento, tribunalPorSigla };
