'use strict';

/**
 * Tribunais com raspador disponível. `verificado` indica que a estrutura
 * das páginas foi conferida contra o portal real; os demais usam o mesmo
 * sistema (e-SAJ) e devem funcionar, mas ainda não foram conferidos.
 */
const TRIBUNAIS_RASPAGEM = [
  { sigla: 'TJSP', sistema: 'esaj', base: 'https://esaj.tjsp.jus.br/cpopg', verificado: true },
  { sigla: 'TJAL', sistema: 'esaj', base: 'https://www2.tjal.jus.br/cpopg', verificado: true },
  { sigla: 'TJAM', sistema: 'esaj', base: 'https://consultasaj.tjam.jus.br/cpopg', verificado: false },
  { sigla: 'TJMS', sistema: 'esaj', base: 'https://esaj.tjms.jus.br/cpopg5', verificado: false },
  { sigla: 'TJAC', sistema: 'esaj', base: 'https://esaj.tjac.jus.br/cpopg', verificado: false },
  { sigla: 'TJCE', sistema: 'esaj', base: 'https://esaj.tjce.jus.br/cpopg', verificado: false },
];

module.exports = { TRIBUNAIS_RASPAGEM };
