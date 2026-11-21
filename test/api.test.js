'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { criarApp } = require('../src/app');
const { criarDemo, gerarNumero, rng } = require('../src/providers/demo');
const { parseCNJ } = require('../src/lib/cnj');

function configTeste(extra = {}) {
  return {
    port: 0, dbPath: ':memory:', demoMode: true, apiToken: '', cacheTtlSeconds: 60, requestTimeoutMs: 1000,
    rateLimitPerMinute: 1000,
    datajud: { enabled: false }, escavador: {}, judit: {},
    monitor: { enabled: false, intervalMinutes: 60, webhookUrl: '' },
    ...extra,
  };
}

async function iniciar(config, opts) {
  const ctx = criarApp(config, { logger: { info() {}, warn() {}, error() {} }, ...opts });
  const server = await new Promise((r) => { const s = ctx.app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const req = async (caminho, opcoes = {}) => {
    const res = await fetch(base + caminho, {
      ...opcoes,
      headers: { 'Content-Type': 'application/json', ...(opcoes.headers || {}) },
      body: opcoes.body ? JSON.stringify(opcoes.body) : undefined,
    });
    return { status: res.status, body: res.status === 204 ? null : await res.json() };
  };
  return { ...ctx, server, req, fechar: () => new Promise((r) => server.close(r)) };
}

const NUMERO = gerarNumero(rng('teste'));

test('fluxo completo em modo demonstração', async (t) => {
  const s = await iniciar(configTeste());
  t.after(() => s.fechar());

  await t.test('status', async () => {
    const r = await s.req('/status');
    assert.equal(r.status, 200);
    assert.equal(r.body.modoDemonstracao, true);
  });

  await t.test('consulta por número', async () => {
    const r = await s.req(`/processos/${NUMERO}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.processo.numero, NUMERO);
    assert.ok(r.body.processo.movimentos.length > 0);
    assert.equal(r.body.monitorado, false);
    const again = await s.req(`/processos/${NUMERO}`);
    assert.equal(again.body.cache, true);
  });

  await t.test('rejeita DV inválido', async () => {
    const p = parseCNJ(NUMERO);
    const ruim = `${p.sequencial}${p.dv === '00' ? '01' : '00'}${NUMERO.slice(9)}`;
    const r = await s.req(`/processos/${ruim}`);
    assert.equal(r.status, 400);
    assert.match(r.body.erro, /verificador/);
  });

  await t.test('busca por nome, CPF e OAB', async () => {
    const nome = await s.req(`/busca?q=${encodeURIComponent('Joana Prado Lima')}`);
    assert.equal(nome.status, 200);
    assert.equal(nome.body.tipo, 'nome');
    assert.ok(nome.body.total > 0);
    assert.ok(nome.body.resultados.every((p) => p.partes.some((x) => x.nome === 'Joana Prado Lima')));
    const cpf = await s.req('/busca?q=529.982.247-25');
    assert.equal(cpf.body.tipo, 'cpf');
    const oab = await s.req(`/busca?q=${encodeURIComponent('OAB/SP 123456')}`);
    assert.equal(oab.body.tipo, 'oab');
    const curto = await s.req('/busca?q=ab');
    assert.equal(curto.status, 400);
  });

  await t.test('busca avançada', async () => {
    const r = await s.req('/busca-avancada?tribunal=TJSP');
    assert.equal(r.status, 200);
    assert.ok(r.body.resultados.every((p) => p.tribunal.sigla === 'TJSP'));
  });

  await t.test('monitoramento e alertas', async () => {
    const add = await s.req('/monitorados', { method: 'POST', body: { numero: NUMERO, apelido: 'Cliente A' } });
    assert.equal(add.status, 201);
    assert.equal(add.body.apelido, 'Cliente A');
    const lista = await s.req('/monitorados');
    assert.equal(lista.body.length, 1);

    // Simula estado antigo: remove a "última movimentação" conhecida.
    s.repo.db.prepare('UPDATE monitorados SET assinatura = ?, ultima_movimentacao = ? WHERE numero = ?')
      .run('x', '2000-01-01T00:00:00', NUMERO);
    const v = await s.req(`/monitorados/${NUMERO}/verificar`, { method: 'POST' });
    assert.ok(v.body.novos > 0);
    const alertas = await s.req('/alertas');
    assert.equal(alertas.body.naoLidos, v.body.novos);
    await s.req('/alertas/lidos', { method: 'POST' });
    assert.equal((await s.req('/alertas')).body.naoLidos, 0);

    const proc = await s.req(`/processos/${NUMERO}`);
    assert.equal(proc.body.monitorado, true);
    assert.equal((await s.req(`/monitorados/${NUMERO}`, { method: 'DELETE' })).status, 204);
    assert.equal((await s.req('/monitorados')).body.length, 0);
  });

  await t.test('histórico de buscas', async () => {
    const h = await s.req('/historico');
    assert.ok(h.body.length >= 3);
  });
});

test('sem provedor de partes, busca por nome retorna 501', async (t) => {
  const prov = { ...criarDemo(), suporta: ['cnj'] };
  const s = await iniciar(configTeste({ demoMode: false }), { provedores: [prov] });
  t.after(() => s.fechar());
  const r = await s.req('/busca?q=Maria%20da%20Silva');
  assert.equal(r.status, 501);
  assert.match(r.body.erro, /ESCAVADOR_TOKEN/);
});

test('falha do provedor devolve versão salva', async (t) => {
  let falhar = false;
  const demo = criarDemo();
  const prov = { ...demo, async buscarPorNumero(n) { if (falhar) throw Object.assign(new Error('fora do ar'), { status: 504 }); return demo.buscarPorNumero(n); } };
  const s = await iniciar(configTeste({ demoMode: false }), { provedores: [prov] });
  t.after(() => s.fechar());
  assert.equal((await s.req(`/processos/${NUMERO}`)).status, 200);
  falhar = true;
  const r = await s.req(`/processos/${NUMERO}?atualizar=1`);
  assert.equal(r.status, 200);
  assert.equal(r.body.desatualizado, true);
});

test('token de API protege as rotas', async (t) => {
  const s = await iniciar(configTeste({ apiToken: 'segredo' }));
  t.after(() => s.fechar());
  assert.equal((await s.req('/status')).status, 401);
  assert.equal((await s.req('/status', { headers: { Authorization: 'Bearer segredo' } })).status, 200);
});
