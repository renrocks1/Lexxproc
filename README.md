# Lexxproc — Consulta de Processos Judiciais

Sistema web para **consultar e acompanhar processos judiciais** de todos os tribunais do Brasil, no estilo de
Jusbrasil, Escavador, Processo Rápido e Judit.

- **Busca única inteligente**: digite número CNJ, nome da parte, CPF, CNPJ ou OAB — o tipo é detectado automaticamente.
- **Fonte oficial e gratuita**: [API Pública do DataJud (CNJ)](https://datajud-wiki.cnj.jus.br/api-publica/), cobrindo
  Justiça Estadual, Federal, do Trabalho, Eleitoral, Militar e Tribunais Superiores (STJ, TST, TSE, STM).
- **Raspagem das consultas públicas dos tribunais** (e-SAJ: TJSP, TJAL, TJAM, TJMS, TJAC, TJCE): partes, advogados, juiz,
  valor da causa, situação, texto completo das movimentações e **busca por nome, CPF/CNPJ e OAB sem custo**.
- **Provedores comerciais opcionais** (Escavador, Judit) para os tribunais ainda sem raspador.
- **Página do processo**: linha do tempo de movimentações com filtro, partes, capa completa e decomposição do número CNJ.
- **Monitoramento**: acompanhe processos, receba alertas de novas movimentações e, se quiser, um **webhook**.
- **Busca avançada** por tribunal, classe, assunto, órgão julgador, grau e período (códigos TPU/CNJ).
- Validação de número CNJ (dígito verificador módulo 97), CPF, CNPJ e OAB.
- Cache, histórico de buscas, fallback para a última versão salva quando as fontes estão fora do ar.
- Interface responsiva com tema claro/escuro. Sem etapa de build; dependências: `express` e `cheerio`.

## Como rodar

Requer **Node.js 22.5+** (usa o SQLite nativo `node:sqlite`).

```bash
npm install
npm start          # http://localhost:3000 — usa o DataJud (internet necessária)
npm run demo       # modo demonstração: dados fictícios, sem rede nem chaves
npm test           # testes automatizados
```

Com Docker:

```bash
docker build -t lexxproc .
docker run -p 3000:3000 -v lexxproc-data:/app/data --env-file .env lexxproc
```

## Configuração

Copie `.env.example` para `.env` e ajuste. Principais variáveis:

| Variável | Descrição |
|---|---|
| `PORT` | Porta HTTP (padrão 3000) |
| `DEMO_MODE` | `1` usa o provedor de demonstração |
| `API_TOKEN` | Se definido, exige `Authorization: Bearer <token>` na API |
| `DATAJUD_API_KEY` | Chave pública do DataJud (já vem a atual; o CNJ pode trocá-la) |
| `SCRAPER_ENABLED` | `1` liga a raspagem dos portais (padrão) |
| `SCRAPER_TRIBUNAIS` | Restringe a raspagem a algumas siglas (ex.: `TJSP,TJAL`) |
| `SCRAPER_MIN_INTERVAL_MS` | Intervalo mínimo entre requisições ao mesmo portal (padrão 1500 ms) |
| `SCRAPER_PAUSE_MINUTES` | Pausa do portal após CAPTCHA ou 5 falhas seguidas (padrão 30 min) |
| `SCRAPER_MAX_PAGES` | Páginas de resultado por tribunal na busca por nome/CPF/OAB (25 por página; padrão 4) |
| `ESCAVADOR_TOKEN` | Token da API v2 do Escavador — habilita nome/CPF/CNPJ/OAB e partes |
| `JUDIT_API_KEY` | Chave da API da Judit — idem |
| `MONITOR_INTERVAL_MINUTES` | Intervalo da verificação automática (padrão 360) |
| `MONITOR_WEBHOOK_URL` | URL que recebe `POST` JSON a cada nova movimentação |
| `CACHE_TTL_SECONDS` | Validade do cache de consultas (padrão 6 h) |

### De onde vem cada dado

A API pública do CNJ **não divulga as partes** dos processos, apenas metadados e movimentações codificadas (TPU).
Por isso o Lexxproc combina as fontes:

| Dado | DataJud | Raspagem do portal | Escavador/Judit |
|---|---|---|---|
| Classe, assuntos e órgão com códigos TPU | ✓ | só nomes | só nomes |
| Graus (1º, 2º, turmas, superiores) | ✓ | 1º grau | ✓ |
| Partes e advogados, juiz, valor da causa, situação | — | ✓ | ✓ |
| Texto completo das movimentações | — (só TPU) | ✓ | ✓ |
| Busca por nome, CPF/CNPJ, OAB | — | ✓ (tribunais com raspador) | ✓ |
| Custo | grátis | grátis | pago |

Na consulta por número, o DataJud é consultado primeiro; a raspagem completa partes e movimentações; os provedores pagos
só são chamados se ainda faltarem partes. Quando duas fontes descrevem as movimentações, prevalece a mais detalhada
(portal do tribunal), sem duplicar.

## Raspagem dos tribunais

Raspadores ficam em `src/scrapers/`. O primeiro sistema suportado é o **e-SAJ** (consulta pública de 1º grau, `cpopg`):

| Tribunal | Portal | Estrutura conferida |
|---|---|---|
| TJSP | esaj.tjsp.jus.br/cpopg | ✓ (nov/2026) |
| TJAL | www2.tjal.jus.br/cpopg | ✓ (nov/2026) |
| TJAM, TJMS, TJAC, TJCE | portais e-SAJ | mesmo sistema, ainda não conferido |

Como funciona: `search.do` (lista ou redireciona direto ao processo) → `show.do` (capa e partes) →
`carregarMovimentacoesAjax.do` (movimentações; no TJSP são carregadas sob demanda, com paginação por cursor e exigem o
cookie de sessão). Os parsers são funções puras testadas com fixtures em `test/fixtures/esaj/` que reproduzem a marcação
real com dados fictícios, e há um portal simulado (`test/helpers/portal.js`) para testar o fluxo completo.

**Uso responsável (embutido no código):**
- uma requisição por vez a cada portal, com intervalo mínimo configurável, e cache das consultas;
- **CAPTCHA não é contornado**: se o portal exigir verificação humana, o raspador para e pausa aquele portal;
- processos em segredo de justiça não são acessados;
- só dados exibidos publicamente pela consulta processual. Ao armazenar ou exibir dados de partes, observe a LGPD e a
  Resolução CNJ nº 121/2010; recomenda-se avaliação jurídica antes de uso comercial.

**Quando o portal muda de layout**, os parsers tendem a devolver listas vazias. Para atualizar: salve o HTML real da
página, ajuste os seletores em `src/scrapers/esaj.js`, atualize a fixture correspondente (trocando dados pessoais por
fictícios) e rode `npm test`.

**Próximos sistemas:** PJe (TRTs, TRFs e vários TJs), eproc (TRF4, TJRS, TJSC, TJTO) e 2º grau do e-SAJ (`cposg`).
Para adicionar um tribunal e-SAJ basta incluí-lo em `src/scrapers/registro.js`.

## Arquitetura

```
src/
  server.js            inicialização + agendador do monitoramento
  app.js               Express: rotas da API, segurança, arquivos estáticos
  config.js            variáveis de ambiente
  db.js                SQLite (cache, processos, monitorados, alertas, histórico)
  lib/
    cnj.js             numeração única CNJ, CPF, CNPJ, OAB, detecção do tipo de busca
    tribunais.js       mapa J.TR → tribunal → índice do DataJud (91 tribunais)
    modelo.js          modelo normalizado de processo + mesclagem entre fontes
    http.js            fetch com timeout e erros padronizados
  scrapers/
    cliente.js         HTTP com cookies, ritmo por portal, retentativas e pausa em CAPTCHA
    esaj.js            parsers e fluxo do e-SAJ
    registro.js        tribunais com raspador e seus portais
  providers/           cada provedor implementa buscarPorNumero / buscarPorNome / ...
    datajud.js         API Pública do CNJ (Elasticsearch)
    raspagem.js        integra os raspadores ao sistema de busca
    escavador.js       API v2 do Escavador
    judit.js           API da Judit (assíncrona, com polling)
    demo.js            dados fictícios determinísticos
  services/
    busca.js           orquestra provedores, cache, fallback e histórico
    monitor.js         detecta novas movimentações e gera alertas/webhook
public/                SPA em HTML/CSS/JS puros
test/                  testes (node:test)
```

Para adicionar outro provedor (ex.: raspagem de um tribunal específico), crie um módulo em `src/providers/` que
retorne `{ nome, rotulo, habilitado, suporta: [...], buscarPorNumero(), ... }` no modelo normalizado de
`src/lib/modelo.js` e registre-o em `criarProvedores()` (`src/app.js`).

## API

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/busca?q=` | Busca unificada (CNJ, nome, CPF, CNPJ, OAB). `&tribunais=TJSP,TJAL` restringe a raspagem; `&atualizar=1` ignora o cache |
| GET | `/api/processos/:numero` | Detalhes completos do processo |
| GET | `/api/busca-avancada?tribunal=TJSP&classe=7&assunto=&orgao=&grau=G1&inicio=2024-01-01&fim=&cursor=` | Busca por metadados (DataJud) |
| GET | `/api/cnj/:numero` | Valida e decompõe um número CNJ (sem consulta externa) |
| GET | `/api/tribunais` | Lista de tribunais e cobertura |
| GET/POST | `/api/monitorados` | Lista / adiciona (`{ numero, apelido }`) |
| PATCH/DELETE | `/api/monitorados/:numero` | Renomeia / remove |
| POST | `/api/monitorados/:numero/verificar` | Verifica agora um processo |
| POST | `/api/monitoramento/executar` | Verifica todos agora |
| GET | `/api/alertas` | Alertas (`?naoLidos=1`) |
| POST | `/api/alertas/:id/lido`, `/api/alertas/lidos` | Marca como lido(s) |
| GET/DELETE | `/api/historico` | Histórico de buscas |
| GET | `/api/status` | Provedores ativos, tribunais com raspagem e portais pausados |

Payload do webhook:

```json
{ "evento": "novas_movimentacoes", "numero": "0000832-35.2018.4.01.3202", "apelido": "Cliente X",
  "tribunal": "TRF1", "movimentos": [{ "data": "2024-05-02T10:00:00", "nome": "Conclusão", "complementos": [] }] }
```

## Aviso

As informações têm caráter informativo e não substituem a consulta aos autos. Respeite a LGPD ao tratar dados de partes
obtidos de provedores comerciais.
