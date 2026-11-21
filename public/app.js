/* Lexxproc — frontend SPA (sem dependências) */
(() => {
  'use strict';

  const $app = document.getElementById('app');
  const estado = { status: null, tribunais: null };

  // ---------------------------------------------------------------- utilidades
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function html(strings, ...vals) {
    return strings.reduce((acc, s, i) => {
      if (i === 0) return s;
      const v = vals[i - 1];
      const out = v && v.__html !== undefined ? v.__html
        : Array.isArray(v) ? v.map((x) => (x && x.__html !== undefined ? x.__html : esc(x))).join('')
          : esc(v);
      return acc + out + s;
    }, '');
  }
  const raw = (s) => ({ __html: s });

  function fmtData(iso, comHora = false) {
    if (!iso) return '—';
    const d = new Date(iso.length <= 10 ? `${iso}T12:00:00` : iso);
    if (Number.isNaN(d.getTime())) return iso;
    const data = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    if (!comHora) return data;
    const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return hora === '00:00' ? data : `${data} ${hora}`;
  }

  function relativo(iso) {
    if (!iso) return '';
    const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    if (dias < 1) return 'hoje';
    if (dias === 1) return 'ontem';
    if (dias < 30) return `há ${dias} dias`;
    if (dias < 365) return `há ${Math.floor(dias / 30)} ${Math.floor(dias / 30) === 1 ? 'mês' : 'meses'}`;
    const anos = Math.floor(dias / 365);
    return `há ${anos} ${anos === 1 ? 'ano' : 'anos'}`;
  }

  function fmtCNJ(d) {
    const s = String(d || '').replace(/\D/g, '');
    return s.length === 20 ? `${s.slice(0, 7)}-${s.slice(7, 9)}.${s.slice(9, 13)}.${s.slice(13, 14)}.${s.slice(14, 16)}.${s.slice(16)}` : d;
  }

  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, 2800);
  }

  async function api(caminho, opcoes = {}) {
    const headers = { Accept: 'application/json' };
    const token = localStorageSeguro('lexx-token');
    if (token) headers.Authorization = `Bearer ${token}`;
    if (opcoes.body) headers['Content-Type'] = 'application/json';
    const res = await fetch(`/api${caminho}`, { ...opcoes, headers, body: opcoes.body ? JSON.stringify(opcoes.body) : undefined });
    if (res.status === 204) return null;
    const dados = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(dados.erro || `Erro ${res.status}`);
      err.status = res.status;
      err.dados = dados;
      throw err;
    }
    return dados;
  }

  function localStorageSeguro(chave, valor) {
    try {
      if (valor === undefined) return localStorage.getItem(chave);
      if (valor === null) localStorage.removeItem(chave);
      else localStorage.setItem(chave, valor);
    } catch { /* armazenamento indisponível */ }
    return null;
  }

  const carregando = (texto = 'Consultando tribunais…') => html`<div class="carregando"><div class="spinner"></div>${texto}</div>`;
  const esqueleto = (n = 3) => Array.from({ length: n }, () => '<div class="esqueleto"></div>').join('');
  const erroBox = (e) => html`<div class="msg msg-erro">${e.message || e}</div>`;

  async function copiar(texto) {
    try {
      await navigator.clipboard.writeText(texto);
      toast('Copiado para a área de transferência');
    } catch {
      toast(texto);
    }
  }

  // Detecção de tipo no cliente (espelha a do servidor) para a dica em tempo real.
  function detectar(t) {
    const s = String(t || '').trim();
    const d = s.replace(/\D/g, '');
    const num = /^[\d.\-/\s]+$/.test(s);
    if (!s) return null;
    if (num && d.length === 20) return 'cnj';
    if (num && d.length === 11) return 'cpf';
    if (num && d.length === 14) return 'cnpj';
    if (/OAB/i.test(s) || /^\s*\d{1,7}\s*[-/]\s*[A-Za-z]{2}\s*$/.test(s) || /^\s*[A-Za-z]{2}\s*[-/]?\s*\d{3,7}\s*$/.test(s)) return 'oab';
    if (num) return 'parcial';
    return 'nome';
  }
  const ROTULOS = { cnj: 'Número CNJ', cpf: 'CPF', cnpj: 'CNPJ', oab: 'OAB', nome: 'Nome da parte' };

  function formBusca(valor = '', compacto = false) {
    return html`
      <div class="busca ${compacto ? 'busca-compacta' : ''}">
        <form class="busca-form" id="form-busca" role="search">
          <input id="q" name="q" type="search" autocomplete="off" value="${valor}" aria-label="Termo de busca"
            placeholder="Número do processo, nome, CPF/CNPJ ou OAB" ${compacto ? '' : 'autofocus'}>
          <button class="btn btn-primario" type="submit">Consultar</button>
        </form>
        ${compacto ? '' : raw('<div class="busca-dica" id="dica">Detectamos automaticamente o tipo de busca.</div>')}
      </div>`;
  }

  function ligarBusca() {
    const form = document.getElementById('form-busca');
    const input = document.getElementById('q');
    const dica = document.getElementById('dica');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = input.value.trim();
      if (!q) return input.focus();
      if (detectar(q) === 'cnj') location.hash = `#/processo/${q.replace(/\D/g, '')}`;
      else location.hash = `#/busca?q=${encodeURIComponent(q)}`;
      return null;
    });
    if (dica) {
      input.addEventListener('input', () => {
        const tipo = detectar(input.value);
        if (!tipo) dica.textContent = 'Detectamos automaticamente o tipo de busca.';
        else if (tipo === 'parcial') {
          const n = input.value.replace(/\D/g, '').length;
          dica.innerHTML = html`<span class="tag">${n} dígitos</span> Número CNJ tem 20 dígitos · CPF 11 · CNPJ 14`;
        } else dica.innerHTML = html`Buscando por <span class="tag tag-azul">${ROTULOS[tipo]}</span>`;
      });
    }
  }

  // ---------------------------------------------------------------- componentes
  function itemProcesso(p) {
    const ativo = (p.partes || []).filter((x) => x.polo === 'ativo').map((x) => x.nome);
    const passivo = (p.partes || []).filter((x) => x.polo === 'passivo').map((x) => x.nome);
    return html`
      <a class="item-processo" href="#/processo/${p.numero}">
        <div class="item-topo">
          <span class="item-numero">${p.numeroFormatado || fmtCNJ(p.numero)}</span>
          <span class="tags">
            ${p.tribunal ? raw(html`<span class="tag tag-azul">${p.tribunal.sigla}</span>`) : ''}
            ${(p.graus || []).map((g) => raw(html`<span class="tag">${g}</span>`))}
          </span>
        </div>
        <div class="item-classe">${p.classe?.nome || 'Classe não informada'}</div>
        ${ativo.length || passivo.length ? raw(html`<div class="item-partes">${ativo.join(', ') || '—'}<span class="x">×</span>${passivo.join(', ') || '—'}</div>`) : ''}
        ${p.assuntos?.length ? raw(html`<div class="item-partes">${p.assuntos.map((a) => a.nome).join(' · ')}</div>`) : ''}
        <div class="item-rodape">
          ${p.orgaoJulgador?.nome ? raw(html`<span>${p.orgaoJulgador.nome}</span>`) : ''}
          ${p.dataAjuizamento ? raw(html`<span>Ajuizado em ${fmtData(p.dataAjuizamento)}</span>`) : ''}
          ${p.ultimoMovimento ? raw(html`<span>Última mov.: ${p.ultimoMovimento.nome} (${fmtData(p.ultimoMovimento.data)})</span>`)
    : p.ultimaAtualizacao ? raw(html`<span>Atualizado ${relativo(p.ultimaAtualizacao)}</span>`) : ''}
        </div>
      </a>`;
  }

  function errosProvedores(erros) {
    if (!erros?.length) return '';
    return html`<div class="msg msg-alerta">Algumas fontes não responderam: ${erros.map((e) => `${e.provedor} (${e.mensagem})`).join('; ')}</div>`;
  }

  // ---------------------------------------------------------------- páginas
  async function paginaInicio() {
    document.title = 'Lexxproc — Consulta de Processos';
    $app.innerHTML = html`
      <section class="hero">
        <h1>Consulte processos judiciais de todo o Brasil</h1>
        <p>Pesquise pelo número CNJ, nome da parte, CPF/CNPJ ou OAB. Acompanhe movimentações e receba alertas quando algo mudar.</p>
        ${raw(formBusca())}
        <div class="exemplos" aria-label="Exemplos">
          <button type="button" data-ex="0000832-35.2018.4.01.3202">Ex.: 0000832-35.2018.4.01.3202</button>
          <button type="button" data-ex="Maria Aparecida da Silva">Ex.: nome da parte</button>
          <button type="button" data-ex="OAB 123456/SP">Ex.: OAB 123456/SP</button>
        </div>
      </section>
      <section class="historico" id="historico"></section>
      <section class="grade-3">
        <div class="card recurso"><h3><span class="ico">⚖</span>Todos os tribunais</h3>
          <p>Justiça Estadual, Federal, do Trabalho, Eleitoral, Militar e Tribunais Superiores, via DataJud/CNJ.</p></div>
        <div class="card recurso"><h3><span class="ico">🔔</span>Monitoramento</h3>
          <p>Acompanhe processos e receba alertas a cada nova movimentação, inclusive por webhook.</p></div>
        <div class="card recurso"><h3><span class="ico">🔎</span>Busca avançada</h3>
          <p>Filtre por tribunal, classe processual, órgão julgador, assunto, grau e período.</p></div>
      </section>`;
    ligarBusca();
    $app.querySelectorAll('[data-ex]').forEach((b) => b.addEventListener('click', () => {
      const input = document.getElementById('q');
      input.value = b.dataset.ex;
      input.dispatchEvent(new Event('input'));
      input.focus();
    }));
    try {
      const hist = await api('/historico');
      if (hist.length) {
        document.getElementById('historico').innerHTML = html`
          <div class="cab-pagina"><h3>Buscas recentes</h3><button class="btn btn-pequeno" id="limpar-hist" type="button">Limpar</button></div>
          <div class="historico-lista">${hist.map((h) => raw(html`
            <a href="${h.tipo === 'cnj' ? `#/processo/${h.termo.replace(/\D/g, '')}` : `#/busca?q=${encodeURIComponent(h.termo)}`}">
              <span class="tag">${ROTULOS[h.tipo] || h.tipo}</span>${h.termo}</a>`))}</div>`;
        document.getElementById('limpar-hist').addEventListener('click', async () => {
          await api('/historico', { method: 'DELETE' });
          document.getElementById('historico').innerHTML = '';
        });
      }
    } catch { /* histórico é opcional */ }
  }

  async function paginaBusca(params) {
    const q = params.get('q') || '';
    document.title = `${q} — Lexxproc`;
    $app.innerHTML = html`${raw(formBusca(q, true))}<div id="res">${raw(esqueleto(4))}</div>`;
    ligarBusca();
    const $res = document.getElementById('res');
    try {
      const r = await api(`/busca?q=${encodeURIComponent(q)}${params.get('atualizar') ? '&atualizar=1' : ''}`);
      if (r.tipo === 'cnj') {
        location.replace(`#/processo/${r.termo.replace(/\D/g, '')}`);
        return;
      }
      $res.innerHTML = html`
        <div class="cab-pagina">
          <div><h2>${r.total} processo${r.total === 1 ? '' : 's'} encontrado${r.total === 1 ? '' : 's'}</h2>
            <p>Busca por <span class="tag tag-azul">${ROTULOS[r.tipo]}</span> <b>${r.termo}</b>${r.cache ? raw(' <span class="tag">em cache</span>') : ''}</p></div>
          <a class="btn btn-pequeno" href="#/busca?q=${encodeURIComponent(q)}&atualizar=1">Atualizar</a>
        </div>
        ${raw(errosProvedores(r.erros))}
        ${r.total ? raw(html`<div class="lista-processos">${r.resultados.map((p) => raw(itemProcesso(p)))}</div>`)
    : raw('<div class="vazio card"><div class="icone">🗂</div><p>Nenhum processo encontrado para este termo.</p></div>')}`;
    } catch (e) {
      $res.innerHTML = html`${raw(erroBox(e))}${e.status === 501 ? raw(html`
        <div class="card"><h3>Como habilitar este tipo de busca</h3>
        <p class="mudo">A API pública do CNJ não divulga as partes dos processos. Para buscar por nome, CPF/CNPJ ou OAB,
        configure um provedor no servidor (variáveis <span class="mono">ESCAVADOR_TOKEN</span> ou <span class="mono">JUDIT_API_KEY</span>).
        Enquanto isso, pesquise pelo número do processo ou use a <a href="#/avancada">busca avançada</a>.</p></div>`) : ''}`;
    }
  }

  async function paginaProcesso(numero, params) {
    document.title = `${fmtCNJ(numero)} — Lexxproc`;
    $app.innerHTML = html`<a class="voltar" href="#/" data-voltar>← Voltar</a>${raw(carregando())}`;
    let r;
    try {
      r = await api(`/processos/${numero}${params.get('atualizar') ? '?atualizar=1' : ''}`);
    } catch (e) {
      let decomp = '';
      try { decomp = blocoCNJ(await api(`/cnj/${numero}`)); } catch { /* ignora */ }
      $app.innerHTML = html`
        <a class="voltar" href="#/">← Nova consulta</a>
        <div class="card"><h1 class="proc-numero">${fmtCNJ(numero)}</h1>${raw(erroBox(e))}${raw(errosProvedores(e.dados?.erros))}${raw(decomp)}</div>`;
      return;
    }
    renderProcesso(r);
  }

  function blocoCNJ(info) {
    if (!info) return '';
    return html`
      <h3>Decomposição do número</h3>
      <div class="cnj-decomp">
        <span>${info.sequencial}<small>Sequencial</small></span>
        <span>${info.dv}<small>Dígito ${info.valido ? '✓' : '✗'}</small></span>
        <span>${info.ano}<small>Ano</small></span>
        <span>${info.j}<small>Justiça</small></span>
        <span>${info.tr}<small>Tribunal</small></span>
        <span>${info.origem}<small>Origem</small></span>
      </div>
      <p class="mudo">${info.tribunal ? `${info.tribunal.nome} — ${info.tribunal.segmento}` : 'Tribunal não identificado'}${info.valido ? '' : ` · dígito verificador esperado: ${info.dvEsperado}`}</p>`;
  }

  function renderProcesso(r) {
    const p = r.processo;
    let monitorado = r.monitorado;
    const ativos = p.partes.filter((x) => x.polo === 'ativo');
    const passivos = p.partes.filter((x) => x.polo === 'passivo');
    const outros = p.partes.filter((x) => x.polo === 'outros');
    const titulo = ativos.length || passivos.length
      ? `${ativos.map((x) => x.nome).join(', ') || '—'} × ${passivos.map((x) => x.nome).join(', ') || '—'}` : null;
    document.title = `${p.numeroFormatado} — Lexxproc`;

    $app.innerHTML = html`
      <a class="voltar" href="#/" data-voltar>← Voltar</a>
      <div class="card">
        <div class="proc-cab">
          <div>
            <div class="tags">
              ${p.tribunal ? raw(html`<span class="tag tag-azul" title="${p.tribunal.nome}">${p.tribunal.sigla}</span>`) : ''}
              ${p.graus.map((g) => raw(html`<span class="tag">${g}</span>`))}
              ${p.situacao ? raw(html`<span class="tag ${/baixad|arquiv/i.test(p.situacao) ? 'tag-laranja' : 'tag-verde'}">${p.situacao}</span>`) : ''}
              ${p.nivelSigilo ? raw('<span class="tag tag-vermelha">Sigilo</span>') : ''}
              ${r.cache ? raw(html`<span class="tag" title="Dados armazenados localmente">${r.desatualizado ? 'Versão salva (fontes indisponíveis)' : 'Cache'}</span>`) : ''}
            </div>
            <h1 class="proc-numero">${p.numeroFormatado}
              <button class="copiar" type="button" data-copiar="${p.numeroFormatado}">Copiar</button></h1>
            <div class="proc-sub">${p.classe?.nome || 'Classe não informada'}${titulo ? raw(html`<br><b>${titulo}</b>`) : ''}</div>
          </div>
          <div class="acoes">
            <button class="btn ${monitorado ? 'btn-ativo' : 'btn-primario'}" id="btn-monitorar" type="button">${monitorado ? '✓ Monitorando' : '🔔 Monitorar'}</button>
            <a class="btn" href="#/processo/${p.numero}?atualizar=1">↻ Atualizar</a>
            <button class="btn" type="button" data-copiar="${location.origin}/#/processo/${p.numero}">Compartilhar</button>
          </div>
        </div>
        <dl class="resumo-grade">
          <div><dt>Ajuizamento</dt><dd>${fmtData(p.dataAjuizamento)}</dd></div>
          <div><dt>Última movimentação</dt><dd>${fmtData(p.movimentos[0]?.data)} <span class="mudo">${relativo(p.movimentos[0]?.data)}</span></dd></div>
          <div><dt>Órgão julgador</dt><dd>${p.orgaoJulgador?.nome || '—'}</dd></div>
          <div><dt>Valor da causa</dt><dd>${p.valorCausa || '—'}</dd></div>
        </dl>
        ${raw(errosProvedores(r.erros))}
        <div class="abas" role="tablist">
          <button role="tab" aria-selected="true" data-aba="mov">Movimentações <span class="cont">${p.movimentos.length}</span></button>
          <button role="tab" aria-selected="false" data-aba="partes">Partes <span class="cont">${p.partes.length}</span></button>
          <button role="tab" aria-selected="false" data-aba="det">Detalhes</button>
        </div>
        <div id="aba-mov"></div>
        <div id="aba-partes" hidden></div>
        <div id="aba-det" hidden></div>
      </div>`;

    // Movimentações
    const graus = [...new Set(p.movimentos.map((m) => m.grau).filter(Boolean))];
    document.getElementById('aba-mov').innerHTML = p.movimentos.length ? html`
      <div class="filtro-mov">
        <input id="filtro" type="search" placeholder="Filtrar movimentações (ex.: sentença, audiência, conclusão)" aria-label="Filtrar movimentações">
        ${graus.length > 1 ? raw(html`<select id="filtro-grau" aria-label="Grau"><option value="">Todos os graus</option>${graus.map((g) => raw(html`<option>${g}</option>`))}</select>`) : ''}
      </div>
      <ol class="linha-tempo" id="linha"></ol>`
      : raw('<div class="vazio"><p>Nenhuma movimentação disponível.</p></div>');

    const desenharLinha = () => {
      const termo = (document.getElementById('filtro')?.value || '').toLowerCase();
      const grau = document.getElementById('filtro-grau')?.value || '';
      const lista = p.movimentos.filter((m) => (!grau || m.grau === grau)
        && (!termo || `${m.nome} ${(m.complementos || []).join(' ')}`.toLowerCase().includes(termo)));
      let ano = null;
      const partes = lista.map((m, i) => {
        const a = m.data ? m.data.slice(0, 4) : '—';
        const sep = a !== ano ? `<li class="ano-sep">${esc(a)}</li>` : '';
        ano = a;
        const destaque = /senten|julg|proced|acórd|decis|tutela|liminar|trânsito/i.test(m.nome);
        return sep + html`
          <li class="mov ${destaque || i === 0 ? 'destaque' : ''}">
            <div class="mov-data">${fmtData(m.data)}<small>${m.data && m.data.length > 10 && !/T00:00/.test(m.data) ? new Date(m.data).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''}</small></div>
            <div class="mov-eixo"></div>
            <div class="mov-corpo">
              <div class="mov-nome">${m.nome}</div>
              ${m.complementos?.length ? raw(html`<div class="mov-comp">${m.complementos.join(' · ')}</div>`) : ''}
              ${m.orgao || m.grau || m.codigo ? raw(html`<div class="mov-meta">${[m.orgao, m.grau, m.codigo ? `TPU ${m.codigo}` : null].filter(Boolean).join(' · ')}</div>`) : ''}
            </div>
          </li>`;
      });
      document.getElementById('linha').innerHTML = partes.join('') || '<li class="vazio">Nenhuma movimentação corresponde ao filtro.</li>';
    };
    if (p.movimentos.length) {
      desenharLinha();
      document.getElementById('filtro').addEventListener('input', desenharLinha);
      document.getElementById('filtro-grau')?.addEventListener('change', desenharLinha);
    }

    // Partes
    const blocoPolo = (rotulo, lista) => html`
      <div class="polo"><h3>${rotulo}</h3>${lista.length ? lista.map((x) => raw(html`
        <div class="parte">
          <div class="parte-nome">${x.nome}</div>
          ${x.tipo || x.documento ? raw(html`<div class="mudo">${[x.tipo, x.documento].filter(Boolean).join(' · ')}</div>`) : ''}
          ${(x.advogados || []).map((a) => raw(html`<div class="parte-adv">Adv.: ${a.nome}${a.oab ? ` — OAB ${a.oab}` : ''}</div>`))}
        </div>`)) : raw('<p class="mudo">Não informado</p>')}</div>`;
    document.getElementById('aba-partes').innerHTML = p.partes.length ? html`
      <div class="partes-grade">${raw(blocoPolo('Polo ativo', ativos))}${raw(blocoPolo('Polo passivo', passivos))}</div>
      ${outros.length ? raw(html`<div class="partes-grade" style="margin-top:16px">${raw(blocoPolo('Outros participantes', outros))}</div>`) : ''}`
      : html`<div class="msg msg-info">A API pública do CNJ (DataJud) não divulga as partes dos processos.
        Configure um provedor como Escavador ou Judit no servidor para exibir partes e advogados.</div>`;

    // Detalhes
    const linhas = [
      ['Número', p.numeroFormatado],
      ['Tribunal', p.tribunal ? `${p.tribunal.nome} (${p.tribunal.sigla})` : null],
      ['Segmento', p.tribunal?.segmento],
      ['Classe', p.classe ? `${p.classe.nome}${p.classe.codigo ? ` (código ${p.classe.codigo})` : ''}` : null],
      ['Assuntos', p.assuntos.map((a) => `${a.nome}${a.codigo ? ` (${a.codigo})` : ''}`).join('; ')],
      ['Órgão julgador', p.orgaoJulgador ? `${p.orgaoJulgador.nome}${p.orgaoJulgador.codigo ? ` (código ${p.orgaoJulgador.codigo})` : ''}` : null],
      ['Graus', p.graus.join(', ')],
      ['Data de ajuizamento', fmtData(p.dataAjuizamento, true)],
      ['Última atualização na fonte', fmtData(p.ultimaAtualizacao, true)],
      ['Sistema', p.sistema],
      ['Formato', p.formato],
      ['Valor da causa', p.valorCausa],
      ['Nível de sigilo', String(p.nivelSigilo ?? 0)],
      ['Fontes consultadas', p.fontes.join(', ')],
    ].filter(([, v]) => v && v !== '—');
    document.getElementById('aba-det').innerHTML = html`
      <dl class="detalhes">${linhas.map(([k, v]) => raw(html`<dt>${k}</dt><dd>${v}</dd>`))}</dl>
      <div id="decomp"></div>`;
    api(`/cnj/${p.numero}`).then((info) => { document.getElementById('decomp').innerHTML = blocoCNJ(info); }).catch(() => {});

    // Abas
    $app.querySelectorAll('[data-aba]').forEach((b) => b.addEventListener('click', () => {
      $app.querySelectorAll('[data-aba]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      ['mov', 'partes', 'det'].forEach((id) => { document.getElementById(`aba-${id}`).hidden = id !== b.dataset.aba; });
    }));
    $app.querySelectorAll('[data-copiar]').forEach((b) => b.addEventListener('click', () => copiar(b.dataset.copiar)));

    const btn = document.getElementById('btn-monitorar');
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        if (monitorado) {
          await api(`/monitorados/${p.numero}`, { method: 'DELETE' });
          monitorado = false;
          toast('Processo removido do monitoramento');
        } else {
          await api('/monitorados', { method: 'POST', body: { numero: p.numero } });
          monitorado = true;
          toast('Você será alertado sobre novas movimentações');
        }
        btn.className = `btn ${monitorado ? 'btn-ativo' : 'btn-primario'}`;
        btn.textContent = monitorado ? '✓ Monitorando' : '🔔 Monitorar';
      } catch (e) {
        toast(e.message);
      } finally {
        btn.disabled = false;
      }
    });
  }

  async function paginaAvancada(params) {
    document.title = 'Busca avançada — Lexxproc';
    const tribunais = estado.tribunais || (estado.tribunais = await api('/tribunais'));
    const v = (k) => params.get(k) || '';
    const segmentos = [...new Set(tribunais.map((t) => t.segmento))];
    $app.innerHTML = html`
      <div class="cab-pagina"><div><h1>Busca avançada</h1>
        <p>Pesquise por metadados processuais diretamente na base do DataJud/CNJ. Códigos seguem as Tabelas Processuais Unificadas (TPU) do CNJ.</p></div></div>
      <form class="card" id="form-av">
        <div class="form-grade">
          <div class="campo largo"><label for="tribunal">Tribunal *</label>
            <select id="tribunal" name="tribunal" required>
              <option value="">Selecione…</option>
              ${segmentos.map((s) => raw(html`<optgroup label="${s}">${tribunais.filter((t) => t.segmento === s && t.disponivelDataJud)
    .map((t) => raw(html`<option value="${t.sigla}" ${v('tribunal') === t.sigla ? 'selected' : ''}>${t.sigla} — ${t.nome}</option>`))}</optgroup>`))}
            </select></div>
          <div class="campo"><label for="classe">Código da classe</label><input id="classe" name="classe" inputmode="numeric" placeholder="ex.: 7" value="${v('classe')}"></div>
          <div class="campo"><label for="assunto">Código do assunto</label><input id="assunto" name="assunto" inputmode="numeric" placeholder="ex.: 7779" value="${v('assunto')}"></div>
          <div class="campo"><label for="orgao">Código do órgão julgador</label><input id="orgao" name="orgao" inputmode="numeric" value="${v('orgao')}"></div>
          <div class="campo"><label for="grau">Grau</label>
            <select id="grau" name="grau"><option value="">Todos</option>
              ${['G1', 'G2', 'JE', 'TR', 'SUP'].map((g) => raw(html`<option ${v('grau') === g ? 'selected' : ''}>${g}</option>`))}</select></div>
          <div class="campo"><label for="inicio">Ajuizado de</label><input id="inicio" name="inicio" type="date" value="${v('inicio')}"></div>
          <div class="campo"><label for="fim">Ajuizado até</label><input id="fim" name="fim" type="date" value="${v('fim')}"></div>
        </div>
        <div class="acoes" style="margin-top:16px"><button class="btn btn-primario" type="submit">Pesquisar</button>
          <a class="btn" href="#/avancada">Limpar</a></div>
      </form>
      <div id="res-av" style="margin-top:20px"></div>`;

    document.getElementById('form-av').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new URLSearchParams([...new FormData(e.target)].filter(([, val]) => val));
      location.hash = `#/avancada?${fd}`;
    });

    if (!v('tribunal')) return;
    const $res = document.getElementById('res-av');
    $res.innerHTML = esqueleto(4);
    try {
      const r = await api(`/busca-avancada?${params}`);
      const prox = new URLSearchParams(params);
      if (r.proximoCursor) prox.set('cursor', r.proximoCursor);
      $res.innerHTML = html`
        <div class="cab-pagina"><h2>${r.total >= 10000 ? 'Mais de 10.000' : r.total.toLocaleString('pt-BR')} resultado(s)</h2></div>
        ${r.resultados.length ? raw(html`<div class="lista-processos">${r.resultados.map((p) => raw(itemProcesso(p)))}</div>`)
    : raw('<div class="vazio card"><p>Nenhum processo encontrado com esses filtros.</p></div>')}
        ${r.proximoCursor ? raw(html`<div class="acoes" style="margin-top:16px;justify-content:center"><a class="btn" href="#/avancada?${prox}">Próxima página →</a></div>`) : ''}`;
    } catch (e) {
      $res.innerHTML = erroBox(e);
    }
  }

  async function paginaMonitorados() {
    document.title = 'Monitorados — Lexxproc';
    $app.innerHTML = carregando('Carregando…');
    let lista;
    try { lista = await api('/monitorados'); } catch (e) { $app.innerHTML = erroBox(e); return; }
    $app.innerHTML = html`
      <div class="cab-pagina">
        <div><h1>Processos monitorados</h1><p>${lista.length} processo(s). Verificação automática a cada ${estado.status?.monitoramento?.intervaloMinutos || 360} minutos.</p></div>
        ${lista.length ? raw('<button class="btn" id="verificar-todos" type="button">↻ Verificar todos agora</button>') : ''}
      </div>
      ${lista.length ? raw(html`<div class="tabela-wrap"><table>
        <thead><tr><th>Processo</th><th>Apelido</th><th>Última movimentação</th><th>Verificado</th><th></th></tr></thead>
        <tbody>${lista.map((m) => raw(html`
          <tr data-numero="${m.numero}">
            <td><a class="mono" href="#/processo/${m.numero}">${fmtCNJ(m.numero)}</a><br>
              <span class="mudo">${[m.tribunal, m.classe].filter(Boolean).join(' · ')}</span></td>
            <td><input class="apelido" value="${m.apelido || ''}" placeholder="Ex.: Cliente X" aria-label="Apelido" maxlength="120"></td>
            <td>${fmtData(m.ultima_movimentacao)}<br><span class="mudo">${m.total_movimentos} movimentos</span></td>
            <td>${fmtData(m.ultima_verificacao, true)}${m.ultimo_erro ? raw(html`<br><span class="tag tag-vermelha" title="${m.ultimo_erro}">falha</span>`) : ''}</td>
            <td><div class="acoes"><button class="btn btn-pequeno" data-acao="verificar" type="button">Verificar</button>
              <button class="btn btn-pequeno btn-perigo" data-acao="remover" type="button">Remover</button></div></td>
          </tr>`))}</tbody></table></div>`)
    : raw('<div class="vazio card"><div class="icone">🔔</div><p>Você ainda não monitora nenhum processo.</p><p class="mudo">Abra um processo e clique em “Monitorar”.</p></div>')}`;

    document.getElementById('verificar-todos')?.addEventListener('click', async (e) => {
      e.target.disabled = true;
      e.target.textContent = 'Verificando…';
      try {
        const r = await api('/monitoramento/executar', { method: 'POST' });
        toast(r.ignorado ? 'Já existe uma verificação em andamento' : `${r.novidades} nova(s) movimentação(ões)`);
        atualizarBadge();
        paginaMonitorados();
      } catch (err) { toast(err.message); e.target.disabled = false; }
    });
    $app.querySelectorAll('tr[data-numero]').forEach((tr) => {
      const numero = tr.dataset.numero;
      tr.querySelector('.apelido').addEventListener('change', async (e) => {
        try { await api(`/monitorados/${numero}`, { method: 'PATCH', body: { apelido: e.target.value } }); toast('Apelido salvo'); } catch (err) { toast(err.message); }
      });
      tr.querySelector('[data-acao="verificar"]').addEventListener('click', async (e) => {
        e.target.disabled = true;
        try {
          const r = await api(`/monitorados/${numero}/verificar`, { method: 'POST' });
          toast(r.novos ? `${r.novos} nova(s) movimentação(ões)!` : 'Nenhuma novidade');
          atualizarBadge();
          paginaMonitorados();
        } catch (err) { toast(err.message); e.target.disabled = false; }
      });
      tr.querySelector('[data-acao="remover"]').addEventListener('click', async () => {
        if (!confirm(`Deixar de monitorar ${fmtCNJ(numero)}?`)) return;
        await api(`/monitorados/${numero}`, { method: 'DELETE' });
        tr.remove();
        toast('Removido');
      });
    });
  }

  async function paginaAlertas() {
    document.title = 'Alertas — Lexxproc';
    $app.innerHTML = carregando('Carregando…');
    let r;
    try { r = await api('/alertas'); } catch (e) { $app.innerHTML = erroBox(e); return; }
    $app.innerHTML = html`
      <div class="cab-pagina"><div><h1>Alertas</h1><p>${r.naoLidos} não lido(s)</p></div>
        ${r.naoLidos ? raw('<button class="btn" id="ler-todos" type="button">Marcar todos como lidos</button>') : ''}</div>
      ${r.alertas.length ? raw(html`<div class="card" style="padding:0;overflow:hidden">${r.alertas.map((a) => raw(html`
        <div class="alerta-item ${a.lido ? '' : 'nao-lido'}" data-id="${a.id}">
          <span class="alerta-ponto"></span>
          <div class="alerta-corpo">
            <div><b>${a.titulo}</b></div>
            ${a.detalhe ? raw(html`<div class="mudo">${a.detalhe}</div>`) : ''}
            <div class="mov-meta"><a class="mono" href="#/processo/${a.numero}">${fmtCNJ(a.numero)}</a>${a.apelido ? ` · ${a.apelido}` : ''}
              · movimento em ${fmtData(a.data_evento, true)} · detectado ${relativo(a.criado_em)}</div>
          </div>
          ${a.lido ? '' : raw('<button class="btn btn-pequeno" data-ler type="button">Lido</button>')}
        </div>`))}</div>`)
    : raw('<div class="vazio card"><div class="icone">📭</div><p>Nenhum alerta por enquanto.</p><p class="mudo">Alertas aparecem quando um processo monitorado recebe novas movimentações.</p></div>')}`;
    document.getElementById('ler-todos')?.addEventListener('click', async () => {
      await api('/alertas/lidos', { method: 'POST' });
      atualizarBadge();
      paginaAlertas();
    });
    $app.querySelectorAll('[data-ler]').forEach((b) => b.addEventListener('click', async () => {
      const item = b.closest('.alerta-item');
      await api(`/alertas/${item.dataset.id}/lido`, { method: 'POST' });
      item.classList.remove('nao-lido');
      b.remove();
      atualizarBadge();
    }));
  }

  async function paginaTribunais() {
    document.title = 'Tribunais — Lexxproc';
    const tribunais = estado.tribunais || (estado.tribunais = await api('/tribunais'));
    const segmentos = [...new Set(tribunais.map((t) => t.segmento))];
    $app.innerHTML = html`
      <div class="cab-pagina"><div><h1>Tribunais cobertos</h1>
        <p>${tribunais.filter((t) => t.disponivelDataJud).length} tribunais disponíveis via API Pública do DataJud. O código J.TR identifica o tribunal no número CNJ.</p></div></div>
      ${segmentos.map((s) => raw(html`<section class="segmento"><h2>${s}</h2><div class="trib-grade">
        ${tribunais.filter((t) => t.segmento === s).map((t) => raw(html`
          <div class="trib"><b>${t.sigla} ${t.disponivelDataJud ? '' : raw('<span class="tag tag-laranja">indisponível</span>')}</b>
            <span>${t.nome}</span><br><span class="mono mudo">J.TR ${t.j}.${t.tr}</span></div>`))}
      </div></section>`))}`;
  }

  // ---------------------------------------------------------------- roteador
  async function atualizarBadge() {
    try {
      const r = await api('/alertas?naoLidos=1&limite=1');
      const b = document.getElementById('badge-alertas');
      b.hidden = !r.naoLidos;
      b.textContent = r.naoLidos > 99 ? '99+' : r.naoLidos;
    } catch { /* ignora */ }
  }

  async function rotear() {
    const hash = location.hash.slice(1) || '/';
    const [caminho, qs] = hash.split('?');
    const params = new URLSearchParams(qs || '');
    const partes = caminho.split('/').filter(Boolean);
    const rota = partes[0] || 'inicio';
    document.querySelectorAll('.menu a').forEach((a) => {
      a.classList.toggle('ativo', a.dataset.rota === (rota === 'busca' || rota === 'processo' ? 'inicio' : rota));
    });
    window.scrollTo(0, 0);
    try {
      if (rota === 'inicio') await paginaInicio();
      else if (rota === 'busca') await paginaBusca(params);
      else if (rota === 'processo' && partes[1]) await paginaProcesso(partes[1], params);
      else if (rota === 'avancada') await paginaAvancada(params);
      else if (rota === 'monitorados') await paginaMonitorados();
      else if (rota === 'alertas') await paginaAlertas();
      else if (rota === 'tribunais') await paginaTribunais();
      else $app.innerHTML = '<div class="vazio"><div class="icone">🧭</div><p>Página não encontrada.</p><a href="#/">Voltar ao início</a></div>';
    } catch (e) {
      $app.innerHTML = erroBox(e);
    }
  }

  // ---------------------------------------------------------------- tema e init
  function aplicarTema(t) {
    if (t) document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
  }
  aplicarTema(localStorageSeguro('lexx-tema'));
  document.getElementById('tema').addEventListener('click', () => {
    const escuro = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === 'dark'
      : matchMedia('(prefers-color-scheme: dark)').matches;
    const novo = escuro ? 'light' : 'dark';
    aplicarTema(novo);
    localStorageSeguro('lexx-tema', novo);
  });

  document.addEventListener('click', (e) => {
    const voltar = e.target.closest('[data-voltar]');
    if (voltar && history.length > 1) {
      e.preventDefault();
      history.back();
    }
  });
  window.addEventListener('hashchange', rotear);
  api('/status').then((s) => {
    estado.status = s;
    document.getElementById('aviso-demo').hidden = !s.modoDemonstracao;
  }).catch(() => {});
  atualizarBadge();
  setInterval(atualizarBadge, 120000);
  rotear();
})();
