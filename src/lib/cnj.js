'use strict';

const { tribunalPorSegmento } = require('./tribunais');

/**
 * Numeração Única CNJ (Resolução 65/2008): NNNNNNN-DD.AAAA.J.TR.OOOO
 *  N  sequencial (7) | DD dígito verificador (2) | AAAA ano de ajuizamento
 *  J  segmento da justiça (1) | TR tribunal (2) | OOOO unidade de origem (4)
 * O DV é calculado por módulo 97 (ISO 7064).
 */

const CNJ_REGEX = /^(\d{7})-?(\d{2})\.?(\d{4})\.?(\d)\.?(\d{2})\.?(\d{4})$/;

function somenteDigitos(valor) {
  return String(valor || '').replace(/\D/g, '');
}

/** Resto da divisão por 97 de uma string numérica arbitrariamente grande. */
function mod97(numerico) {
  let resto = 0;
  for (const ch of numerico) resto = (resto * 10 + Number(ch)) % 97;
  return resto;
}

/** Calcula o dígito verificador a partir dos demais campos. */
function calcularDV(sequencial, ano, j, tr, origem) {
  const base = `${sequencial}${ano}${j}${tr}${origem}00`;
  return String(98 - mod97(base)).padStart(2, '0');
}

/**
 * Faz o parse de um número de processo (formatado ou só dígitos).
 * Retorna null se o formato for inválido; caso contrário, um objeto com
 * os campos e a flag `valido` (dígito verificador confere).
 */
function parseCNJ(entrada) {
  const bruto = String(entrada || '').trim();
  let m = bruto.match(CNJ_REGEX);
  if (!m) {
    const d = somenteDigitos(bruto);
    if (d.length !== 20) return null;
    m = [d, d.slice(0, 7), d.slice(7, 9), d.slice(9, 13), d.slice(13, 14), d.slice(14, 16), d.slice(16, 20)];
  }
  const [, sequencial, dv, ano, j, tr, origem] = m;
  const dvEsperado = calcularDV(sequencial, ano, j, tr, origem);
  const digitos = `${sequencial}${dv}${ano}${j}${tr}${origem}`;
  return {
    digitos,
    formatado: `${sequencial}-${dv}.${ano}.${j}.${tr}.${origem}`,
    sequencial,
    dv,
    dvEsperado,
    ano: Number(ano),
    j: Number(j),
    tr,
    origem,
    valido: dv === dvEsperado,
    tribunal: tribunalPorSegmento(j, tr),
  };
}

function formatarCNJ(entrada) {
  const p = parseCNJ(entrada);
  return p ? p.formatado : String(entrada || '');
}

function validarCPF(valor) {
  const c = somenteDigitos(valor);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const dig = (len) => {
    let soma = 0;
    for (let i = 0; i < len; i++) soma += Number(c[i]) * (len + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dig(9) === Number(c[9]) && dig(10) === Number(c[10]);
}

function validarCNPJ(valor) {
  const c = somenteDigitos(valor);
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const dig = (len) => {
    const pesos = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let soma = 0;
    for (let i = 0; i < len; i++) soma += Number(c[i]) * pesos[i];
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dig(12) === Number(c[12]) && dig(13) === Number(c[13]);
}

/** OAB: número + UF, ex.: "123456/SP", "SP123456", "OAB/SP 123.456". */
function parseOAB(valor) {
  const s = String(valor || '').toUpperCase().replace(/OAB/g, ' ').replace(/[.\s]/g, ' ');
  const m1 = s.match(/^\s*(\d{1,7})\s*[-/]?\s*([A-Z]{2})\s*$/);
  const m2 = s.match(/^\s*[-/]?\s*([A-Z]{2})\s*[-/]?\s*(\d{1,7})\s*$/);
  const compact = s.replace(/\s+/g, '');
  const m3 = compact.match(/^[-/]?([A-Z]{2})[-/]?(\d{1,7})$/) || compact.match(/^(\d{1,7})[-/]?([A-Z]{2})$/);
  if (m1) return { numero: m1[1], uf: m1[2] };
  if (m2) return { numero: m2[2], uf: m2[1] };
  if (m3) return /^\d/.test(m3[1]) ? { numero: m3[1], uf: m3[2] } : { numero: m3[2], uf: m3[1] };
  return null;
}

/**
 * Detecta automaticamente o tipo de termo digitado na busca.
 * @returns {{tipo: 'cnj'|'cpf'|'cnpj'|'oab'|'nome', valor: string, info?: object}}
 */
function detectarTipoBusca(termo) {
  const t = String(termo || '').trim();
  const d = somenteDigitos(t);
  const soNumerosEPontuacao = /^[\d.\-/\s]+$/.test(t);

  if (soNumerosEPontuacao && d.length === 20) {
    const info = parseCNJ(t);
    if (info) return { tipo: 'cnj', valor: info.digitos, info };
  }
  if (soNumerosEPontuacao && d.length === 11 && validarCPF(d)) return { tipo: 'cpf', valor: d };
  if (soNumerosEPontuacao && d.length === 14 && validarCNPJ(d)) return { tipo: 'cnpj', valor: d };
  if (/OAB/i.test(t) || /^\s*\d{1,7}\s*[-/]\s*[A-Za-z]{2}\s*$/.test(t) || /^\s*[A-Za-z]{2}\s*[-/]?\s*\d{3,7}\s*$/.test(t)) {
    const oab = parseOAB(t);
    if (oab) return { tipo: 'oab', valor: `${oab.numero}/${oab.uf}`, info: oab };
  }
  return { tipo: 'nome', valor: t.replace(/\s+/g, ' ') };
}

module.exports = {
  parseCNJ, formatarCNJ, calcularDV, mod97, somenteDigitos,
  validarCPF, validarCNPJ, parseOAB, detectarTipoBusca,
};
