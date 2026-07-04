# Como publicar o TCU Leads (VPS + subdomínio)

Guia para colocar o sistema no ar num **servidor próprio (VPS)**, acessível por um
**subdomínio do escritório** (ex.: `tculeads.vascav.com.br`), com **cadeado de
segurança (HTTPS)**.

Você não precisa entender de programação para seguir — mas peça ajuda de alguém
de TI para os passos no servidor, se preferir. Tudo já está preparado; abaixo é
só executar na ordem.

---

## Visão geral (o que vai acontecer)

1. Você contrata um **servidor (VPS)** — um computador na nuvem, ligado 24h.
2. Aponta o **subdomínio** do escritório para o endereço desse servidor.
3. Roda **dois comandos** no servidor: um instala tudo, o outro liga o sistema e
   o cadeado HTTPS.
4. Acessa `https://tculeads.vascav.com.br` e entra com o login de administrador.

---

## Passo 1 — Contratar o servidor (VPS)

Qualquer provedor serve. Sugestões e custo aproximado:
- **Hetzner** (CX22): ~€4/mês — melhor custo.
- **DigitalOcean / Vultr / Linode**: ~US$ 6/mês.

Configuração mínima recomendada: **2 GB de RAM, 1–2 vCPU, 40 GB de disco**,
sistema **Ubuntu 22.04 (ou 24.04)**. Ao criar, você recebe um **endereço IP**
(algo como `203.0.113.45`) e uma senha/chave de acesso.

## Passo 2 — Apontar o subdomínio

No painel onde fica o domínio do escritório (onde ele foi registrado), crie um
**registro do tipo A**:
- **Nome/Host:** `tculeads` (isso forma `tculeads.vascav.com.br`)
- **Valor/Aponta para:** o **IP do servidor** do Passo 1
- **TTL:** o padrão

Aguarde alguns minutos (às vezes até 1 hora) para propagar.

## Passo 3 — Instalar no servidor

Acesse o servidor (pelo terminal/SSH) e rode, **como root**:

```bash
# Baixa e prepara tudo (troque pelo seu subdomínio)
curl -fsSL https://raw.githubusercontent.com/lfelipevmc/gestaorepassesbets/main/tcu-leads/infra/setup-servidor.sh -o setup.sh
bash setup.sh tculeads.vascav.com.br
```

> Observação: enquanto este código estiver na branch de desenvolvimento, troque
> `main` pela branch correspondente, ou passe a branch como 2º argumento:
> `bash setup.sh tculeads.vascav.com.br claude/tcu-lead-capture-nz5ghz`

## Passo 4 — Preencher a configuração (.env)

O script pede para criar o arquivo de configuração. Rode:

```bash
cd /opt/gestaorepassesbets/tcu-leads
cp .env.example .env
nano .env
```

Preencha (as linhas mais importantes):
- `SECRET_KEY` — uma senha longa e aleatória (segredo do login).
- `ADMIN_EMAIL` e `ADMIN_PASSWORD` — seu login de administrador do sistema.
- `SITE_URL=https://tculeads.vascav.com.br`
- `ANTHROPIC_API_KEY` — (opcional) ativa a extração com inteligência artificial.
- `SMTP_*` e `DIGEST_TO` — (opcional) para o resumo diário por e-mail.

Salve (`Ctrl+O`, `Enter`, `Ctrl+X`).

## Passo 5 — Ligar o sistema + HTTPS

```bash
bash /opt/gestaorepassesbets/tcu-leads/infra/continuar-instalacao.sh tculeads.vascav.com.br seu-email@vascav.com.br
```

Esse comando configura o proxy, sobe o sistema e obtém o **certificado HTTPS
gratuito** (Let's Encrypt). Ao final, acesse:

**https://tculeads.vascav.com.br** — entre com o `ADMIN_EMAIL` / `ADMIN_PASSWORD`
e **troque a senha** em seguida.

---

## Depois de publicado

- **Cadastrar a equipe:** menu *Usuários* (como administrador).
- **Ligar a coleta diária:** menu *Configuração* → habilitar e escolher horário.
- **Começar já:** *Oportunidades → Ingerir Diário* (cole texto ou envie o PDF).
- **Fontes que dependem de captura** (listagem do BTCU e de processos autuados):
  configure as URLs em *Configuração* quando as capturarmos.

## Atualizar o sistema (quando houver melhorias)

```bash
cd /opt/gestaorepassesbets && git pull
cd tcu-leads && docker compose -f docker-compose.prod.yml up -d --build
```

## Backup (recomendado)

Os dados ficam no banco PostgreSQL (volume `tculeads_pgdata`). Para um backup
manual:

```bash
cd /opt/gestaorepassesbets/tcu-leads
docker compose -f docker-compose.prod.yml exec -T db pg_dump -U postgres tculeads > backup_$(date +%F).sql
```

## Segurança

- Nunca comite o arquivo `.env` (ele já é ignorado pelo Git).
- Troque a senha do administrador no primeiro acesso.
- Mantenha o servidor atualizado (`apt-get update && apt-get upgrade`).
