#!/bin/bash
# Instalação do TCU Leads num servidor (VPS Ubuntu/Debian). Rode como root.
# Uso: bash setup-servidor.sh tcu.seuescritorio.com.br [branch]
set -e

DOMINIO=${1:-"tcu.seuescritorio.com.br"}
BRANCH=${2:-"main"}
REPO="https://github.com/lfelipevmc/gestaorepassesbets.git"
DIR="/opt/gestaorepassesbets"

echo "=== Instalando dependências (nginx, certbot, git, docker) ==="
apt-get update -q
apt-get install -y nginx certbot python3-certbot-nginx git curl
curl -fsSL https://get.docker.com | sh
apt-get install -y docker-compose-plugin

echo "=== Clonando o repositório (branch: $BRANCH) ==="
if [ ! -d "$DIR" ]; then
  git clone -b "$BRANCH" "$REPO" "$DIR"
else
  cd "$DIR" && git fetch origin "$BRANCH" && git checkout "$BRANCH" && git pull origin "$BRANCH"
fi

echo ""
echo "=== PRÓXIMO PASSO: criar o arquivo de configuração (.env) ==="
echo "  cd $DIR/tcu-leads"
echo "  cp .env.example .env"
echo "  nano .env      # defina SECRET_KEY, ADMIN_EMAIL, ADMIN_PASSWORD, ANTHROPIC_API_KEY, SMTP_*"
echo "  # adicione também a linha:  SITE_URL=https://$DOMINIO"
echo ""
echo "Depois de salvar o .env, rode:"
echo "  bash $DIR/tcu-leads/infra/continuar-instalacao.sh $DOMINIO"
