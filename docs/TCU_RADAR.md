# Radar TCU — Captação de Oportunidades

Módulo de monitoramento do **Diário Eletrônico/BTCU** e das **APIs abertas do
Tribunal de Contas da União** para identificar, qualificar e priorizar
oportunidades de atuação do escritório.

> **Postura jurídica (leia antes de operar).** Este é um **instrumento interno
> de inteligência**. Os dados provêm de fontes públicas (Diário Oficial/BTCU) e
> servem à priorização de trabalho e à preparação de conteúdo informativo
> qualificado. **Não há — e não deve haver — contato ativo/automático com as
> partes recém-intimadas**: a captação de clientela é vedada pelo **Provimento
> OAB nº 205/2021 (arts. 3º e 6º)** e pelo Código de Ética. Cada lead possui
> campo para registro da **base de legítimo interesse (LGPD)** — conforme o teste
> de balanceamento da ANPD (Guia de 2024: finalidade → necessidade →
> balanceamento e salvaguardas) — e uma flag de **objeção do titular**. **CPF
> não é enriquecido**; usa-se apenas o que o próprio TCU publica.

---

## 1. O que o sistema faz

Pipeline diário: **descobrir → baixar → parsear → classificar/extrair →
deduplicar → enriquecer → armazenar**, com cada execução registrada para
auditoria (tela *Configuração → Execuções*).

O "momento-lead" mais valioso é a **citação** (débito, 15 dias para alegações de
defesa) e a **audiência** (irregularidade sem débito, razões de justificativa),
publicadas nos **editais do SEPROC** no caderno *"Deliberações dos Colegiados"*,
além dos **acórdãos condenatórios** (débito/multa).

## 2. Fontes de dados

| Fonte | Status | Uso |
|---|---|---|
| **API de Acórdãos** (`dados-abertos.apps.tcu.gov.br/api/acordao/recupera-acordaos`) | Confirmada | Detecta acórdãos condenatórios (débito/multa). |
| **Download de PDF do BTCU** (`btcu.apps.tcu.gov.br/api/obterDocumentoPdf/{codigo}`) | Confirmada | Baixa a edição do caderno para parsear os editais. |
| **Pautas das sessões** (`dados-abertos.apps.tcu.gov.br/api/pautassessao`) | Confirmada | *Early-warning*: processos prestes a julgar. |
| **Certidões** (inabilitados / inidôneos / contas irregulares) | Confirmada | Enriquecimento de sanções prévias do responsável. |
| **BrasilAPI CNPJ** (`brasilapi.com.br/api/cnpj/v1/{cnpj}`) | Confirmada | Enriquecimento cadastral de PJ (nunca em massa). |
| **Listagem de edições do BTCU** por data/caderno | **Lacuna** | Não documentada; ver §4. |

## 3. Como operar

1. **Configuração** (`/tcu/config`): habilite a coleta diária, escolha o horário
   (o sistema já evita a janela de manutenção 20h–21h) e as fontes.
2. **Coleta**: automática (job diário) ou manual (botão *Executar coleta*).
3. **Ingestão manual** (`/tcu` → *Ingerir Diário*): cole o texto de um caderno
   ou envie o PDF baixado. Contorna a lacuna de listagem e serve para *backfill*.
4. **Qualificação**: na lista, filtre por tipo de ato, tema, valor, UF, PF/PJ e
   status; abra o lead para mover no CRM (novo → qualificado → … → em
   atendimento), registrar anotações, ver prazos (15 dias) e enriquecer o CNPJ.
5. **Conformidade**: em cada lead, registre a base de legítimo interesse e
   marque a objeção do titular quando exercida.

## 4. A lacuna do endpoint de listagem do BTCU

O TCU **não documenta** um endpoint público que liste as edições do BTCU por
data/caderno, e o WAF bloqueia sondagem automatizada. Para ativar a fonte BTCU:

1. Abra `portal.tcu.gov.br/transparencia/btcu/` no Chrome.
2. DevTools (F12) → aba **Network** → filtro **Fetch/XHR**.
3. Filtre a página por **Caderno = Deliberações** e por intervalo de datas.
4. Localize a chamada a `btcu.apps.tcu.gov.br/api/…`; copie a URL (e o corpo, se POST).
5. Em `/tcu/config`, cole a URL usando os marcadores `{data_inicio}` / `{data_fim}`.

Os itens da resposta devem conter um campo de código (`codigo` /
`codigoAutenticidade` / `key`) usado no download do PDF.

## 5. Arquitetura (arquivos)

**Backend** (`backend/app/`):
- `models/tcu.py` — `TcuLead`, `TcuLeadNote`, `TcuCnpjEnrichment`, `TcuMonitorRun`, `TcuMonitorSettings`.
- `services/tcu_parser.py` — extração de PDF (pdfplumber/PyMuPDF) + regex dos editais SEPROC/acórdãos.
- `services/tcu_sources.py` — clientes HTTP (rate-limit, retry, janela de manutenção).
- `services/tcu_extractor.py` — classificação/extração com Claude (JSON estrito, temp. 0) + score determinístico de *fallback*.
- `services/tcu_pipeline.py` — orquestração, dedupe, enriquecimento, ingestão manual.
- `routers/tcu.py` — API `/api/tcu/*`.
- `services/scheduler.py` — job diário `tcu_monitor` (horário configurável).

**Frontend** (`frontend/src/app/tcu/`):
- `page.tsx` — dashboard + lista filtrável + ingestão.
- `[id]/page.tsx` — detalhe do lead (dados, enriquecimento, CRM, painel LGPD/OAB).
- `config/page.tsx` — fontes, agendamento, captura do endpoint do BTCU e execuções.

## 6. Requisitos

- `ANTHROPIC_API_KEY` no `.env` habilita a extração com IA. **Sem a chave**, o
  sistema opera em modo degradado usando apenas o parser por regex (funciona,
  com menor cobertura de campos).
- Dependências novas: `pdfplumber`, `PyMuPDF` (já em `requirements.txt`).
