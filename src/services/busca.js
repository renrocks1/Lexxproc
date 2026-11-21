'use strict';

const { detectarTipoBusca, parseCNJ } = require('../lib/cnj');
const { mesclarProcessos } = require('../lib/modelo');
const { ProviderError } = require('../lib/http');

const METODOS = {
  nome: 'buscarPorNome',
  cpf: 'buscarPorDocumento',
  cnpj: 'buscarPorDocumento',
  oab: 'buscarPorOAB',
};

class BuscaError extends Error {
  constructor(message, status = 400, extra = {}) {
    super(message);
    this.status = status;
    Object.assign(this, extra);
  }
}

/**
 * Orquestra os provedores: escolhe quem atende cada tipo de busca, usa cache,
 * mescla resultados e registra o histórico.
 */
function criarServicoBusca({ provedores, repo, config }) {
  const ativos = () => provedores.filter((p) => p.habilitado);
  const quemSuporta = (tipo) => ativos().filter((p) => p.suporta.includes(tipo));

  async function buscarProcesso(numero, { atualizar = false } = {}) {
    const info = parseCNJ(numero);
    if (!info) throw new BuscaError('Número de processo inválido. Use o formato NNNNNNN-DD.AAAA.J.TR.OOOO.');
    if (!info.valido) {
      throw new BuscaError(`Dígito verificador inválido (informado ${info.dv}, esperado ${info.dvEsperado}). Confira o número.`);
    }
    const chave = `proc:${info.digitos}`;
    if (!atualizar) {
      const emCache = repo.cacheGet(chave);
      if (emCache) return { processo: emCache, cache: true, erros: [] };
    }

    const erros = [];
    let processo = null;
    let consultados = 0;
    for (const prov of quemSuporta('cnj')) {
      // DataJud não traz partes: se já temos movimentos, só consultamos
      // provedores pagos para complementar as partes.
      if (processo && processo.partes.length) break;
      consultados += 1;
      try {
        const r = await prov.buscarPorNumero(info.digitos);
        if (r) processo = mesclarProcessos(processo, r);
      } catch (err) {
        if (err.status !== 404) erros.push({ provedor: prov.nome, mensagem: err.message });
      }
    }

    if (!processo) {
      // Sem resposta: devolve a última versão salva, se houver.
      const salvo = repo.obterProcesso(info.digitos);
      if (salvo) return { processo: salvo, cache: true, desatualizado: true, erros };
      if (consultados && erros.length === consultados) {
        throw new BuscaError('Não foi possível consultar as fontes no momento.', 502, { erros });
      }
      return { processo: null, info, erros };
    }
    repo.cacheSet(chave, processo, config.cacheTtlSeconds);
    repo.salvarProcesso(processo);
    return { processo, cache: false, erros };
  }

  async function buscar(termo, { atualizar = false, tribunais = [] } = {}) {
    const t = String(termo || '').trim();
    if (t.length < 3) throw new BuscaError('Digite ao menos 3 caracteres.');
    const det = detectarTipoBusca(t);

    if (det.tipo === 'cnj') {
      const r = await buscarProcesso(det.valor, { atualizar });
      repo.registrarBusca(det.info.formatado, 'cnj', r.processo ? 1 : 0);
      return { tipo: 'cnj', termo: det.info.formatado, ...r };
    }

    if (det.tipo === 'nome' && det.valor.split(' ').length < 2) {
      throw new BuscaError('Para buscar por nome, informe nome e sobrenome (ou a razão social completa).');
    }

    const provs = quemSuporta(det.tipo);
    if (!provs.length) {
      throw new BuscaError(
        `A busca por ${det.tipo.toUpperCase()} exige um provedor com acesso às partes do processo. `
        + 'Configure ESCAVADOR_TOKEN ou JUDIT_API_KEY (o DataJud público só permite busca por número e metadados), '
        + 'ou rode em modo demonstração (DEMO_MODE=1).',
        501,
      );
    }

    const chave = `busca:${det.tipo}:${det.valor.toLowerCase()}:${[...tribunais].sort().join(',')}`;
    if (!atualizar) {
      const emCache = repo.cacheGet(chave);
      if (emCache) return { ...emCache, cache: true };
    }

    const metodo = METODOS[det.tipo];
    const arg = det.tipo === 'oab' ? det.info : det.valor;
    const erros = [];
    const avisos = [];
    const mapa = new Map();
    const respostas = await Promise.allSettled(provs.map((p) => p[metodo](arg, { tribunais })));
    respostas.forEach((r, i) => {
      if (r.status === 'rejected') {
        erros.push({ provedor: provs[i].nome, mensagem: r.reason?.message || String(r.reason) });
        return;
      }
      erros.push(...(r.value.erros || []));
      avisos.push(...(r.value.avisos || []));
      for (const item of r.value.resultados || []) {
        const atual = mapa.get(item.numero);
        mapa.set(item.numero, atual ? { ...atual, fontes: [...new Set([...atual.fontes, ...item.fontes])] } : item);
      }
    });

    const falharam = respostas.filter((r) => r.status === 'rejected');
    if (!mapa.size && falharam.length === provs.length) {
      // Um único provedor com erro "de negócio" (ex.: refine a busca) vira mensagem direta.
      const status = falharam.length === 1 && falharam[0].reason?.status === 422 ? 422 : 502;
      throw new BuscaError(status === 422 ? falharam[0].reason.message : 'Não foi possível consultar as fontes no momento.', status, { erros });
    }
    const resultados = [...mapa.values()]
      .sort((a, b) => String(b.ultimaAtualizacao || '').localeCompare(String(a.ultimaAtualizacao || '')));
    const resposta = { tipo: det.tipo, termo: det.valor, total: resultados.length, resultados, erros, avisos };
    if (!erros.length) repo.cacheSet(chave, resposta, config.cacheTtlSeconds);
    repo.registrarBusca(det.valor, det.tipo, resultados.length);
    return { ...resposta, cache: false };
  }

  async function buscaAvancada(params) {
    if (!params.tribunal) throw new BuscaError('Selecione o tribunal.');
    const prov = quemSuporta('avancada')[0];
    if (!prov) throw new BuscaError('Nenhum provedor de busca avançada habilitado.', 501);
    try {
      return { provedor: prov.nome, ...(await prov.buscaAvancada(params)) };
    } catch (err) {
      if (err instanceof ProviderError) throw new BuscaError(err.message, err.status === 400 ? 400 : 502);
      throw err;
    }
  }

  return {
    buscar,
    buscarProcesso,
    buscaAvancada,
    provedoresAtivos: () => provedores.map((p) => ({ nome: p.nome, rotulo: p.rotulo, habilitado: p.habilitado, suporta: p.suporta })),
    raspagem: () => {
      const r = provedores.find((p) => p.nome === 'raspagem');
      return r ? { habilitado: r.habilitado, tribunais: r.tribunais, hosts: r.estadoHosts() } : null;
    },
  };
}

module.exports = { criarServicoBusca, BuscaError };
