'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');

const { abrir, criarRepositorio } = require('./db');
const { criarDataJud, GRAUS } = require('./providers/datajud');
const { criarEscavador } = require('./providers/escavador');
const { criarJudit } = require('./providers/judit');
const { criarDemo } = require('./providers/demo');
const { criarRaspagem } = require('./providers/raspagem');
const { criarServicoBusca } = require('./services/busca');
const { criarMonitor } = require('./services/monitor');
const { parseCNJ, detectarTipoBusca } = require('./lib/cnj');
const { TRIBUNAIS } = require('./lib/tribunais');
const { portaisConsultaManual } = require('./scrapers/registro');

function criarProvedores(config) {
  if (config.demoMode) return [criarDemo()];
  // Ordem importa na busca por número: o DataJud traz metadados; a raspagem
  // completa partes e movimentações detalhadas sem custo; os pagos ficam por último.
  return [criarDataJud(config), criarRaspagem(config), criarEscavador(config), criarJudit(config)];
}

/** Limitador simples por IP (janela de 1 minuto). */
function rateLimit(porMinuto) {
  const janelas = new Map();
  return (req, res, next) => {
    const agora = Date.now();
    const ip = req.ip || 'local';
    const j = janelas.get(ip);
    if (!j || agora - j.inicio > 60000) {
      janelas.set(ip, { inicio: agora, total: 1 });
      if (janelas.size > 10000) janelas.clear();
      return next();
    }
    j.total += 1;
    if (j.total > porMinuto) {
      res.set('Retry-After', String(Math.ceil((60000 - (agora - j.inicio)) / 1000)));
      return res.status(429).json({ erro: 'Muitas requisições. Aguarde alguns segundos.' });
    }
    return next();
  };
}

function autenticacao(token) {
  if (!token) return (_req, _res, next) => next();
  const esperado = Buffer.from(token);
  return (req, res, next) => {
    const enviado = Buffer.from(String(req.get('authorization') || '').replace(/^Bearer\s+/i, ''));
    if (enviado.length === esperado.length && crypto.timingSafeEqual(enviado, esperado)) return next();
    return res.status(401).json({ erro: 'Não autorizado' });
  };
}

function criarApp(config, { provedores, logger = console } = {}) {
  const repo = criarRepositorio(abrir(config.dbPath));
  const busca = criarServicoBusca({ provedores: provedores || criarProvedores(config), repo, config });
  const monitor = criarMonitor({ busca, repo, config, logger });

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(express.json({ limit: '100kb' }));
  app.use((_req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'",
    });
    next();
  });

  const api = express.Router();
  api.use(rateLimit(config.rateLimitPerMinute));
  api.use(autenticacao(config.apiToken));

  const handler = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

  api.get('/status', (_req, res) => {
    res.json({
      versao: require('../package.json').version,
      modoDemonstracao: config.demoMode,
      provedores: busca.provedoresAtivos(),
      raspagem: busca.raspagem(),
      monitoramento: { habilitado: config.monitor.enabled, intervaloMinutos: config.monitor.intervalMinutes },
      alertasNaoLidos: repo.contarNaoLidos(),
    });
  });

  api.get('/tribunais', (_req, res) => {
    res.json(TRIBUNAIS.map(({ sigla, nome, segmento, j, tr, alias }) => ({ sigla, nome, segmento, j, tr, disponivelDataJud: Boolean(alias) })));
  });

  api.get('/graus', (_req, res) => res.json(GRAUS));

  /** Valida e interpreta um número CNJ sem consultar fontes externas. */
  api.get('/cnj/:numero', (req, res) => {
    const info = parseCNJ(req.params.numero);
    if (!info) return res.status(400).json({ erro: 'Formato inválido' });
    const { tribunal, ...resto } = info;
    return res.json({ ...resto, tribunal: tribunal && { sigla: tribunal.sigla, nome: tribunal.nome, segmento: tribunal.segmento } });
  });

  api.get('/detectar', (req, res) => {
    const { tipo, valor } = detectarTipoBusca(req.query.q);
    res.json({ tipo, valor });
  });

  api.get('/busca', handler(async (req, res) => {
    const tribunais = String(req.query.tribunais || '').split(',').map((s) => s.trim()).filter(Boolean);
    res.json(await busca.buscar(req.query.q, { atualizar: req.query.atualizar === '1', tribunais }));
  }));

  api.get('/busca-avancada', handler(async (req, res) => {
    const { tribunal, classe, orgao, assunto, grau, inicio, fim, tamanho, cursor } = req.query;
    res.json(await busca.buscaAvancada({
      tribunal, classeCodigo: classe, orgaoCodigo: orgao, assuntoCodigo: assunto, grau,
      dataInicio: inicio, dataFim: fim, tamanho, cursor,
    }));
  }));

  api.get('/processos/:numero', handler(async (req, res) => {
    const r = await busca.buscarProcesso(req.params.numero, { atualizar: req.query.atualizar === '1' });
    if (!r.processo) {
      const t = r.info?.tribunal;
      const portais = t ? portaisConsultaManual(t.sigla) : [];
      const eproc = portais.find((p) => p.sistema === 'eproc');
      return res.status(404).json({
        erro: t && !t.alias
          ? `O ${t.sigla} não está disponível na API pública do DataJud.`
          : eproc
            ? `Processo não encontrado no DataJud nem no e-SAJ do ${t.sigla}. Processos distribuídos a partir de 2025 podem estar no eproc, `
              + 'cuja consulta pública exige verificação humana e por isso não é feita automaticamente — consulte pelo link abaixo.'
            : 'Processo não encontrado. Ele pode estar em segredo de justiça ou ainda não ter sido indexado pelo tribunal.',
        consultaManual: portais,
        erros: r.erros,
      });
    }
    const monitorado = repo.obterMonitorado(r.processo.numero);
    return res.json({
      ...r,
      monitorado: Boolean(monitorado),
      apelido: monitorado?.apelido || null,
      consultaManual: r.processo.tribunal ? portaisConsultaManual(r.processo.tribunal.sigla) : [],
    });
  }));

  // ---- Monitoramento ----
  api.get('/monitorados', (_req, res) => res.json(repo.listarMonitorados()));

  api.post('/monitorados', handler(async (req, res) => {
    const { numero, apelido } = req.body || {};
    if (!numero) return res.status(400).json({ erro: 'Informe o número do processo' });
    return res.status(201).json(await monitor.adicionar(numero, apelido ? String(apelido).slice(0, 120) : undefined));
  }));

  api.patch('/monitorados/:numero', (req, res) => {
    if (!repo.obterMonitorado(req.params.numero)) return res.status(404).json({ erro: 'Não monitorado' });
    repo.renomearMonitorado(req.params.numero, req.body?.apelido ? String(req.body.apelido).slice(0, 120) : null);
    return res.json(repo.obterMonitorado(req.params.numero));
  });

  api.delete('/monitorados/:numero', (req, res) => {
    monitor.remover(req.params.numero);
    res.status(204).end();
  });

  api.post('/monitorados/:numero/verificar', handler(async (req, res) => {
    if (!repo.obterMonitorado(req.params.numero)) return res.status(404).json({ erro: 'Não monitorado' });
    const novos = await monitor.verificar(req.params.numero);
    res.json({ novos: novos.length, monitorado: repo.obterMonitorado(req.params.numero) });
  }));

  api.post('/monitoramento/executar', handler(async (_req, res) => {
    res.json(await monitor.verificarTodos());
  }));

  // ---- Alertas ----
  api.get('/alertas', (req, res) => {
    res.json({
      naoLidos: repo.contarNaoLidos(),
      alertas: repo.listarAlertas({ apenasNaoLidos: req.query.naoLidos === '1', limite: Math.min(Number(req.query.limite) || 100, 500) }),
    });
  });
  api.post('/alertas/lidos', (_req, res) => { repo.marcarTodosLidos(); res.status(204).end(); });
  api.post('/alertas/:id/lido', (req, res) => { repo.marcarLido(Number(req.params.id)); res.status(204).end(); });

  // ---- Histórico ----
  api.get('/historico', (_req, res) => res.json(repo.listarHistorico()));
  api.delete('/historico', (_req, res) => { repo.limparHistorico(); res.status(204).end(); });

  api.use((_req, res) => res.status(404).json({ erro: 'Rota não encontrada' }));

  app.use('/api', api);
  app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'], maxAge: '1h' }));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
    if (status >= 500) logger.error(err);
    res.status(status).json({ erro: status === 500 ? 'Erro interno' : err.message, ...(err.erros ? { erros: err.erros } : {}) });
  });

  return { app, repo, busca, monitor };
}

module.exports = { criarApp, criarProvedores };
