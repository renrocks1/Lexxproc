# Lexxproc — Consulta de Processos Judiciais

Sistema web para **consultar e acompanhar processos judiciais** de todos os tribunais do Brasil, no estilo de
Jusbrasil, Escavador, Processo Rápido e Judit.

- **Busca única inteligente**: digite número CNJ, nome da parte, CPF, CNPJ ou OAB — o tipo é detectado automaticamente.
- **Fonte oficial e gratuita**: [API Pública do DataJud (CNJ)](https://datajud-wiki.cnj.jus.br/api-publica/), cobrindo
  Justiça Estadual, Federal, do Trabalho, Eleitoral, Militar e Tribunais Superiores (STJ, TST, TSE, STM).
- **Provedores comerciais opcionais** (Escavador, Judit) para busca por nome/CPF/CNPJ/OAB e exibição de partes e advogados.
- **Página do processo**: linha do tempo de movimentações com filtro, partes, capa completa e decomposição do número CNJ.
- **Monitoramento**: acompanhe processos, receba alertas de novas movimentações e, se quiser, um **webhook**.
- **Busca avançada** por tribunal, classe, assunto, órgão julgador, grau e período (códigos TPU/CNJ).
- Validação de número CNJ (dígito verificador módulo 97), CPF, CNPJ e OAB.
- Cache, histórico de buscas, fallback para a última versão salva quando as fontes estão fora do ar.
- Interface responsiva com tema claro/escuro. Sem etapa de build e com uma única dependência (`express`).

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
| `ESCAVADOR_TOKEN` | Token da API v2 do Escavador — habilita nome/CPF/CNPJ/OAB e partes |
| `JUDIT_API_KEY` | Chave da API da Judit — idem |
| `MONITOR_INTERVAL_MINUTES` | Intervalo da verificação automática (padrão 360) |
| `MONITOR_WEBHOOK_URL` | URL que recebe `POST` JSON a cada nova movimentação |
| `CACHE_TTL_SECONDS` | Validade do cache de consultas (padrão 6 h) |

### Por que nome/CPF/OAB precisam de um provedor pago?

A API pública do CNJ **não divulga as partes** dos processos (nem processos em segredo de justiça), apenas metadados e
movimentações. Serviços como Jusbrasil e Escavador montam suas bases raspando os sistemas dos tribunais e diários oficiais.
O Lexxproc usa o DataJud para tudo o que é público e delega a busca por pessoas a Escavador e/ou Judit quando configurados.
Sem eles, a busca por nome retorna uma mensagem explicando como habilitar.

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
  providers/           cada provedor implementa buscarPorNumero / buscarPorNome / ...
    datajud.js         API Pública do CNJ (Elasticsearch)
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
| GET | `/api/busca?q=` | Busca unificada (CNJ, nome, CPF, CNPJ, OAB). `&atualizar=1` ignora o cache |
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
| GET | `/api/status` | Provedores ativos e configuração |

Payload do webhook:

```json
{ "evento": "novas_movimentacoes", "numero": "0000832-35.2018.4.01.3202", "apelido": "Cliente X",
  "tribunal": "TRF1", "movimentos": [{ "data": "2024-05-02T10:00:00", "nome": "Conclusão", "complementos": [] }] }
```

## Aviso

As informações têm caráter informativo e não substituem a consulta aos autos. Respeite a LGPD ao tratar dados de partes
obtidos de provedores comerciais.
