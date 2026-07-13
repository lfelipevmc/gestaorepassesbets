# Manual do Administrador e Desenvolvedor
## Sistema de Gestão de Haveres de Bets — Vascav Advocacia

**Versão 2.0 · Julho/2026 · Documento técnico de referência e manutenção**

> Objetivo: permitir que **qualquer desenvolvedor ou administrador** entenda, opere e
> evolua o sistema com segurança, sem depender de conhecimento tácito. Complementa o
> *Manual do Usuário* (funcionalidades tela a tela) — leia-o primeiro para conhecer o
> produto. **Nenhuma senha consta neste documento** (campos deixados em branco de
> propósito; os valores estão sob guarda do administrador).

---

# 1. Visão geral executiva

| Item | Valor |
|---|---|
| Produto | Gestão de cobrança e repasses de direito de imagem (Lei 13.756/2018; Portaria SPA/MF 41/2025) |
| Usuários | Equipe do escritório + leitores por confederação (CBTM, CBT, CBW, CBH) |
| Domínio público | **https://repasses.vascav.com.br** (HTTPS/Let's Encrypt, renovação automática) |
| Servidor | Droplet DigitalOcean "haveres-bets" · IP **159.89.88.167** · Ubuntu 24.04 · código em **/opt/gestaorepassesbets** |
| Repositório | GitHub `lfelipevmc/gestaorepassesbets` (privado) |
| Backup | Diário 02:00 (Brasília), criptografado, offsite no DigitalOcean Spaces `haveres-repasses-backups` (NYC3), retenção GFS 1 ano |
| Fuso | **America/Sao_Paulo** em toda a pilha (ver `docs/CONFIGURACAO_FUSO_HORARIO.md`) |
| E-mail operacional | Caixa dedicada **gestaorepasses@vascav.com.br** via Microsoft Graph, com acesso do app restrito a ela |

### Números do código (julho/2026)

| Camada | Tecnologia | Volume |
|---|---|---|
| Backend | Python 3.12 · FastAPI · SQLAlchemy | **~9.160 linhas** em 62 arquivos · **146 endpoints REST** |
| Frontend | TypeScript · Next.js 14.2 · React 18 · Tailwind · Recharts | **~8.700 linhas** em 30 arquivos · **18 telas** |
| Banco | PostgreSQL 16 (Docker) | **28 tabelas** |
| Infra | Docker Compose · Nginx · Certbot · Shell | ~440 linhas (compose, Dockerfiles, scripts de backup/instalação) |

---

# 2. Arquitetura

```
                                Internet (HTTPS 443)
                                        │
                          Nginx (host) — TLS Let's Encrypt
                          repasses.vascav.com.br
                           │                     │
                 /  → frontend:3000        /api, /uploads → backend:8000
                           │                     │
        ┌──────────────────┴─────┐   ┌───────────┴──────────────────┐
        │ Next.js 14 (container) │   │ FastAPI + APScheduler (cont.)│
        │ SPA + SSR, Tailwind    │   │ SQLAlchemy ORM                │
        └────────────────────────┘   └───────┬───────────┬──────────┘
                                              │           │
                                   PostgreSQL 16      volume uploads_data
                                   (volume            (PDFs, relatórios,
                                    postgres_data)     documentos)
        Integrações externas do backend:
          • Microsoft Graph  → caixa gestaorepasses@ (envio/leitura/pastas)
          • Anthropic API    → IA (rascunhos, sugestões, análise GGR)
          • SPA/MF           → planilha oficial de operadores (import/sync)
        Rotina do host:
          • cron 02:00 → infra/backup.sh → GPG AES-256 → DO Spaces (GFS)
```

Só as portas 80/443 são públicas; os containers escutam apenas em `127.0.0.1`
(`docker-compose.prod.yml`), com o Nginx do host fazendo o proxy.

---

# 3. Estrutura do repositório

```
gestaorepassesbets/
├── backend/
│   ├── Dockerfile                  # python:3.12-slim + TZ America/Sao_Paulo
│   ├── requirements.txt
│   └── app/
│       ├── main.py                 # bootstrap: create_all + migrações leves + seeds
│       ├── config.py               # Settings (pydantic-settings, lê .env)
│       ├── database.py             # engine/Session
│       ├── core/                   # auth.py (JWT+bcrypt), deps.py
│       ├── models/                 # 28 tabelas (ver §5)
│       ├── schemas/                # Pydantic (entrada/saída)
│       ├── routers/                # 20 módulos de rotas (146 endpoints)
│       └── services/               # regra de negócio (ver §4)
├── frontend/
│   ├── Dockerfile                  # node:20-alpine, build arg NEXT_PUBLIC_API_URL
│   └── src/
│       ├── app/                    # 18 páginas (App Router)
│       ├── components/             # AppShell, Sidebar, Header, ui/ (Toast, HelpTip, Modal, Badge, EmptyState)
│       └── lib/                    # api.ts (axios + interceptors), auth.ts, utils.ts
├── infra/
│   ├── backup.sh                   # dump+uploads → GPG → Spaces → retenção GFS
│   ├── restaurar.sh                # restauração com confirmação explícita
│   ├── instalar-backup.sh          # deps + cron 02:00 + teste
│   ├── nginx.conf / nginx-http.conf
│   └── setup-servidor.sh / continuar-instalacao.sh
├── docs/                           # manuais + políticas (backup, M365, fuso) + img/
├── docker-compose.yml              # desenvolvimento (hot-reload)
└── docker-compose.prod.yml         # produção (127.0.0.1 + SITE_URL)
```

---

# 4. Racional do domínio — as decisões que sustentam o código

Quem for dar manutenção precisa entender **por que** o sistema é assim:

**4.1 SSOT (fonte única da verdade).** `betting_operators` é o cadastro-mestre. Ciclos
e confederações **não duplicam** listas: leem a base e projetam. O endpoint
`GET /api/collections/{id}/board` monta o "espelho" do ciclo em tempo real.

**4.2 Conclusão efetiva.** `services/status_service.py` é o coração:
`effective_conclusions(db, confederação, mês)` devolve a situação de cada Bet no mês —
**manual vence** (tabela `operator_confederation_info.conclusion/_manual`); senão
**ENDR** (associação no mês); senão **pagou → adimplente** (`get_paid_map`, que soma
`direct_payments` + `payments` legados); senão **inadimplente**. Toda tela/relatório
que mostra situação chama esse serviço — nunca reimplemente a regra localmente.

**4.3 Ciclo-espelho + arquivamento.** Criar ciclo não insere `payments`. Recebimentos
de ciclo viram `direct_payments` (registro universal, competência anulável para o caso
"pagou sem dizer o mês"). Ciclos antigos não são apagados: `archived=true` (só admin),
histórico preservado.

**4.4 ENDR com relatório postergado.** O repasse ENDR chega **antes** do relatório
(~30 dias). `endr_payments.reference_month` é anulável; `register-report` preenche a
competência, os `bet_links` e cria as `endr_associations` do mês (suspendendo a
cobrança individual). A tela ENDR consolida tudo por leitura — nada é redigitado.

**4.5 Caixa única de e-mail.** Todo contato com Bets sai/entra por
`REPASSES_MAILBOX` (`services/email_service.py`), com cópia organizada em subpastas
por confederação ("Gestão de Repasses/CBTM…"). Respostas são casadas pelo
`conversationId` do Graph com o envio original (que carrega a confederação) —
`services/email_matcher.py`.

**4.6 Migrações leves.** Sem Alembic: `main.py::_run_light_migrations()` aplica
`ADD COLUMN IF NOT EXISTS`, novos valores de enum e `DROP NOT NULL` idempotentes no
startup. Para colunas novas, siga esse padrão; para mudanças estruturais grandes,
considere introduzir Alembic.

**4.7 Auditoria em tudo.** Ações relevantes passam por
`services/audit_service.log_action()` → tabela `audit_logs` (quem, o quê, antes/depois).
Ao criar endpoints de escrita, **sempre** registre.

---

# 5. Modelo de dados (28 tabelas — as principais)

| Grupo | Tabelas | Observações |
|---|---|---|
| Cadastro | `betting_operators`, `operator_brands`, `operator_contacts`, `operator_responsibles`, `contact_suggestions` | Base-mestre; marcas ilimitadas; sugestões da pesquisa de contatos |
| Por confederação | `confederations`, `operator_confederation_info` | Conclusão manual + anotações por par Bet×cliente |
| ENDR | `endr_entity`, `endr_associations`, `endr_payments`, `endr_payment_bet_links` | Associação por mês; repasse com competência postergada |
| Cobrança | `collection_cycles` (flag `archived`), `collection_events` | Eventos = linha do tempo/evidência |
| Financeiro | `direct_payments` (recibo universal), `payments`+`payment_receipts` (legado, ainda lidos), `redistributions`+`redistribution_items`, `beneficiaries`, `distribution_rules` | Fase 1 e Fase 2 |
| Comunicação | `email_messages` (protocolo, conversationId), `message_templates` | Conciliação e modelos |
| Gestão | `users`, `audit_logs`, `documents` (com `reference_month`), `admin_reminders`, `task_checks`, `office_settings` | Papéis: admin / office / confederation_viewer |

---

# 6. Rotinas automáticas (scheduler)

> 🚫 **POLÍTICA (incidente de 12/07/2026):** o sistema **NUNCA envia e-mails ou
> mensagens automáticas aos agentes operadores**. Todo envio é manual, revisado
> na tela e **autorizado com a senha de login** do usuário (único caminho:
> `POST /api/collections/{id}/send-confirmed`; a autorização e as tentativas com
> senha errada ficam na auditoria — `SEND_AUTHORIZED` / `SEND_AUTH_FAIL`).
> É proibido adicionar jobs de envio a Bets no `scheduler.py`.

`services/scheduler.py` — APScheduler, fuso **America/Sao_Paulo**. Apenas rotinas
de leitura/organização e um e-mail interno ao escritório:

| Horário | Job | Função |
|---|---|---|
| 05:30 dia 1º | `job_monthly_cycle_close` | Fecha o status dos ciclos do mês anterior (sem envios) |
| 06:00 dia 1º | `job_monthly_office_report` | Dossiê do mês anterior → e-mail do **próprio escritório** |
| 06:00 dom | `job_weekly_contact_research` | Pesquisa de contatos públicos (gera sugestões) |
| 07:00 | `job_sync_operators` | Sincronização com a planilha SPA/MF (leitura) |
| 07:30 | `job_redistribution_deadline_alerts` | Alerta interno de prazos da Fase 2 (auditoria) |
| 08:15, 13:15, 18:15 | `job_sync_inbox` | **Lê** respostas da caixa dedicada + arquiva por pasta |
| 02:00 (cron do host) | `infra/backup.sh` | Backup GFS criptografado → Spaces |

Os dias de 1ª/2ª notificação configurados por confederação passaram a alimentar
apenas o painel **A Fazer** (sugestão de tarefa ao usuário) — nunca disparos.

---

# 7. Infraestrutura e operação

### 7.1 Produção

- **DNS:** Registro.br → `repasses.vascav.com.br` → A `159.89.88.167`.
- **Nginx (host):** proxy 443→3000 (site) e 443→8000 (`/api`, `/uploads`); certificado
  Let's Encrypt com renovação automática (certbot.timer).
- **Compose de produção:** `docker-compose.prod.yml` — 3 serviços (db/backend/frontend),
  portas em `127.0.0.1`, `SITE_URL` do `.env` vira `NEXT_PUBLIC_API_URL` no build.

**Atualizar o sistema (deploy):**
```bash
ssh root@159.89.88.167          # (chave SSH do administrador)
cd /opt/gestaorepassesbets && git pull && docker compose -f docker-compose.prod.yml up -d --build
```

**Logs e diagnóstico:**
```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs backend --tail=100
docker compose -f docker-compose.prod.yml exec backend date   # deve exibir -03
```

### 7.2 Variáveis de ambiente (`/opt/gestaorepassesbets/.env` — NUNCA versionar)

| Variável | Para quê | Valor |
|---|---|---|
| `DATABASE_URL` / `POSTGRES_PASSWORD` | Conexão/senha do Postgres | *(em branco — cofre)* |
| `SECRET_KEY` | Assinatura dos JWT | *(em branco — cofre)* |
| `SITE_URL` | URL pública (build do front) | `https://repasses.vascav.com.br` |
| `AZURE_CLIENT_ID` / `AZURE_TENANT_ID` | App "Gestão Repasses Bets" | `30f8e66e-…48177` / *(tenant)* |
| `AZURE_CLIENT_SECRET` | Segredo do app (expira! anotar validade) | *(em branco — cofre)* |
| `REPASSES_MAILBOX` | Caixa dedicada de cobrança | `gestaorepasses@vascav.com.br` |
| `REPASSES_FOLDER_ROOT` | Pasta-mãe no Outlook | `Gestão de Repasses` |
| `OFFICE_EMAIL` | Destino da revisão interna | *(e-mail do escritório)* |
| `ANTHROPIC_API_KEY` | IA (rascunhos, GGR, sugestões) | *(em branco — cofre)* |
| `SPACES_KEY` / `SPACES_SECRET` | Chave limitada ao bucket de backup | *(em branco — cofre)* |
| `SPACES_BUCKET` / `SPACES_REGION` | Destino offsite | `haveres-repasses-backups` / `nyc3` |
| `BACKUP_GPG_PASSPHRASE` | Criptografia dos backups — **sem ela não há restauração** | *(em branco — cofre + cópia offline)* |

### 7.3 Integrações externas

| Serviço | Uso | Onde no código | Referência |
|---|---|---|---|
| **Microsoft Graph (M365)** | Envio/leitura da caixa dedicada, pastas por confederação, movimentação de mensagens | `services/email_service.py`, `email_matcher.py` | `docs/CONFIGURACAO_M365.md` — inclui a **Application Access Policy** que restringe o app à caixa `gestaorepasses` (testado: demais caixas *Denied*) |
| **Anthropic API** | Rascunho de cobrança, sugestão de vínculo de e-mail, análise de divergência GGR | `services/ai_service.py` | Falhas degradam para templates/fluxo manual |
| **SPA/MF** | Base oficial de agentes autorizados | `services/mf_scraper.py` + importação de planilha | Sincronização diária 07:00 |
| **DigitalOcean Spaces** | Backup offsite (S3-compatível, aws-cli v2) | `infra/backup.sh` | `docs/POLITICA_BACKUP.md` |

---

# 8. Auditoria, Controles Internos, Backup e Governança

*Seção de referência para compliance (ISO 9001 / LGPD).*

### 8.1 Trilha de auditoria
- Tabela `audit_logs`: ação, entidade, valores antes/depois, usuário, confederação,
  timestamp. Sem endpoint de exclusão — **trilha imutável via aplicação**.
- Tela Auditoria com filtros combináveis e exportação PDF (evidência).
- Comunicações têm **protocolo único** (`SIGLA-AAAAMM-Nº`) e comprovante formal.

### 8.2 Controle de acesso
- Papéis: `admin` (tudo: arquivar ciclos, regras de rateio, usuários), `office`
  (operação), `confederation_viewer` (leitura restrita ao próprio cliente — filtros
  aplicados no backend, não só na tela).
- Senhas com **bcrypt**; sessão JWT expira em 8h; um login por pessoa (rastreabilidade).
- Postgres com senha forte, acessível apenas pela rede interna do Docker.

### 8.3 Menor privilégio nas integrações
- **M365:** Application Access Policy limita o app à caixa `gestaorepasses` — mesmo
  com permissões "all mailboxes", o Exchange nega as demais (verificado com
  `Test-ApplicationAccessPolicy`).
- **Spaces:** chave *Limited Access* somente ao bucket de backup.
- Segredos apenas no `.env` do servidor (fora do git; `.gitignore` cobre `*.env`).

### 8.4 Backup e continuidade (resumo — detalhes em `docs/POLITICA_BACKUP.md`)
- **3-2-1:** banco vivo + dump local + cópia offsite (Spaces).
- Diário 02:00 · **GFS**: 30 diários, 12 semanais, 12 mensais (**cobertura de 1 ano**).
- Conteúdo: `pg_dump` completo + volume de uploads; **GPG AES-256** em repouso.
- **Alerta por e-mail em falha** (nada de backup morrendo em silêncio).
- Restauração documentada (`infra/restaurar.sh`) e **testada** (09/07/2026, positivo);
  meta: teste trimestral registrado na política.
- Recomendação adicional: snapshots do droplet no painel DO (camada de servidor inteiro).

### 8.5 LGPD
- Dados pessoais tratados: contatos/responsáveis das Bets e usuários internos —
  finalidade contratual/legal (cobrança de obrigação prevista em lei).
- Medidas: HTTPS, criptografia de backup, acesso por papel, trilha de auditoria,
  caixa segregada, retenção definida. Art. 37 (registro das operações) atendido pela
  auditoria + políticas versionadas.

### 8.6 Gestão de mudanças
- Todo o código em Git; alterações via commits descritivos (67+ commits) e deploy por
  `git pull` — nada editado direto no servidor.
- Migrações idempotentes no startup (seguro re-executar).
- Documentos normativos versionados: `POLITICA_BACKUP.md`, `CONFIGURACAO_M365.md`,
  `CONFIGURACAO_FUSO_HORARIO.md`, manuais.

### 8.7 Riscos residuais e recomendações
| Risco | Mitigação atual | Próximo passo sugerido |
|---|---|---|
| Expiração do client secret (M365) | Documentado | Registrar validade + lembrete no A Fazer |
| Perda da passphrase GPG | Cofre + cópia offline | Revisar guarda a cada teste trimestral |
| Ausência de 2FA no login | Senhas fortes + JWT 8h | Avaliar 2FA/e-mail OTP em evolução futura |
| Dependência de 1 droplet | Backup 3-2-1 testado | Ativar snapshots DO; avaliar standby futuro |

---

# 9. Runbook (tarefas comuns do administrador)

| Tarefa | Como |
|---|---|
| **Deploy** | `cd /opt/gestaorepassesbets && git pull && docker compose -f docker-compose.prod.yml up -d --build` |
| **Ver backups** | `./infra/restaurar.sh` (lista diários/semanais/mensais) |
| **Restaurar backup** | `./infra/restaurar.sh daily/backup-AAAA-MM-DD.tar.gz.gpg` (pede CONFIRMAR) |
| **Backup manual agora** | `./infra/backup.sh` |
| **Trocar senha de usuário** | Tela Usuários (admin) — ou via exec no backend com `get_password_hash` |
| **Criar/promover admin** | Script Python via `docker compose exec backend python -c "…"` (padrão usado na implantação) |
| **Logs de e-mail** | `docker compose -f docker-compose.prod.yml logs backend | grep -i mail` |
| **Renovar certificado** | Automático; forçar: `certbot renew` |
| **Testar restrição M365** | `Test-ApplicationAccessPolicy` (PowerShell — ver doc M365) |

---

# 10. Guia do desenvolvedor

### 10.1 Rodar localmente
```bash
git clone git@github.com:lfelipevmc/gestaorepassesbets.git
cd gestaorepassesbets
cp .env.example .env            # preencha o mínimo (pode deixar integrações vazias)
docker compose up --build      # dev: hot-reload no backend; front em :3000, API em :8000
```
Login inicial de desenvolvimento: criado pelo seed em `main.py` (admin padrão) — em
produção esse usuário foi substituído/removido.

### 10.2 Padrões para evoluir
- **Novo endpoint:** router em `app/routers/…` + schema Pydantic + `log_action` nas
  escritas + filtro por papel quando aplicável. Registre o router em `main.py`.
- **Nova coluna:** adicione no model **e** em `_run_light_migrations()`.
- **Nova tela:** `frontend/src/app/<rota>/page.tsx` + funções em `lib/api.ts`;
  use `Header` (icon+help), `toast` (nunca `alert`), `table-wrap` nas tabelas,
  `HelpTip` nas abas e `EmptyState` para vazios.
- **Situação de Bet:** sempre via `status_service.effective_conclusions` — nunca
  recalcule na mão.
- **Verificações antes do commit:** `python -m compileall backend/app` e
  `cd frontend && npx tsc --noEmit && npx next build`.

### 10.3 Mapa rápido "quero mexer em…"
| Assunto | Arquivo(s) |
|---|---|
| Regra Adimplente/Inadimplente/ENDR | `backend/app/services/status_service.py` |
| Board do ciclo / notificação / SPA | `backend/app/routers/collections.py` |
| Envio e pastas de e-mail | `backend/app/services/email_service.py` |
| Conciliação de respostas | `backend/app/services/email_matcher.py` |
| Painel A Fazer | `backend/app/routers/tasks.py` + `frontend/src/app/tarefas/page.tsx` |
| Acompanhamento ENDR | `backend/app/routers/endr.py` + `frontend/src/app/endr/page.tsx` |
| Relatórios por confederação | `backend/app/routers/reports.py` + `frontend/src/app/relatorios/page.tsx` |
| Gráfico de inadimplentes | `backend/app/routers/alerts.py` + `frontend/src/app/dashboard/page.tsx` |
| Shell/menu/toast/ajuda | `frontend/src/components/…` |

---

# 11. Credenciais e segredos (preencher offline — manter fora do git)

| Item | Onde vive | Valor |
|---|---|---|
| Senha do droplet/SSH (chave) | Máquina do administrador | ____________________ |
| Senha do Postgres | `.env` (servidor) + cofre | ____________________ |
| `SECRET_KEY` (JWT) | `.env` (servidor) + cofre | ____________________ |
| `AZURE_CLIENT_SECRET` (expira em: ______) | `.env` + cofre | ____________________ |
| `ANTHROPIC_API_KEY` | `.env` + cofre | ____________________ |
| `SPACES_KEY` / `SPACES_SECRET` | `.env` + cofre | ____________________ |
| **`BACKUP_GPG_PASSPHRASE`** ⚠️ | `.env` + **cópia offline obrigatória** | ____________________ |
| Senha do admin do sistema (felipe@vascav.com.br) | Cofre pessoal | ____________________ |
| Login GitHub / token de deploy | Cofre | ____________________ |

---

*Manual do Administrador e Desenvolvedor · v2.0 (julho/2026) · Mantenha este documento
atualizado a cada mudança relevante de arquitetura, integração ou política.*
