'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS cache (
  chave       TEXT PRIMARY KEY,
  valor       TEXT NOT NULL,
  expira_em   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS processos (
  numero            TEXT PRIMARY KEY,
  tribunal          TEXT,
  classe            TEXT,
  dados             TEXT NOT NULL,
  atualizado_em     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS monitorados (
  numero              TEXT PRIMARY KEY,
  apelido             TEXT,
  tribunal            TEXT,
  classe              TEXT,
  total_movimentos    INTEGER NOT NULL DEFAULT 0,
  assinatura          TEXT,
  ultima_movimentacao TEXT,
  ultima_verificacao  TEXT,
  ultimo_erro         TEXT,
  criado_em           TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alertas (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  numero      TEXT NOT NULL,
  titulo      TEXT NOT NULL,
  detalhe     TEXT,
  data_evento TEXT,
  lido        INTEGER NOT NULL DEFAULT 0,
  criado_em   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alertas_numero ON alertas(numero);

CREATE TABLE IF NOT EXISTS historico (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  termo      TEXT NOT NULL,
  tipo       TEXT NOT NULL,
  resultados INTEGER NOT NULL DEFAULT 0,
  criado_em  TEXT NOT NULL
);
`;

function abrir(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

const agora = () => new Date().toISOString();

/** Camada fina de repositório sobre o SQLite. */
function criarRepositorio(db) {
  const st = {
    cacheGet: db.prepare('SELECT valor, expira_em FROM cache WHERE chave = ?'),
    cacheSet: db.prepare('INSERT OR REPLACE INTO cache (chave, valor, expira_em) VALUES (?, ?, ?)'),
    cachePurge: db.prepare('DELETE FROM cache WHERE expira_em < ?'),
    procUpsert: db.prepare(`INSERT INTO processos (numero, tribunal, classe, dados, atualizado_em)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(numero) DO UPDATE SET tribunal = excluded.tribunal, classe = excluded.classe,
        dados = excluded.dados, atualizado_em = excluded.atualizado_em`),
    procGet: db.prepare('SELECT dados, atualizado_em FROM processos WHERE numero = ?'),
    monList: db.prepare('SELECT * FROM monitorados ORDER BY COALESCE(ultima_movimentacao, criado_em) DESC'),
    monGet: db.prepare('SELECT * FROM monitorados WHERE numero = ?'),
    monInsert: db.prepare(`INSERT INTO monitorados
      (numero, apelido, tribunal, classe, total_movimentos, assinatura, ultima_movimentacao, ultima_verificacao, criado_em)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    monUpdate: db.prepare(`UPDATE monitorados SET tribunal = ?, classe = ?, total_movimentos = ?, assinatura = ?,
      ultima_movimentacao = ?, ultima_verificacao = ?, ultimo_erro = NULL WHERE numero = ?`),
    monErro: db.prepare('UPDATE monitorados SET ultima_verificacao = ?, ultimo_erro = ? WHERE numero = ?'),
    monApelido: db.prepare('UPDATE monitorados SET apelido = ? WHERE numero = ?'),
    monDelete: db.prepare('DELETE FROM monitorados WHERE numero = ?'),
    alertaInsert: db.prepare('INSERT INTO alertas (numero, titulo, detalhe, data_evento, criado_em) VALUES (?, ?, ?, ?, ?)'),
    alertaList: db.prepare(`SELECT a.*, m.apelido FROM alertas a LEFT JOIN monitorados m ON m.numero = a.numero
      WHERE (? = 0 OR a.lido = 0) ORDER BY a.id DESC LIMIT ?`),
    alertaNaoLidos: db.prepare('SELECT COUNT(*) AS total FROM alertas WHERE lido = 0'),
    alertaLer: db.prepare('UPDATE alertas SET lido = 1 WHERE id = ?'),
    alertaLerTodos: db.prepare('UPDATE alertas SET lido = 1 WHERE lido = 0'),
    alertaDeleteNumero: db.prepare('DELETE FROM alertas WHERE numero = ?'),
    histInsert: db.prepare('INSERT INTO historico (termo, tipo, resultados, criado_em) VALUES (?, ?, ?, ?)'),
    histList: db.prepare(`SELECT termo, tipo, MAX(resultados) AS resultados, MAX(criado_em) AS criado_em
      FROM historico GROUP BY termo, tipo ORDER BY MAX(id) DESC LIMIT ?`),
    histClear: db.prepare('DELETE FROM historico'),
  };

  return {
    db,
    // ---- cache ----
    cacheGet(chave) {
      const row = st.cacheGet.get(chave);
      if (!row || row.expira_em < Date.now()) return null;
      return JSON.parse(row.valor);
    },
    cacheSet(chave, valor, ttlSegundos) {
      st.cacheSet.run(chave, JSON.stringify(valor), Date.now() + ttlSegundos * 1000);
    },
    cachePurge() {
      st.cachePurge.run(Date.now());
    },
    // ---- processos ----
    salvarProcesso(p) {
      st.procUpsert.run(p.numero, p.tribunal?.sigla || null, p.classe?.nome || null, JSON.stringify(p), agora());
    },
    obterProcesso(numero) {
      const row = st.procGet.get(numero);
      return row ? { ...JSON.parse(row.dados), salvoEm: row.atualizado_em } : null;
    },
    // ---- monitoramento ----
    listarMonitorados: () => st.monList.all(),
    obterMonitorado: (numero) => st.monGet.get(numero) || null,
    inserirMonitorado(m) {
      const ts = agora();
      st.monInsert.run(m.numero, m.apelido || null, m.tribunal || null, m.classe || null,
        m.totalMovimentos || 0, m.assinatura || null, m.ultimaMovimentacao || null, ts, ts);
    },
    atualizarMonitorado(m) {
      st.monUpdate.run(m.tribunal || null, m.classe || null, m.totalMovimentos || 0, m.assinatura || null,
        m.ultimaMovimentacao || null, agora(), m.numero);
    },
    registrarErroMonitorado: (numero, erro) => st.monErro.run(agora(), String(erro).slice(0, 500), numero),
    renomearMonitorado: (numero, apelido) => st.monApelido.run(apelido || null, numero),
    removerMonitorado(numero) {
      st.monDelete.run(numero);
      st.alertaDeleteNumero.run(numero);
    },
    // ---- alertas ----
    criarAlerta: (a) => st.alertaInsert.run(a.numero, a.titulo, a.detalhe || null, a.dataEvento || null, agora()),
    listarAlertas: ({ apenasNaoLidos = false, limite = 100 } = {}) => st.alertaList.all(apenasNaoLidos ? 1 : 0, limite),
    contarNaoLidos: () => st.alertaNaoLidos.get().total,
    marcarLido: (id) => st.alertaLer.run(id),
    marcarTodosLidos: () => st.alertaLerTodos.run(),
    // ---- histórico ----
    registrarBusca: (termo, tipo, resultados) => st.histInsert.run(termo, tipo, resultados, agora()),
    listarHistorico: (limite = 15) => st.histList.all(limite),
    limparHistorico: () => st.histClear.run(),
  };
}

module.exports = { abrir, criarRepositorio };
