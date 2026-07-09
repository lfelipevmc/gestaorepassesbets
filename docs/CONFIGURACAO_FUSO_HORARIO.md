# Configuração de Fuso Horário
### Sistema de Gestão de Haveres de Bets — Vascav Advocacia

**Versão:** 1.0 · **Última atualização:** julho/2026

Todo o sistema opera em **horário de Brasília** (`America/Sao_Paulo`). Este
documento registra onde o fuso é configurado e o que fazer ao implantar/atualizar
o servidor.

---

## 1. Onde o fuso é aplicado

| Camada | Configuração | Efeito |
|--------|--------------|--------|
| **Agendador de tarefas** (APScheduler) | `BackgroundScheduler(timezone="America/Sao_Paulo")` em `backend/app/services/scheduler.py` | Notificações, relatórios e demais rotinas disparam no horário de Brasília |
| **Container do backend** | `ENV TZ=America/Sao_Paulo` + `tzdata` no `backend/Dockerfile`; `TZ` no `docker-compose*.yml` | `datetime.now()`, logs e a aplicação em Brasília |
| **Container do banco (Postgres)** | `TZ` e `PGTZ=America/Sao_Paulo` no `docker-compose*.yml` | `now()` / `func.now()` (colunas `created_at`, etc.) em Brasília |
| **Servidor (droplet)** | `timedatectl set-timezone America/Sao_Paulo` | Cron do backup (02:00) e hora do host em Brasília |
| **Frontend** | Datas exibidas com `toLocaleString("pt-BR")` | Usa o fuso do navegador do usuário (já Brasília no escritório) |

## 2. Gravação de datas/horas

- Os carimbos de data/hora de negócio são gravados com **`datetime.now()`**
  (horário local de Brasília), coerentes com o `func.now()` do banco.
- **Exceção:** a expiração do token de login (JWT) permanece em **UTC**
  (`datetime.utcnow()` em `backend/app/core/auth.py`), por exigência do padrão
  JWT. Isso é interno e não afeta o que o usuário vê.

## 3. Passos ao implantar/atualizar o servidor

```bash
# 1. Fuso do próprio servidor (uma vez; vale para o cron do backup e a hora do host)
sudo timedatectl set-timezone America/Sao_Paulo

# 2. Atualizar e reconstruir (o banco reinicia para pegar o novo fuso)
cd /opt/gestaorepassesbets && git pull && docker compose -f docker-compose.prod.yml up -d --build
```

Conferir que o backend está em Brasília (deve mostrar o horário com `-03`):

```bash
docker compose -f docker-compose.prod.yml exec backend date
```

## 4. Observação sobre dados anteriores

Registros criados **antes** desta configuração foram gravados em UTC e podem
aparecer ~3 horas deslocados. Registros criados a partir da adoção do fuso ficam
corretos em horário de Brasília.

---

*Referência para a TI do escritório. Nenhum segredo é incluído neste documento.*
