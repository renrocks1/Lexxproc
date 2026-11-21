'use strict';

/**
 * Cliente HTTP para raspagem responsável dos portais dos tribunais.
 *
 * - Sessão com cookies (os portais exigem o JSESSIONID entre requisições).
 * - Redirecionamentos seguidos manualmente para capturar cookies em cada salto.
 * - Ritmo mínimo entre requisições ao mesmo host (fila por host).
 * - Retentativas com espera exponencial em falhas de rede e HTTP 5xx/429.
 * - Decodificação conforme o charset (vários portais ainda usam ISO-8859-1).
 * - Disjuntor: se o portal exigir CAPTCHA ou falhar repetidamente, o host é
 *   pausado por um tempo. O sistema NÃO tenta contornar CAPTCHAs.
 */

const { ProviderError } = require('../lib/http');

class CaptchaError extends ProviderError {
  constructor(host) {
    super(`O portal ${host} exigiu verificação humana (CAPTCHA). A consulta automática foi pausada; consulte diretamente no site do tribunal.`, { status: 503, provider: 'raspagem' });
    this.name = 'CaptchaError';
  }
}

class HostPausadoError extends ProviderError {
  constructor(host, ate) {
    super(`Consultas automáticas ao portal ${host} estão pausadas até ${new Date(ate).toLocaleTimeString('pt-BR')}.`, { status: 503, provider: 'raspagem' });
    this.name = 'HostPausadoError';
    this.ate = ate;
  }
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/** Estado compartilhado por host: fila de ritmo e disjuntor. */
function criarControleHosts({ intervaloMinimoMs, pausaMinutos, falhasParaPausar = 5, agora = Date.now }) {
  const hosts = new Map();
  const obter = (host) => {
    if (!hosts.has(host)) hosts.set(host, { fila: Promise.resolve(), ultimo: 0, pausadoAte: 0, falhas: 0, motivo: null });
    return hosts.get(host);
  };

  return {
    /** Executa `fn` respeitando o intervalo mínimo entre requisições ao host. */
    agendar(host, fn) {
      const h = obter(host);
      const execucao = h.fila.then(async () => {
        if (h.pausadoAte > agora()) throw new HostPausadoError(host, h.pausadoAte);
        const aguardar = h.ultimo + intervaloMinimoMs - agora();
        if (aguardar > 0) await espera(aguardar);
        h.ultimo = agora();
        return fn();
      });
      // A fila continua mesmo que esta execução falhe.
      h.fila = execucao.catch(() => {});
      return execucao;
    },
    sucesso(host) {
      obter(host).falhas = 0;
    },
    falha(host) {
      const h = obter(host);
      h.falhas += 1;
      if (h.falhas >= falhasParaPausar) this.pausar(host, 'falhas consecutivas');
    },
    pausar(host, motivo) {
      const h = obter(host);
      h.pausadoAte = agora() + pausaMinutos * 60000;
      h.motivo = motivo;
      h.falhas = 0;
    },
    estado() {
      return [...hosts.entries()].map(([host, h]) => ({
        host,
        pausadoAte: h.pausadoAte > agora() ? new Date(h.pausadoAte).toISOString() : null,
        motivo: h.pausadoAte > agora() ? h.motivo : null,
      }));
    },
  };
}

function decodificar(buffer, contentType) {
  const charset = /charset=([^;]+)/i.exec(contentType || '')?.[1]?.trim().toLowerCase() || 'utf-8';
  try {
    return new TextDecoder(charset).decode(buffer);
  } catch {
    return new TextDecoder('utf-8').decode(buffer);
  }
}

/**
 * Cria uma sessão (cookie jar próprio). Use uma sessão por consulta para não
 * misturar estados entre usuários.
 */
function criarSessao({ controle, userAgent, timeoutMs = 20000, tentativas = 3, esperaBaseMs = 1000, detectarCaptcha }) {
  const cookies = new Map(); // host -> Map(nome -> valor)

  const guardarCookies = (host, headers) => {
    const lista = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
    if (!lista.length) return;
    if (!cookies.has(host)) cookies.set(host, new Map());
    for (const c of lista) {
      const [par] = c.split(';');
      const i = par.indexOf('=');
      if (i > 0) cookies.get(host).set(par.slice(0, i).trim(), par.slice(i + 1).trim());
    }
  };
  const cabecalhoCookie = (host) => [...(cookies.get(host) || new Map()).entries()].map(([k, v]) => `${k}=${v}`).join('; ');

  async function umaRequisicao(url, { method, body, headers }) {
    let atual = new URL(url);
    let metodo = method;
    let corpo = body;
    for (let saltos = 0; saltos < 6; saltos++) {
      const host = atual.host;
      const res = await fetch(atual, {
        method: metodo,
        redirect: 'manual',
        body: corpo,
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          'User-Agent': userAgent,
          Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
          'Accept-Language': 'pt-BR,pt;q=0.9',
          ...(cabecalhoCookie(host) ? { Cookie: cabecalhoCookie(host) } : {}),
          ...headers,
        },
      });
      guardarCookies(host, res.headers);
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        atual = new URL(res.headers.get('location'), atual);
        if (res.status !== 307 && res.status !== 308) { metodo = 'GET'; corpo = undefined; }
        continue;
      }
      const html = decodificar(await res.arrayBuffer(), res.headers.get('content-type'));
      return { status: res.status, url: atual.toString(), html };
    }
    throw new ProviderError('Excesso de redirecionamentos no portal do tribunal', { provider: 'raspagem' });
  }

  return {
    /** GET/POST que retorna { status, url (final), html }. */
    async obter(url, { method = 'GET', body, headers = {} } = {}) {
      const host = new URL(url).host;
      return controle.agendar(host, async () => {
        let ultimoErro;
        for (let t = 0; t < tentativas; t++) {
          try {
            const r = await umaRequisicao(url, { method, body, headers });
            if (r.status === 429 || r.status >= 500) {
              ultimoErro = new ProviderError(`Portal ${host} respondeu HTTP ${r.status}`, { status: 502, provider: 'raspagem' });
              await espera(esperaBaseMs * 2 ** t);
              continue;
            }
            if (detectarCaptcha && detectarCaptcha(r.html)) {
              controle.pausar(host, 'CAPTCHA');
              throw new CaptchaError(host);
            }
            controle.sucesso(host);
            return r;
          } catch (err) {
            if (err instanceof CaptchaError) throw err;
            ultimoErro = err instanceof ProviderError ? err : new ProviderError(
              `Falha ao acessar ${host}: ${err.name === 'TimeoutError' ? 'tempo esgotado' : err.cause?.code || err.message}`,
              { status: 504, provider: 'raspagem' },
            );
            await espera(esperaBaseMs * 2 ** t);
          }
        }
        controle.falha(host);
        throw ultimoErro;
      });
    },
  };
}

module.exports = { criarControleHosts, criarSessao, CaptchaError, HostPausadoError, decodificar };
