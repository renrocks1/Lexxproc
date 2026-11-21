# Fixtures do e-SAJ

Reproduzem a marcação real das páginas de consulta pública do e-SAJ (ids, classes e
aninhamento levantados em nov/2026 no TJSP e no TJAL), porém com **dados fictícios**.

| Arquivo | Página real correspondente |
|---|---|
| `lista.html` | `cpopg/search.do` com resultados (2 foros, paginação) |
| `lista-muitos.html` | `cpopg/search.do` com o aviso "muitos processos" |
| `lista-vazia.html` | `cpopg/search.do` sem resultados |
| `detalhe-tjsp.html` | `cpopg/show.do` do TJSP (movimentações sob demanda) |
| `movs-ajax-1.html` / `movs-ajax-2.html` | `cpopg/carregarMovimentacoesAjax.do` (1ª página e página seguinte por cursor)* |
| `detalhe-tjal.html` | `cpopg/show.do` do TJAL (movimentações na própria página) |
| `captcha.html` | página com verificação humana |

\* O retorno do AJAX exige sessão e não pôde ser capturado diretamente; a estrutura segue o
script `show-26.1.0-10.js` do portal (bloco de movimentações, `#cursorMovimentacoesPaginado`,
linhas `tr.containerMovimentacao` e `tr#trCursorMovimentacoes[data-cursor]`) e as linhas
idênticas às do TJAL.
