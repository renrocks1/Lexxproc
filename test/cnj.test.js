'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCNJ, calcularDV, validarCPF, validarCNPJ, parseOAB, detectarTipoBusca } = require('../src/lib/cnj');
const { tribunalPorSegmento, TRIBUNAIS } = require('../src/lib/tribunais');

test('valida número CNJ conhecido (exemplo da wiki do DataJud)', () => {
  const p = parseCNJ('0000832-35.2018.4.01.3202');
  assert.equal(p.valido, true);
  assert.equal(p.digitos, '00008323520184013202');
  assert.equal(p.tribunal.sigla, 'TRF1');
  assert.equal(p.ano, 2018);
});

test('aceita número só com dígitos e formata', () => {
  const p = parseCNJ('00008323520184013202');
  assert.equal(p.formatado, '0000832-35.2018.4.01.3202');
});

test('detecta dígito verificador incorreto', () => {
  const p = parseCNJ('0000832-36.2018.4.01.3202');
  assert.equal(p.valido, false);
  assert.equal(p.dvEsperado, '35');
});

test('rejeita formatos inválidos', () => {
  assert.equal(parseCNJ('123'), null);
  assert.equal(parseCNJ(''), null);
});

test('calcularDV gera números válidos', () => {
  const dv = calcularDV('1234567', '2023', '8', '26', '0100');
  assert.equal(parseCNJ(`1234567-${dv}.2023.8.26.0100`).valido, true);
});

test('identifica tribunais pelos segmentos J.TR', () => {
  assert.equal(tribunalPorSegmento(8, '26').sigla, 'TJSP');
  assert.equal(tribunalPorSegmento(8, '07').sigla, 'TJDFT');
  assert.equal(tribunalPorSegmento(5, '02').sigla, 'TRT2');
  assert.equal(tribunalPorSegmento(5, '00').sigla, 'TST');
  assert.equal(tribunalPorSegmento(6, '19').sigla, 'TRE-RJ');
  assert.equal(tribunalPorSegmento(3, '00').sigla, 'STJ');
  assert.equal(tribunalPorSegmento(9, '13').sigla, 'TJMMG');
  assert.equal(tribunalPorSegmento(8, '26').alias, 'api_publica_tjsp');
  assert.equal(tribunalPorSegmento(6, '19').alias, 'api_publica_tre-rj');
});

test('lista de tribunais tem cobertura completa', () => {
  assert.equal(TRIBUNAIS.filter((t) => t.j === 8).length, 27);
  assert.equal(TRIBUNAIS.filter((t) => t.j === 5).length, 25);
  assert.equal(TRIBUNAIS.filter((t) => t.j === 4).length, 6);
  assert.equal(TRIBUNAIS.find((t) => t.sigla === 'TJSP').nome, 'Tribunal de Justiça de São Paulo');
});

test('valida CPF e CNPJ', () => {
  assert.equal(validarCPF('529.982.247-25'), true);
  assert.equal(validarCPF('111.111.111-11'), false);
  assert.equal(validarCPF('529.982.247-24'), false);
  assert.equal(validarCNPJ('11.222.333/0001-81'), true);
  assert.equal(validarCNPJ('11.222.333/0001-80'), false);
});

test('interpreta OAB em vários formatos', () => {
  assert.deepEqual(parseOAB('123456/SP'), { numero: '123456', uf: 'SP' });
  assert.deepEqual(parseOAB('OAB/SP 123456'), { numero: '123456', uf: 'SP' });
  assert.deepEqual(parseOAB('SP123456'), { numero: '123456', uf: 'SP' });
  assert.deepEqual(parseOAB('OAB 98765 RJ'), { numero: '98765', uf: 'RJ' });
});

test('detecta o tipo de busca automaticamente', () => {
  assert.equal(detectarTipoBusca('0000832-35.2018.4.01.3202').tipo, 'cnj');
  assert.equal(detectarTipoBusca('529.982.247-25').tipo, 'cpf');
  assert.equal(detectarTipoBusca('11.222.333/0001-81').tipo, 'cnpj');
  assert.equal(detectarTipoBusca('OAB/SP 123456').tipo, 'oab');
  assert.equal(detectarTipoBusca('Maria da Silva').tipo, 'nome');
});
