'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Carrega variáveis de um arquivo .env, se existir (Node >= 20.12).
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envFile);

function bool(v, def = false) {
  if (v === undefined || v === '') return def;
  return ['1', 'true', 'yes', 'sim', 'on'].includes(String(v).toLowerCase());
}

const env = process.env;

const config = {
  port: Number(env.PORT || 3000),
  host: env.HOST || '0.0.0.0',
  dbPath: env.DB_PATH || path.join(__dirname, '..', 'data', 'lexxproc.db'),
  demoMode: bool(env.DEMO_MODE),
  /** Token opcional para proteger a API (header Authorization: Bearer <token>). */
  apiToken: env.API_TOKEN || '',
  cacheTtlSeconds: Number(env.CACHE_TTL_SECONDS || 6 * 3600),
  requestTimeoutMs: Number(env.REQUEST_TIMEOUT_MS || 20000),
  rateLimitPerMinute: Number(env.RATE_LIMIT_PER_MINUTE || 60),

  datajud: {
    enabled: bool(env.DATAJUD_ENABLED, true),
    baseUrl: env.DATAJUD_BASE_URL || 'https://api-publica.datajud.cnj.jus.br',
    // Chave pública divulgada pelo CNJ (pode ser alterada pelo CNJ a qualquer momento):
    // https://datajud-wiki.cnj.jus.br/api-publica/acesso
    apiKey: env.DATAJUD_API_KEY || 'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==',
  },
  escavador: {
    // https://api.escavador.com/v2/docs
    baseUrl: env.ESCAVADOR_BASE_URL || 'https://api.escavador.com/api/v2',
    token: env.ESCAVADOR_TOKEN || '',
  },
  judit: {
    // https://docs.judit.io
    baseUrl: env.JUDIT_BASE_URL || 'https://requests.prod.judit.io',
    apiKey: env.JUDIT_API_KEY || '',
    pollIntervalMs: Number(env.JUDIT_POLL_INTERVAL_MS || 2500),
    pollMaxAttempts: Number(env.JUDIT_POLL_MAX_ATTEMPTS || 24),
  },
  raspagem: {
    enabled: bool(env.SCRAPER_ENABLED, true),
    // Lista de siglas a habilitar (ex.: "TJSP,TJAL"); vazio = todos os disponíveis.
    tribunais: (env.SCRAPER_TRIBUNAIS || '').split(',').map((s) => s.trim()).filter(Boolean),
    // Intervalo mínimo entre requisições ao mesmo portal (seja gentil com os tribunais).
    intervaloMs: Number(env.SCRAPER_MIN_INTERVAL_MS || 1500),
    pausaMinutos: Number(env.SCRAPER_PAUSE_MINUTES || 30),
    maxPaginas: Number(env.SCRAPER_MAX_PAGES || 4),
    maxPaginasMovimentacoes: Number(env.SCRAPER_MAX_MOVEMENT_PAGES || 20),
    userAgent: env.SCRAPER_USER_AGENT || 'Mozilla/5.0 (compatible; LexxprocBot/1.0; consulta processual)',
  },
  monitor: {
    enabled: bool(env.MONITOR_ENABLED, true),
    intervalMinutes: Number(env.MONITOR_INTERVAL_MINUTES || 360),
    webhookUrl: env.MONITOR_WEBHOOK_URL || '',
  },
};

module.exports = config;
