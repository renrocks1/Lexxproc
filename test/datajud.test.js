'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizarHit, dataISO } = require('../src/providers/datajud');
const { mesclarProcessos } = require('../src/lib/modelo');

// Estrutura de documento conforme a API Pública do DataJud.
const hitG1 = {
  numeroProcesso: '00008323520184013202',
  classe: { codigo: 436, nome: 'Procedimento do Juizado Especial Cível' },
  sistema: { codigo: 1, nome: 'PJe' },
  formato: { codigo: 1, nome: 'Eletrônico' },
  tribunal: 'TRF1',
  dataHoraUltimaAtualizacao: '2023-07-21T19:06:41.007Z',
  grau: 'JE',
  dataAjuizamento: '20180502000000',
  movimentos: [
    { codigo: 26, nome: 'Distribuição', dataHora: '2018-05-02T10:00:00.000Z',
      complementosTabelados: [{ codigo: 2, valor: 1, nome: 'competência exclusiva', descricao: 'tipo_de_distribuicao_redistribuicao' }] },
    { codigo: 22, nome: 'Baixa Definitiva', dataHora: '2020-01-10T12:00:00.000Z' },
  ],
  orgaoJulgador: { codigoMunicipioIBGE: 1302603, codigo: 16403, nome: 'JEF Adj - Tefé' },
  assuntos: [{ codigo: 6177, nome: 'Concessão' }],
  nivelSigilo: 0,
};

test('converte datas do DataJud', () => {
  assert.equal(dataISO('20180502000000'), '2018-05-02T00:00:00');
  assert.equal(dataISO('2023-07-21T19:06:41.000Z'), '2023-07-21T19:06:41Z');
  assert.equal(dataISO(null), null);
});

test('normaliza documento do DataJud', () => {
  const p = normalizarHit(hitG1);
  assert.equal(p.numeroFormatado, '0000832-35.2018.4.01.3202');
  assert.equal(p.tribunal.sigla, 'TRF1');
  assert.equal(p.classe.nome, 'Procedimento do Juizado Especial Cível');
  assert.equal(p.orgaoJulgador.nome, 'JEF Adj - Tefé');
  assert.deepEqual(p.graus, ['JE']);
  assert.equal(p.movimentos[0].nome, 'Baixa Definitiva', 'mais recente primeiro');
  assert.match(p.movimentos[1].complementos[0], /competência exclusiva/);
  assert.equal(p.sistema, 'PJe');
});

test('mescla registros de graus diferentes sem duplicar movimentos', () => {
  const g2 = { ...hitG1, grau: 'TR', movimentos: [...hitG1.movimentos, { codigo: 51, nome: 'Conclusão', dataHora: '2019-03-01T00:00:00Z' }] };
  const p = mesclarProcessos(normalizarHit(hitG1), normalizarHit(g2));
  assert.deepEqual(p.graus.sort(), ['JE', 'TR']);
  assert.equal(p.movimentos.length, 3);
});
