# Mensura — MVP

Sistema **apartado** para mensurar o consultivo jurídico prestado por WhatsApp:
capta as conversas, separa cada **atendimento**, estima esforço e **valor equivalente**,
gera **tarefas** quando há providência e consolida um **Relatório de Valor Entregue**
na pasta do cliente — base objetiva para honorários e reajuste de contrato.

> MVP para validar o valor com conversas reais. Não é ainda a versão de produção.

## Rodar

```bash
cd consultivo
./run.sh            # cria venv, instala dependências e sobe em http://localhost:8100
```

Ou manualmente:

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8100
```

Abra **http://localhost:8100** e clique em **Popular demonstração** para ver o sistema
funcionando com conversas de exemplo. (Ou `python -m app.seed`.)

## Como funciona

1. **Captura** — o webhook oficial do WhatsApp Business recebe cada mensagem.
2. **Separação** — o fluxo é cortado em *atendimentos* por intervalo de tempo (`SEGMENT_GAP_MINUTES`).
3. **Mensuração** — cada atendimento ganha resumo, tema, esforço e valor equivalente.
4. **Tarefas** — quando o atendimento termina em providência, nasce uma tarefa (a exceção).
5. **Relatório** — consolidado por cliente e gravado em `data/pastas/<cliente>/`.

O **valor equivalente** é determinístico: `minutos_estimados / 60 × valor_hora`
(a IA estima os minutos; o dinheiro é calculado no código, para ser auditável).

## IA (opcional)

- **Sem `ANTHROPIC_API_KEY`**: o sistema usa **medição heurística** e roda 100%.
- **Com chave**: usa o Claude (`AI_MODEL`, padrão `claude-opus-4-8`) para resumir,
  classificar o tema, estimar minutos e detectar providência.
  Para alto volume, considere um modelo mais econômico via `AI_MODEL`.

## WhatsApp Business (produção)

Configure no `.env`: `WA_VERIFY_TOKEN`, `WA_PHONE_NUMBER_ID`, `WA_ACCESS_TOKEN`.
No painel da Meta, aponte o webhook para `POST /webhook` (a verificação usa `GET /webhook`).

## Endpoints

| Método | Rota | O quê |
|---|---|---|
| GET  | `/` | Painel — visão geral por cliente |
| GET  | `/clientes/{id}` | Atendimentos, tarefas e valor do cliente |
| GET  | `/clientes/{id}/relatorio` | Gera e grava o Relatório de Valor Entregue |
| GET/POST | `/webhook` | Verificação e recebimento do WhatsApp oficial |
| POST | `/api/clientes` | Cadastra cliente |
| POST | `/api/simular` | Injeta uma conversa (demonstração) |
| POST | `/api/seed-demo` | Popula clientes de exemplo |
| POST | `/api/clientes/{id}/recomputar` | Refaz a segmentação/medição |

### Simular uma conversa

```bash
curl -X POST http://localhost:8100/api/simular -H "Content-Type: application/json" -d '{
  "telefone":"5511900000000","nome":"Cliente Teste",
  "mensagens":[
    {"texto":"Doutor, posso demitir por justa causa por faltas?","direcao":"in","minutos_offset":0},
    {"texto":"Depende da reiteração e da advertência prévia. Me diga o histórico.","direcao":"out","minutos_offset":6}
  ]
}'
```

## Conformidade

Dado sigiloso de cliente: hospede sob controle do escritório (LGPD/OAB), preveja o
contrato de operador (DPA) para o processamento por IA e dê ciência ao cliente de que
o atendimento é registrado e apoiado por IA.

## Stack

FastAPI · SQLAlchemy (SQLite por padrão, Postgres-ready) · Jinja2 · Claude (Anthropic).
