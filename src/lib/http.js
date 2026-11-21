'use strict';

class ProviderError extends Error {
  constructor(message, { status = 502, provider, detalhe } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.provider = provider;
    this.detalhe = detalhe;
  }
}

/** fetch com timeout e parse JSON; lança ProviderError em falhas. */
async function requestJSON(url, { method = 'GET', headers = {}, body, timeoutMs = 20000, provider } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch (err) {
    const msg = err.name === 'AbortError' ? 'Tempo de resposta esgotado' : `Falha de conexão: ${err.cause?.code || err.message}`;
    throw new ProviderError(`${provider || 'Provedor'}: ${msg}`, { status: 504, provider });
  } finally {
    clearTimeout(timer);
  }
  const texto = await res.text();
  let dados = null;
  try { dados = texto ? JSON.parse(texto) : null; } catch { dados = { bruto: texto.slice(0, 500) }; }
  if (!res.ok) {
    throw new ProviderError(`${provider || 'Provedor'} respondeu HTTP ${res.status}`, {
      status: res.status === 404 ? 404 : 502,
      provider,
      detalhe: dados,
    });
  }
  return dados;
}

module.exports = { requestJSON, ProviderError };
