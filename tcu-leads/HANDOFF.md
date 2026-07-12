# TCU Leads — Relatório de Handoff Técnico

> Documento para o desenvolvedor que vai **manter** e/ou **integrar** este sistema
> a outro. Traz a arquitetura, o mapa de código, os contratos das integrações
> externas (os mais difíceis de redescobrir), o **diário de bordo de erros e
> lições**, e um **guia de integração**. Sem reservas — está tudo aqui.
>
> Última atualização: 2026-07. Branch de desenvolvimento: `claude/tcu-lead-capture-nz5ghz`.

---

## 1. O que é o sistema

**TCU Leads** é um motor de **captação de oportunidades (leads)** para um escritório
de advocacia de **direito público**. Ele descobre, a partir de **fontes públicas**,
potenciais clientes — pessoas físicas/jurídicas que estão sendo **chamadas a
processos** (principalmente no **Tribunal de Contas da União**) ou que **contratam
serviços jurídicos** (licitações, embaixadas, estatais) — e os organiza num CRM.

**Postura de conformidade (importante, não remover):** é uma **ferramenta interna
de inteligência** sobre dados públicos. **NÃO** faz contato ativo/automático com
terceiros (vedação de captação de clientela — OAB Provimento 205/2021). Cada lead
tem flag de objeção LGPD e campo de base de legítimo interesse. CPF **não** é
enriquecido (só o que o TCU publica, já mascarado).

Fontes de lead:
1. **TCU — processos autuados** (Pesquisa Integrada) → responsáveis/interessados.
2. **TCU — BTCU/Boletim** (citações, audiências, despachos, editais) → *em calibração*.
3. **DOU** (Diário Oficial da União) → licitações/sanções/nomeações + palavras-chave.
4. **Radar Externo** (sites/RSS): embaixadas, estatais, empresas, portais de contratação.

---

## 2. Arquitetura e stack

```
┌─────────────────────────┐        ┌──────────────────────────────┐
│  Frontend (Next.js 14)  │  HTTP  │  Backend (FastAPI)           │
│  App Router, Tailwind   │ ─────► │  SQLAlchemy 2 + APScheduler  │
│  JWT no localStorage    │  JSON  │  Anthropic (extração IA)     │
└─────────────────────────┘        │  Playwright/Chromium (WAF)   │
                                    └───────────┬──────────────────┘
                                                │
                              ┌─────────────────┼───────────────────┐
                              ▼                 ▼                   ▼
                        PostgreSQL       TCU / DOU / BrasilAPI   SMTP (digest)
                        (prod) / SQLite  (internet)
```

- **Backend:** Python 3.12, FastAPI, SQLAlchemy 2.0, APScheduler (job diário),
  httpx, Playwright (Chromium headless), Anthropic SDK, pdfplumber/PyMuPDF,
  BeautifulSoup4/feedparser (Radar Externo). ~4.8k linhas.
- **Frontend:** Next.js 14 (App Router, `output` estático + SSR leve), React,
  TailwindCSS, axios. ~3k linhas.
- **Banco:** SQLite em dev (zero config), **PostgreSQL 16** em produção (Docker).
- **Deploy:** Docker Compose (db + backend + frontend) atrás de **Nginx** numa VPS
  (DigitalOcean), domínio `tculeads.vascav.com.br`, TLS via Let's Encrypt.

---

## 3. Mapa de diretórios (comentado)

```
tcu-leads/
├── HANDOFF.md                      ← este documento
├── DEPLOY.md, README.md            ← publicação e visão geral
├── docker-compose.prod.yml         ← db + backend + frontend (produção)
├── docker-compose.yml              ← dev
├── infra/
│   ├── setup-servidor.sh           ← provisiona a VPS (docker, clone, .env)
│   ├── continuar-instalacao.sh     ← build + up
│   ├── nginx.conf / nginx-http.conf← proxy reverso (443 → frontend/backend)
├── docs/PUBLICACAO.md, telas/      ← guia ilustrado de publicação
├── backend/
│   ├── Dockerfile                  ← ATENÇÃO: instala Chromium (ver §11)
│   ├── requirements.txt
│   └── app/
│       ├── main.py                 ← startup: create_all + migração leve + seed + backfill + scheduler
│       ├── config.py               ← env vars (pydantic-settings)
│       ├── database.py             ← engine + SessionLocal + get_db
│       ├── schemas.py              ← Pydantic (entrada/saída da API)
│       ├── core/auth.py            ← JWT (python-jose) + bcrypt (passlib) + get_current_user
│       ├── models/
│       │   ├── user.py             ← users
│       │   ├── lead.py             ← tcu_leads, tcu_lead_notes, tcu_cnpj_enrichment,
│       │   │                          tcu_monitor_runs, tcu_monitor_settings + ENUMs
│       │   ├── process.py          ← tracked_processes (detecção de autuados)
│       │   └── external.py         ← monitored_sources, external_seen_items
│       ├── routers/                ← auth, leads, monitor, processes, external
│       └── services/
│           ├── ai.py               ← get_client() → anthropic.Anthropic
│           ├── sources.py          ← ★ TcuHttpClient (WAF/browser), Pesquisa Integrada,
│           │                          fetch_processo_detail, probe_*, BrasilAPI, BTCU
│           ├── browser.py          ← ★ TcuBrowserSession (Playwright) — vence o desafio JS
│           ├── tcu_domain.py       ← ★ domínio RITCU: comunicações, naturezas, score
│           ├── parser.py           ← regex/anchors + extração de PDF do BTCU
│           ├── extractor.py        ← extração estruturada por IA (Claude) + fallback regex
│           ├── pipeline.py         ← orquestra a coleta diária + upsert_lead + enrich
│           ├── process_tracker.py  ← detecção de autuados + criação de leads de autuado
│           ├── scheduler.py        ← APScheduler (job diário no horário configurado)
│           ├── digest.py           ← e-mail diário (SMTP) das melhores oportunidades
│           ├── audit.py            ← log_action (trilha de auditoria)
│           └── external/           ← Radar Externo
│               ├── dou.py          ← DOU (Imprensa Nacional, JSON embutido)
│               ├── web.py          ← RSS (feedparser) + páginas (BeautifulSoup)
│               ├── classifier.py   ← classifica item externo (licitação/sanção/...)
│               ├── pipeline.py     ← orquestra DOU + fontes web → leads
│               └── presets.py      ← fontes sugeridas (embaixadas, estatais, PNCP...)
└── frontend/src/
    ├── app/                        ← painel, leads (lista+kanban), leads/[id], processos,
    │                                  fontes, config, usuarios, login, layout, page
    ├── components/                 ← AppShell, layout/(Sidebar,Header), ui/(Modal,Toast,Badge)
    └── lib/                        ← api.ts (axios), auth.ts, tcu.ts (rótulos/cores), utils.ts
```

Os arquivos marcados com ★ concentram o conhecimento não-óbvio. **Leia-os primeiro.**

---

## 4. Modelo de dados (tabelas)

Todas as tabelas do TCU Leads (exceto `users`) são **prefixadas** para conviver com
outro sistema no mesmo banco. Enums são armazenados como string.

| Tabela | Papel | Colunas-chave |
|---|---|---|
| `users` | usuários/login | email, name, role (admin/membro), hashed_password, is_active |
| `tcu_leads` | **oportunidade** (CRM) | act_type, natureza_processo, **categoria** (tcu/licitacao/sancao/nomeacao/palavra_chave), **fonte_nome**, numero_processo, relator, orgao_entidade, uf, municipio, **responsavel_nome/documento**, **responsaveis_json**, doc_type, valor_debito/multa, prazo_final, resumo, is_opportunity, **opportunity_score**, rationale, confidence, **source_kind**, source_url, content_hash (unique, dedupe), **status** (novo→...→em_atendimento/descartado), assignee_id, **viewed_at**, **lgpd_objection**, legitimate_interest_basis |
| `tcu_lead_notes` | anotações/timeline | lead_id, author_id, kind (nota/status_change/...), body |
| `tcu_cnpj_enrichment` | cache CNPJ (BrasilAPI) | lead_id, cnpj, razao_social, situacao_cadastral, socios(JSON)... |
| `tcu_monitor_runs` | auditoria de cada execução | status, trigger, leads_created/duplicated, detail(JSON), error |
| `tcu_monitor_settings` | **config singleton (id=1)** | flags de fontes, horário, DOU, `autuados_*`, `autuados_use_browser`, enrich, rede |
| `tracked_processes` | detecção de autuados | numero_processo (unique), natureza, orgao, responsaveis_json, **detection_date**, lead_id |
| `monitored_sources` | fontes do Radar Externo | name, kind (rss/webpage), url, enabled, keywords, categoria_padrao, item_selector, last_* |
| `external_seen_items` | dedupe do Radar | source_ref, item_hash (unique), url, lead_id |

Enums relevantes (`models/lead.py`): `TcuActType` (citacao/audiencia/notificacao/
acordao_condenatorio/edital/outro), `TcuLeadStatus`, `TcuSourceKind`
(btcu_deliberacoes/acordaos_api/pauta_sessao/**processo_autuado**/ingestao_manual/
**dou**/**fonte_web**), `TcuLeadCategoria`, `TcuDocType`.

**Dedupe de lead:** `content_hash = sha256(numero|act_type|documento|fallback)`
(fallback = source_key/source_codigo/trecho do texto). Ver `pipeline.upsert_lead`.

---

## 5. API (todas as rotas)

Base: `/api`. Autenticação: **Bearer JWT** (exceto `/api/auth/login`). Header
`Authorization: Bearer <token>`.

**auth** (`/api/auth`): `POST /login` (form username/password → token), `GET /me`,
`GET /users`, `POST /users` (admin).

**leads** (`/api/leads`): `GET ""` (filtros: act_type, tema, status, doc_type, uf,
**source_kind**, **categoria**, valor_min/max, only_opportunities, hide_represented,
search, order_by=score|recent|deadline|valor, skip/limit), `GET /{id}` (marca
`viewed_at`), `PATCH /{id}` (status/assignee/lgpd/...), `POST /{id}/notes`,
`POST /{id}/enrich` (CNPJ).

**monitor** (`/api/monitor`): `GET /stats` (KPIs do painel), `POST /run` (dispara
pipeline em background), `POST /ingest/text`, `POST /ingest/pdf`, `GET /runs`,
`GET/PATCH /settings`, `POST /cleanup-noise`, `POST /clear-autuados-source`,
`POST /test-source/processos` (**diagnóstico** da fonte de processos a partir do
servidor), `POST /test-btcu` (calibração do BTCU).

**processes** (`/api/processes`): `GET ""` (autuados por período), `GET /stats`.

**external** (`/api/external`): `GET/POST /sources`, `PATCH/DELETE /sources/{id}`,
`POST /sources/{id}/test`, `POST /test-source` (ad-hoc), `POST /test-dou`,
`POST /run`, `POST /presets` (adiciona fontes sugeridas + keywords do DOU).

---

## 6. ★ Integrações externas — os contratos (o mais valioso deste doc)

### 6.1 TCU — Pesquisa Integrada (a fonte principal)

**Base URL:** `https://pesquisa.apps.tcu.gov.br/rest/publico/base/<BASE>/<KIND>`
- `<BASE>`: `processo` (confirmado), `btcu`, `acordao`, `norma`, `jurisprudencia`...
- `<KIND>`: `documentosResumidos` (lista leve) **ou** `documento` (registro completo).

**Query params:**
```
termo=*
filtro=<CAMPO>:[AAAAMMDD to AAAAMMDD]
ordenacao=DTAUTUACAOORDENACAO desc, NUMEROCOMZEROS desc,KEY asc   (para processo)
quantidade=<N>
inicio=<offset>
```
- `<CAMPO>` para processos: **`DTAUTUACAO`** = processos *autuados* (abertos) na
  data — o lead premium, poucos por dia. **`DTATUALIZACAO`** = qualquer
  *movimentação* na data — milhares por dia.

**Resposta:** `{ "quantidadeEncontrada": N, "documentos": [ {...} ] }`. Campos do
processo (chaves MAIÚSCULAS): `KEY, TIPO, NUMEROFORMATADO, ESTADO, ASSUNTO, RELATOR,
UNIDADESJURISDICIONADAS[], MOVIMENTACOES[], URLSISTEMAPUSH, UNIDADERESPONSAVELTECNICA,
UNIDADERESPONSAVELPORAGIR, REPRESENTANTESMPTCU, ...`

**★ Diferença crucial:**
- `documentosResumidos` **NÃO** traz os responsáveis.
- `documento` **traz** o campo **`RESPONSAVEIS`** — uma **lista de strings** no
  formato `"Nome Completo - (XXX.303.302-XX)"` (CPF **mascarado**, como o TCU
  publica). O rótulo pode ser `INTERESSADOS` em processos administrativos.
- **O endpoint `documento` responde 1 registro por vez:** use
  `quantidade=1&inicio=<posição>`. Com `quantidade>1` ele retorna **vazio**.
  A posição (`inicio`) é o índice do processo na MESMA consulta ordenada do
  `documentosResumidos`. Estratégia: listar via resumidos (posições 0..N), e para
  cada processo novo buscar o detalhe em `inicio=N` (ver `fetch_processo_detail`).

### 6.2 ★ WAF F5/BIG-IP — o obstáculo que consumiu mais tempo

O `pesquisa.apps.tcu.gov.br` é protegido por **F5 BIG-IP ASM com bot defense**.
Sintomas e solução (nesta ordem de descoberta):

1. **`POST /api/publico/entidades/busca`** (endpoint de sessão) retornava
   `{"entidades":[]}`. → Abandonado; migramos para `documentosResumidos` (GET stateless).
2. **Cabeçalhos mínimos → bloqueio** ("acesso bloqueado pela solução de firewall").
   Solução parcial: enviar **cabeçalhos de navegador real** (ver abaixo).
3. **Accept-Encoding com `br`** → corpo vinha em **brotli** que o httpx não decodifica
   (lixo). → **Não** enviar br; deixar o httpx negociar gzip/deflate.
4. **Cookies do firewall (`TS...`)**: o F5 emite cookies `TS016da608`,
   `TS5a851b6d027`. Um cliente HTTP pega o cookie mas **não o valida** → o F5
   responde **HTTP 200 com corpo vazio** (o famoso "Expecting value: line 1
   column 1"). Priming com httpx (visitar a home) **não** resolve.
5. **★ Causa raiz: desafio JavaScript.** Só um navegador que **executa o JS**
   valida o cookie. **Prova:** rodando o cURL do navegador (com o cookie validado
   pelo Chrome) **a partir do próprio servidor**, veio `quantidadeEncontrada:1670`
   → o **IP do servidor não está bloqueado**; faltava executar o JS. Cookies de
   analytics criados por JS (`_ga`, `_clck`, `MUID`) confirmam que o Chromium
   realmente renderiza a página.
6. **★ Solução: navegador headless (Playwright/Chromium).** Ver §6.3.

**Cabeçalhos usados (`sources._pesquisa_headers`):**
```
Accept: application/json, text/plain, */*
Accept-Language: pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7
User-Agent: Mozilla/5.0 (Macintosh; ...) Chrome/149.0.0.0 Safari/537.36
Origin: https://pesquisa.apps.tcu.gov.br
Referer: https://pesquisa.apps.tcu.gov.br/documento/processo/*/<filtro-DUPLO-encoded>
Sec-Fetch-Site: same-origin | Sec-Fetch-Mode: cors | Sec-Fetch-Dest: empty
sec-ch-ua / sec-ch-ua-mobile / sec-ch-ua-platform
origem: angular
todas-bases: false
uuid: <uuid v4 de sessão>
```
O `Referer` leva o filtro **duplo-URL-encoded** (o front-end Angular faz assim):
`quote(quote("DTAUTUACAO:[20260706 to 20260706]"))`.

### 6.3 ★ Navegador headless (`services/browser.py`)

`TcuBrowserSession` (Playwright sync):
1. `open()` — lança Chromium headless (`--no-sandbox --disable-dev-shm-usage
   --disable-gpu`). Aceita `PW_CHROMIUM_EXECUTABLE` (env) para apontar um binário.
2. `prime()` — `page.goto(home, wait_until="domcontentloaded")` + espera
   `networkidle` → o JS do F5 roda e valida o cookie.
3. `get(url, params)` — faz `page.evaluate(async ({url,headers}) => fetch(url,
   {headers, credentials:'include'}))` **de dentro da página** (mesma origem,
   cookies válidos, TLS do Chrome). Retorna `(status, headers, bytes)` no mesmo
   formato de `TcuHttpClient.fetch_raw`.

`TcuHttpClient` (em `sources.py`) tem `use_browser`: quando ligado, os **GET**
passam pelo navegador (com **fallback** ao httpx). O `_client(settings)` do
`pipeline.py` liga isso conforme `settings.autuados_use_browser` (default **True**).
**Sempre** chame `client.close()` (libera o Chromium) — feito no pipeline e no probe.

Enriquecimento de CNPJ (BrasilAPI) **não** usa navegador (`use_browser=False`).

### 6.4 DOU — Imprensa Nacional (`services/external/dou.py`)

`GET https://www.in.gov.br/leiturajornal?secao=<do1|do2|do3>&data=DD-MM-YYYY`
→ HTML com **JSON embutido** em `<script id="params">` (chave `jsonArray`). Cada
item: `title`, `urlTitle`, `content/abstract`. URL do item:
`https://www.in.gov.br/web/dou/-/<urlTitle>`. Cabeçalhos de navegador.

### 6.5 BrasilAPI (CNPJ) e Anthropic

- CNPJ: `GET https://brasilapi.com.br/api/cnpj/v1/<cnpj>`. **Nunca em massa**
  (limite ~50/execução). CPF **não** é consultado (LGPD).
- IA: `anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)`. Modelo em
  `extractor.TCU_MODEL` (`claude-sonnet-4-6`). Temperatura 0, JSON estrito,
  few-shot. **Degrada sem IA**: se não há chave, cai para o parser regex.

---

## 7. Pipeline de coleta (`services/pipeline.run_pipeline`)

Disparado pelo **scheduler** (diário, horário em settings) ou por `POST /monitor/run`.
Ordem: acórdãos (opcional) → pautas → BTCU (se URL configurada) → enrich CNPJ →
**detecção de autuados** (`process_tracker.fetch_and_register_autuados`) → **Radar
Externo** (`external/pipeline.run_external`) → digest por e-mail. Cada fonte é
`try/except` (uma falha não derruba as demais). Gera um `tcu_monitor_runs`.

**Autuados (o coração):** lista processos do dia (resumido) → para cada **novo**
(inédito em `tracked_processes`), busca o **detalhe** (`documento`, 1 a 1) para os
responsáveis → cria lead com **score/act_type/prazo derivados do `tcu_domain`**
(natureza + comunicação detectada nas MOVIMENTACOES). Teto de 200 detalhes/execução.

---

## 8. ★ Motor de domínio TCU (`services/tcu_domain.py`)

Codifica o **Regimento Interno (Res. 246/2011)** e a **Lei 8.443/92**:
- **Comunicações** que chamam o particular: `citacao` (débito, 15d, defesa),
  `audiencia` (sem débito, 15d, justificativa), `oitiva`, `notificacao`,
  `diligencia`, `cobranca_executiva` — cada uma com **valor de lead** e prazo.
- **Naturezas** (TCE, Cobrança Executiva, Representação, Denúncia, Prestação de
  Contas, Recurso, Auditoria, Ato de Pessoal, Consulta...) com peso de lead.
- **Documentos** que nomeiam responsáveis: **instrução** (unidade técnica *propõe*
  a citação — 1ª aparição dos nomes), **despacho** (relator *ordena*), acórdão,
  edital, relação.
- Funções: `detect_comunicacoes`, `classify_natureza`, `scan_movimentacoes`,
  `tcu_lead_score` (0-100 + rationale), `act_type_for`, `prazo_for`.

Isso substituiu o score genérico anterior. Ex.: *TCE + citação + responsável = 95*;
*aposentadoria sem sinal = 10*.

---

## 9. Configuração (env vars + settings)

**Env (`.env`, lido por `config.py`):** `DATABASE_URL`, `SECRET_KEY`, `ALGORITHM`,
`ACCESS_TOKEN_EXPIRE_MINUTES`, **`ANTHROPIC_API_KEY`**, `ADMIN_EMAIL/PASSWORD/NAME`
(admin criado no 1º start), SMTP_* + `DIGEST_TO/DIGEST_MIN_SCORE`, `APP_NAME`,
`ENVIRONMENT`. Frontend: `NEXT_PUBLIC_API_URL` (injetado no build).

**Settings singleton (`tcu_monitor_settings`, id=1):** editável na tela
Configuração. Campos: `enabled`, `run_hour/minute`, fontes (acordaos/pautas/btcu),
`autuados_enabled`, `autuados_filtro_campo` (DTAUTUACAO/DTATUALIZACAO),
`autuados_create_leads`, `autuados_fetch_responsaveis`, **`autuados_use_browser`**,
DOU (`dou_enabled/secoes/keywords`, `fontes_web_enabled`), enrich, rede.

---

## 10. Deploy (produção)

VPS DigitalOcean, Ubuntu, Docker. `docker-compose.prod.yml`: **db** (postgres:16),
**backend** (build ./backend, porta interna 8000), **frontend** (build ./frontend
com `NEXT_PUBLIC_API_URL=${SITE_URL}`, porta 3000). **Nginx** (host) faz proxy
443 → frontend e `/api` → backend, TLS Let's Encrypt. DNS: `A` de
`tculeads.vascav.com.br` → IP do droplet.

Atualizar:
```bash
cd /opt/gestaorepassesbets && git pull origin claude/tcu-lead-capture-nz5ghz
cd tcu-leads && docker compose -f docker-compose.prod.yml up -d --build
```
**Migração:** `main.py` roda `create_all` + **migração leve** (adiciona colunas
novas a tabelas existentes) + **backfill** de defaults + seed do admin. Não há
Alembic (ver §12).

---

## 11. ★ DIÁRIO DE BORDO — erros cometidos e como evitá-los

> Esta é a seção "não repita os mesmos erros". Cada item custou tempo real.

1. **WAF do TCU:** não perca tempo com httpx puro na Pesquisa Integrada. Ele
   retorna **200 com corpo vazio** por causa do **desafio JS do F5**. Use o
   **navegador headless** (§6.3). Antes de culpar o IP, teste o cURL do navegador
   **no servidor** — o IP de datacenter costuma funcionar.

2. **Endpoint `documento` só com `quantidade=1&inicio=N`.** Com `quantidade>1`
   volta vazio. Foi isso que fez parecer "quebrado".

3. **`DTAUTUACAO` retorna poucos/zero** em muitos dias — **é o esperado** (autuados
   são poucos). Não é bug. Para volume, use `DTATUALIZACAO` (movimentação).

4. **Brotli:** não envie `Accept-Encoding: br`; o httpx entrega lixo. Deixe o
   default. (No navegador não há esse problema — o `fetch` já decodifica.)

5. **Build do Chromium quebrava:** `playwright install --with-deps chromium`
   tentava instalar `ttf-unifont`/`ttf-ubuntu-font-family` (nomes antigos,
   inexistentes no Debian atual). **Solução:** base `python:3.12-slim-bookworm` +
   instalar as libs do Chromium via **apt (lista fixa)** + `playwright install
   chromium` (**sem** `--with-deps`). Playwright **1.61.0**. Ver `backend/Dockerfile`.

6. **Migração + colunas NULL:** ao adicionar colunas a um banco existente, as
   linhas antigas ficam **NULL**. Um schema Pydantic que exige `bool` **quebra** a
   leitura (a tela de Configuração ficava presa em "Carregando..."). **Solução:**
   `_run_light_migrations` faz `UPDATE ... WHERE col IS NULL` com o default; e
   `_backfill_settings_defaults` completa o singleton no startup. Ver `main.py`.

7. **URL customizada "fantasma":** uma `autuados_listing_url` antiga salva no banco
   sequestrava o probe e o pipeline (usava a URL velha em vez da Pesquisa Integrada).
   Há `POST /monitor/clear-autuados-source` + aviso na UI. Cuidado com estado
   herdado no singleton.

8. **Next.js (App Router):**
   - Não `export` consts no nível da página ("not a valid Page export field").
   - `useSearchParams`/spread de iterador exige target ES2015+; use
     `new URLSearchParams(window.location.search)` + `.get()`.
   - Após deletar páginas, `rm -rf .next` antes de rebuildar (types em cache).
   - `line-clamp` é nativo no Tailwind 3.3+.

9. **Memória do Chromium:** headless Chrome é pesado. Em droplet de 1 GB pode faltar
   memória. Mitigação: **swap** (grátis) ou aumentar o droplet. Use
   `--disable-dev-shm-usage` (já aplicado).

10. **`busca` (grafo de entidades) é session-based** e retornou vazio — não use
    para listagem. Prefira os endpoints stateless `documentosResumidos`/`documento`.

11. **Playwright sync em FastAPI:** rode em endpoints/threads **sync** (o FastAPI
    executa `def` num threadpool sem event loop). Não misture com asyncio.

---

## 12. ★ Guia de integração com outro sistema

O TCU Leads é **standalone** (auth própria, tabelas próprias, Docker próprio). Há
três caminhos de integração; escolha conforme o objetivo:

### Opção A — Manter separado e integrar por API/SSO (menor risco, recomendado)
- Suba o TCU Leads como serviço; o outro sistema consome a **API REST** (JWT).
- **SSO:** troque o `core/auth.py` para validar o token do sistema principal
  (mesmo `SECRET_KEY`/emissor) ou aceite um JWT externo. O restante da API não muda.
- Compartilhe apenas o que precisar (ex.: leads via `GET /api/leads`).

### Opção B — Mesmo banco, apps separados (integração de dados)
- As tabelas do TCU Leads são **prefixadas** (`tcu_*`, `tracked_processes`,
  `monitored_sources`, `external_seen_items`) — **não colidem**, exceto **`users`**.
- **Ponto de atenção:** `users` é compartilhável. Alinhe o modelo de usuário
  (colunas `email`, `hashed_password` bcrypt, `role`) ou renomeie a tabela do TCU
  Leads e ajuste as FKs (`tcu_leads.assignee_id`, `tcu_lead_notes.author_id`).
- Aponte `DATABASE_URL` para o banco comum. A migração leve cria as tabelas que
  faltarem sem tocar nas existentes.

### Opção C — Fundir os códigos (monorepo/único deploy)
- **Backend:** copie `app/models/*`, `app/services/*`, `app/routers/*` para o
  projeto destino; monte os routers (`app.include_router`) e chame, no startup,
  as funções de `main.py` (`_run_light_migrations`, `_backfill_settings_defaults`,
  `start_scheduler`). Reaproveite ou substitua `core/auth.py`.
- **Frontend:** as páginas em `app/` são autocontidas (usam `lib/api.ts`,
  `lib/tcu.ts`, `components/*`). Reaponte `NEXT_PUBLIC_API_URL`. O `Sidebar`
  define a navegação.
- **Dependências obrigatórias no backend:** Playwright + Chromium (ver Dockerfile),
  senão a captação do TCU **não funciona** (WAF). `ANTHROPIC_API_KEY` é opcional
  (degrada para regex). SMTP é opcional (digest).

### Checklist de integração
- [ ] Definir estratégia de **auth** (A/B/C) e o modelo de `users`.
- [ ] Definir o **banco** (mesmo Postgres? schema separado?).
- [ ] Garantir **Playwright/Chromium** no ambiente do backend (imagem/host).
- [ ] Setar env: `DATABASE_URL`, `SECRET_KEY`, `ANTHROPIC_API_KEY`, SMTP.
- [ ] Rodar o startup (migração + seed) uma vez; conferir a tela **Configuração**.
- [ ] Calibrar a fonte **BTCU** (ver §13) e testar a fonte de processos
      (`/monitor/test-source/processos`) num dia com autuados.
- [ ] Revisar a **postura de conformidade** (LGPD/OAB) com o jurídico.

---

## 13. Lacunas conhecidas e roadmap (honesto)

| Item | Situação | Próximo passo |
|---|---|---|
| Autuados + responsáveis (navegador) | ✅ funcionando (provado: 9 responsáveis reais) | — |
| Domínio RITCU + score | ✅ novo | afinar pesos com uso real |
| Extração de chamamentos (IA) | ✅ engine pronto | ligar à fonte BTCU |
| **BTCU (citações/audiências diárias)** | 🟡 acesso genérico + `POST /test-btcu` de calibração | rodar o teste no servidor → confirmar base/campo/estrutura → escrever a **ingestão** (baixar peça, `parse_caderno`+`extract_block`, `upsert_lead`) |
| Embaixadas/estatais (Radar) | 🟡 presets prontos | testar cada URL e ajustar `item_selector` |
| **Busca ampla na internet** | 🔴 não implementada | integrar uma **API de busca** (Google CSE/Bing/SerpAPI) no `external/` — o servidor não tem WebSearch nativo |
| Migrações | ⚠️ "migração leve" caseira (só ADD COLUMN) | migrar para **Alembic** se o schema evoluir muito |
| Testes automatizados | ⚠️ há scripts de validação manuais | adicionar pytest (o código puro é testável offline; o TCU exige o servidor) |
| Playwright: 1 navegador por execução | ⚠️ ok para job diário | se escalar, considerar pool/reuso |

**Sobre o BTCU (a fonte mais rica):** o padrão de acesso é o mesmo dos processos
(`/rest/publico/base/**btcu**/documentosResumidos`), com um campo de data
(`DTPUBLICACAO`/`DTATUALIZACAO`) a confirmar. O `probe_btcu` tenta as combinações e
mostra os campos retornados. **Só depois de ver a estrutura real** vale escrever a
ingestão — não faça às cegas (foi a lição dos processos).

---

## 14. Rodar localmente / testar

Backend (SQLite, sem Docker):
```bash
cd backend && python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt && playwright install chromium
export SECRET_KEY=dev ADMIN_EMAIL=admin@x.com ADMIN_PASSWORD=x ADMIN_NAME=Admin
uvicorn app.main:app --reload   # http://localhost:8000/docs
```
Frontend:
```bash
cd frontend && npm install
NEXT_PUBLIC_API_URL=http://localhost:8000 npm run dev   # http://localhost:3000
```
**Rede externa bloqueada em dev?** A lógica pura (parser, extractor, `tcu_domain`,
classifier, dedupe) é testável offline com mocks; as fontes do TCU/DOU só
respondem do servidor (calibre pelos botões "Testar"). O `browser.py` pode ser
validado contra um servidor HTTP local (ver histórico de testes).

---

### Contato de conhecimento
As decisões e o passo-a-passo detalhado (inclusive as capturas do DevTools que
revelaram o endpoint `documento` e os cookies do F5) estão no histórico do projeto.
Em caso de dúvida sobre "por que assim?", a resposta quase sempre está na §11.
