'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { criarApp } = require('../src/app');
const { criarRaspagem } = require('../src/providers/raspagem');
const { novoProcesso } = require('../src/lib/modelo');
const { portalSimulado } = require('./helpers/portal');

const NUMERO = '10000027020258260100';

function config(portalBase) {
  return {
    dbPath: ':memory:', demoMode: false, apiToken: '', cacheTtlSeconds: 60, requestTimeoutMs: 2000, rateLimitPerMinute: 1000,
    datajud: { enabled: false }, escavador: {}, judit: {},
    raspagem: { enabled: true, tribunais: [], intervaloMs: 0, pausaMinutos: 30, maxPaginas: 1, maxPaginasMovimentacoes: 5, userAgent: 't', esperaBaseMs: 1 },
    monitor: { enabled: false, intervalMinutes: 60, webhookUrl: '' },
    _portal: portalBase,
  };
}

/** DataJud falso: metadados com códigos TPU, sem partes. */
function dataJudFalso() {
  return {
    nome: 'datajud', rotulo: 'DataJud', habilitado: true, suporta: ['cnj'],
    async buscarPorNumero(n) {
      const p = novoProcesso(n);
      p.classe = { codigo: 120, nome: 'Mandado de Segurança Cível' };
      p.graus = ['G1', 'G2'];
      p.movimentos = [{ data: '2025-08-03T02:04:00', codigo: 26, nome: 'Distribuição', complementos: [], orgao: null, grau: 'G1' }];
      p.fontes = ['datajud'];
      return p;
    },
  };
}

async function iniciar(t, { portal }) {
  const cfg = config();
  const raspagem = criarRaspagem(cfg, { tribunais: [{ sigla: 'TJSP', sistema: 'esaj', base: portal.base, verificado: true }] });
  const ctx = criarApp(cfg, { provedores: [dataJudFalso(), raspagem], logger: { info() {}, warn() {}, error() {} } });
  const server = await new Promise((r) => { const s = ctx.app.listen(0, () => r(s)); });
  t.after(() => new Promise((r) => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const req = async (c, o = {}) => {
    const res = await fetch(base + c, { ...o, headers: { 'Content-Type': 'application/json' }, body: o.body && JSON.stringify(o.body) });
    return { status: res.status, body: res.status === 204 ? null : await res.json() };
  };
  return { ...ctx, req };
}

test('DataJud + raspagem: une metadados oficiais com partes e movimentações do portal', async (t) => {
  const portal = await portalSimulado();
  t.after(() => portal.server.close());
  const s = await iniciar(t, { portal });
  const r = await s.req(`/processos/${NUMERO}`);
  assert.equal(r.status, 200);
  const p = r.body.processo;
  assert.equal(p.classe.codigo, 120, 'classe com código TPU vem do DataJud');
  assert.deepEqual(p.graus.sort(), ['G1', 'G2']);
  assert.equal(p.partes.length, 3, 'partes vêm da raspagem');
  assert.equal(p.juiz, 'JUIZ FICTÍCIO DE TAL');
  assert.equal(p.valorCausa, 'R$ 1.621,00');
  assert.equal(p.movimentos.length, 4, 'movimentações detalhadas do portal substituem as do DataJud');
  assert.deepEqual(p.fontes, ['datajud', 'raspagem:tjsp']);

  const st = await s.req('/status');
  assert.equal(st.body.raspagem.tribunais[0].sigla, 'TJSP');
});

test('busca por nome via raspagem, com filtro de tribunais', async (t) => {
  const portal = await portalSimulado();
  t.after(() => portal.server.close());
  const s = await iniciar(t, { portal });
  const r = await s.req(`/busca?q=${encodeURIComponent('Empresa Exemplo')}&tribunais=TJSP`);
  assert.equal(r.status, 200);
  assert.equal(r.body.tipo, 'nome');
  assert.equal(r.body.total, 3);
  assert.equal(r.body.resultados[0].tribunal.sigla, 'TJSP');
  assert.equal(r.body.resultados[0].partes[0].nome, 'EMPRESA EXEMPLO DE COMUNICAÇÃO S.A.');
  assert.deepEqual(r.body.erros, []);
  assert.match(r.body.avisos[0], /TJSP: exibindo 3 de 32 processos/, 'avisa que a lista foi truncada');

  const fora = await s.req('/busca?q=Empresa%20Exemplo&tribunais=TJAL');
  assert.equal(fora.body.total, 0);
});

test('"muitos processos" vira mensagem clara ao usuário', async (t) => {
  const portal = await portalSimulado();
  t.after(() => portal.server.close());
  const s = await iniciar(t, { portal });
  const r = await s.req(`/busca?q=${encodeURIComponent('Muitos Nomes Comuns')}`);
  assert.equal(r.status, 422);
  assert.match(r.body.erro, /TJSP: muitos processos encontrados — refine a busca/);
});

test('monitoramento não gera alertas falsos quando a fonte das movimentações muda', async (t) => {
  const portal = await portalSimulado();
  t.after(() => portal.server.close());
  const s = await iniciar(t, { portal });
  await s.req('/monitorados', { method: 'POST', body: { numero: NUMERO } });
  const m = (await s.req('/monitorados')).body[0];
  assert.match(m.assinatura, /^2:/, 'fonte = raspagem');
  assert.equal(m.ultima_movimentacao, '2025-10-29T00:00:00');

  // Portal passa a exigir CAPTCHA → só o DataJud responde (mov. antiga, outra fonte).
  portal.server.close();
  const v = await s.req(`/monitorados/${NUMERO}/verificar`, { method: 'POST' });
  assert.equal(v.body.novos, 0);
  assert.equal((await s.req('/alertas')).body.naoLidos, 0);
});
