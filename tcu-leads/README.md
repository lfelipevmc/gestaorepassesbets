# TCU Leads

Sistema **independente** de captação de oportunidades a partir do **Diário
Eletrônico/BTCU** e das **APIs abertas do Tribunal de Contas da União**.
Identifica, qualifica e prioriza leads (citações, audiências, notificações,
acórdãos condenatórios) e detecta os **processos autuados a cada dia**.

Este projeto não depende de nenhum outro sistema: tem o seu próprio login, o seu
próprio banco de dados e o seu próprio endereço.

---

## Para quem não é técnico — o que é

Pense num **radar automático** do TCU. Todo dia ele:

1. **lê** as publicações do TCU (inclusive baixando os PDFs do diário);
2. **reconhece** quem foi intimado, o processo, o valor, o prazo e o tema;
3. **compara a lista de processos com a do dia anterior** para descobrir o que
   foi **autuado (aberto) naquele dia**;
4. **organiza** tudo num painel, com uma **nota de 0 a 100** por oportunidade;
5. **envia um resumo por e-mail** quando surge algo relevante.

> **Regra importante (OAB/LGPD).** É uma **ferramenta interna**: mostra as
> oportunidades para a equipe decidir, **sem enviar mensagem automática a
> ninguém** (a captação de clientela é vedada — OAB Prov. 205/2021). Cada lead
> tem campo para a base de legítimo interesse (LGPD) e para a objeção do titular.
> CPF não é enriquecido.

## Como usar (depois de publicado)

1. Entre com o e-mail/senha de administrador (definidos no arquivo `.env`).
2. Em **Configuração**, ligue a coleta diária e escolha as fontes.
3. Já dá para começar sem depender de nada: em **Oportunidades → Ingerir
   Diário**, cole o texto ou envie o PDF de uma edição do diário do TCU.
4. Acompanhe as oportunidades no painel e os **Processos Autuados** na aba própria.

---

## Para quem vai publicar (técnico)

### Stack
- **Backend:** Python 3.12 + FastAPI + SQLAlchemy + APScheduler. Banco: SQLite
  (padrão, zero config) ou PostgreSQL (produção). IA opcional via Claude API.
- **Frontend:** Next.js 14 (App Router) + Tailwind.

### Rodar com Docker (recomendado)
```bash
cd tcu-leads
cp .env.example .env      # edite SECRET_KEY, ADMIN_*, ANTHROPIC_API_KEY, SMTP_*
docker compose up --build
```
- Frontend: http://localhost:3000  ·  Backend/API: http://localhost:8000
- Primeiro acesso: e-mail/senha definidos em `ADMIN_EMAIL`/`ADMIN_PASSWORD`.

### Rodar sem Docker (desenvolvimento)
```bash
# Backend
cd tcu-leads/backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload

# Frontend (outro terminal)
cd tcu-leads/frontend
npm install && npm run dev
```

### Variáveis de ambiente (`.env`)
| Variável | Função |
|---|---|
| `DATABASE_URL` | Banco (SQLite por padrão; Postgres em produção). |
| `SECRET_KEY` | Segredo do login (troque por algo longo e aleatório). |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` | Usuário admin criado no 1º start. |
| `ANTHROPIC_API_KEY` | Extração com IA. Sem ela, roda em modo regex. |
| `SMTP_*`, `DIGEST_TO`, `DIGEST_MIN_SCORE` | Resumo diário por e-mail (opcional). |

### Fontes de dados
| Fonte | Status | Uso |
|---|---|---|
| API de Acórdãos | Confirmada | Acórdãos condenatórios (débito/multa). |
| Download de PDF do BTCU | Confirmada | Baixa a edição para parsear os editais SEPROC. |
| Pautas das sessões | Confirmada | Early-warning. |
| BrasilAPI CNPJ | Confirmada | Enriquecimento de PJ (nunca em massa). |
| Listagem de edições do BTCU | **A capturar** | Não documentada; configure em **Configuração**. |
| Listagem de processos (autuados) | **A capturar** | Idem; alimenta a detecção diária de autuados. |

### Detecção de processos autuados
A cada coleta, o sistema registra todo número de processo inédito (visto nas
fontes ou na listagem dedicada) com a data de detecção. Comparando com o que já
era conhecido, obtém-se a lista de **autuados do dia** (aba *Processos Autuados*).

### Migração para repositório próprio
Esta pasta é autocontida. Para publicá-la como repositório separado, basta
copiá-la para um novo repositório Git — não há dependência do restante deste
projeto.
