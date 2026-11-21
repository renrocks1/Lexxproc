'use strict';

const crypto = require('node:crypto');
const { chaveMovimento } = require('../lib/modelo');

/**
 * Monitoramento ("push") de processos: verifica periodicamente cada processo
 * acompanhado, compara as movimentações com a última verificação e gera
 * alertas (e opcionalmente dispara um webhook) quando há novidades.
 */
function criarMonitor({ busca, repo, config, logger = console }) {
  let timer = null;
  let rodando = false;

  const assinatura = (movs) => crypto.createHash('sha1')
    .update(movs.map(chaveMovimento).join('\n')).digest('hex');

  function estado(processo) {
    return {
      numero: processo.numero,
      tribunal: processo.tribunal?.sigla || null,
      classe: processo.classe?.nome || null,
      totalMovimentos: processo.movimentos.length,
      assinatura: assinatura(processo.movimentos),
      ultimaMovimentacao: processo.movimentos[0]?.data || null,
    };
  }

  async function adicionar(numero, apelido) {
    const { processo } = await busca.buscarProcesso(numero);
    if (!processo) {
      const err = new Error('Processo não encontrado nas fontes consultadas.');
      err.status = 404;
      throw err;
    }
    if (repo.obterMonitorado(processo.numero)) {
      if (apelido !== undefined) repo.renomearMonitorado(processo.numero, apelido);
      return repo.obterMonitorado(processo.numero);
    }
    repo.inserirMonitorado({ ...estado(processo), apelido });
    return repo.obterMonitorado(processo.numero);
  }

  async function notificarWebhook(payload) {
    if (!config.monitor.webhookUrl) return;
    try {
      await fetch(config.monitor.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });
    } catch (err) {
      logger.warn(`[monitor] webhook falhou: ${err.message}`);
    }
  }

  /** Verifica um processo monitorado; retorna a lista de movimentos novos. */
  async function verificar(numero) {
    const anterior = repo.obterMonitorado(numero);
    if (!anterior) return [];
    let processo;
    try {
      ({ processo } = await busca.buscarProcesso(numero, { atualizar: true }));
    } catch (err) {
      repo.registrarErroMonitorado(numero, err.message);
      return [];
    }
    if (!processo) {
      repo.registrarErroMonitorado(numero, 'Processo não retornado pelas fontes');
      return [];
    }
    const novo = estado(processo);
    let novos = [];
    if (novo.assinatura !== anterior.assinatura) {
      novos = anterior.ultima_movimentacao
        ? processo.movimentos.filter((m) => (m.data || '') > anterior.ultima_movimentacao)
        : processo.movimentos.slice(0, Math.max(0, novo.totalMovimentos - anterior.total_movimentos));
      for (const m of novos.slice().reverse()) {
        repo.criarAlerta({
          numero,
          titulo: m.nome,
          detalhe: m.complementos?.join(' · ') || m.orgao || null,
          dataEvento: m.data,
        });
      }
      if (novos.length) {
        await notificarWebhook({
          evento: 'novas_movimentacoes',
          numero: processo.numeroFormatado,
          apelido: anterior.apelido,
          tribunal: novo.tribunal,
          movimentos: novos,
        });
      }
    }
    repo.atualizarMonitorado(novo);
    return novos;
  }

  async function verificarTodos() {
    if (rodando) return { ignorado: true };
    rodando = true;
    const inicio = Date.now();
    let novidades = 0;
    try {
      for (const m of repo.listarMonitorados()) {
        novidades += (await verificar(m.numero)).length;
      }
      repo.cachePurge();
    } finally {
      rodando = false;
    }
    logger.info(`[monitor] verificação concluída: ${novidades} novidade(s) em ${Date.now() - inicio} ms`);
    return { novidades };
  }

  function iniciar() {
    if (!config.monitor.enabled || timer) return;
    const ms = Math.max(5, config.monitor.intervalMinutes) * 60000;
    timer = setInterval(() => verificarTodos().catch((e) => logger.error('[monitor]', e)), ms);
    timer.unref();
  }

  function parar() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { adicionar, verificar, verificarTodos, iniciar, parar, remover: (n) => repo.removerMonitorado(n) };
}

module.exports = { criarMonitor };
