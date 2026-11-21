'use strict';

/**
 * Tribunais com raspador disponível. `verificado` indica que a estrutura
 * das páginas foi conferida contra o portal real; os demais usam o mesmo
 * sistema (e-SAJ) e devem funcionar, mas ainda não foram conferidos.
 */
const TRIBUNAIS_RASPAGEM = [
  {
    sigla: 'TJSP',
    sistema: 'esaj',
    base: 'https://esaj.tjsp.jus.br/cpopg',
    verificado: true,
    // Desde 2025 o TJSP distribui processos novos no eproc, cuja consulta pública
    // exige verificação humana (Cloudflare Turnstile): só é possível consultar manualmente.
    outrosPortais: [{
      sistema: 'eproc',
      rotulo: 'eproc do TJSP (processos distribuídos a partir de 2025)',
      url: 'https://eproc-consulta.tjsp.jus.br/consulta_1g/externo_controlador.php?acao=tjsp@consulta_unificada_publica/consultar',
      exigeVerificacaoHumana: true,
    }],
  },
  { sigla: 'TJAL', sistema: 'esaj', base: 'https://www2.tjal.jus.br/cpopg', verificado: true },
  { sigla: 'TJAM', sistema: 'esaj', base: 'https://consultasaj.tjam.jus.br/cpopg', verificado: false },
  { sigla: 'TJMS', sistema: 'esaj', base: 'https://esaj.tjms.jus.br/cpopg5', verificado: false },
  { sigla: 'TJAC', sistema: 'esaj', base: 'https://esaj.tjac.jus.br/cpopg', verificado: false },
  { sigla: 'TJCE', sistema: 'esaj', base: 'https://esaj.tjce.jus.br/cpopg', verificado: false },
];

/** Portais onde o usuário pode consultar manualmente um processo do tribunal. */
function portaisConsultaManual(sigla) {
  const t = TRIBUNAIS_RASPAGEM.find((x) => x.sigla === sigla);
  if (!t) return [];
  return [
    { sistema: t.sistema, rotulo: `e-SAJ do ${t.sigla}`, url: `${t.base}/open.do`, exigeVerificacaoHumana: false },
    ...(t.outrosPortais || []),
  ];
}

module.exports = { TRIBUNAIS_RASPAGEM, portaisConsultaManual };
