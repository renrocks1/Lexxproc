'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const fx = (nome) => fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'esaj', nome), 'utf8');

/** Servidor que imita o e-SAJ: exige sessão no AJAX, redireciona na busca por número, pagina. */
function portalSimulado({ captcha = false } = {}) {
  const log = [];
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    log.push(`${u.pathname}${u.search}`);
    const temSessao = /JSESSIONID=abc/.test(req.headers.cookie || '');
    const html = (corpo) => { res.writeHead(200, { 'Content-Type': 'text/html;charset=UTF-8' }); res.end(corpo); };
    if (captcha) return html(fx('captcha.html'));
    if (u.pathname === '/cpopg/search.do' && u.searchParams.get('cbPesquisa') === 'NUMPROC') {
      res.writeHead(302, { Location: '/cpopg/show.do?processo.codigo=1H00112CM0000&processo.foro=100', 'Set-Cookie': 'JSESSIONID=abc; Path=/cpopg; HttpOnly' });
      return res.end();
    }
    if (u.pathname === '/cpopg/show.do') return html(fx('detalhe-tjsp.html'));
    if (u.pathname === '/cpopg/carregarMovimentacoesAjax.do') {
      if (!temSessao) return html('<div class="mensagemErroMovimentacoes">Não foi possível realizar a operação requisitada, tente novamente mais tarde.</div>');
      return html(u.searchParams.get('cursor') === 'Y3Vyc29yLTI' ? fx('movs-ajax-2.html') : fx('movs-ajax-1.html'));
    }
    if (u.pathname === '/cpopg/search.do') {
      const v = u.searchParams.get('dadosConsulta.valorConsulta');
      if (/^Muitos/.test(v)) return html(fx('lista-muitos.html'));
      if (v === 'Ninguem') return html(fx('lista-vazia.html'));
      return html(fx('lista.html').replaceAll('https://esaj.tjsp.jus.br', ''));
    }
    if (u.pathname === '/cpopg/trocarPagina.do') return html(fx('lista.html').replace(/<ul class="unj-pagination">.*?<\/ul>/s, ''));
    res.writeHead(404);
    return res.end();
  });
  return new Promise((r) => server.listen(0, () => r({ server, log, base: `http://127.0.0.1:${server.address().port}/cpopg` })));
}

module.exports = { portalSimulado, fx };
