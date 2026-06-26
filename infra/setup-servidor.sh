#!/bin/bash
# Script de instalação do servidor — rode como root no VPS
# Uso: bash setup-servidor.sh repasses.vascav.com.br

DOMINIO=${1:-"repasses.vascav.com.br"}

echo "=== Instalando dependências ==="
apt-get update -q
apt-get install -y nginx certbot python3-certbot-nginx git curl

echo "=== Instalando Docker ==="
curl -fsSL https://get.docker.com | sh
apt-get install -y docker-compose-plugin

echo "=== Clonando o repositório ==="
cd /opt
git clone -b claude/affectionate-galileo-ptduv6 \
  https://github.com/lfelipevmc/gestaorepassesbets.git
cd gestaorepassesbets

echo "=== ATENÇÃO: crie o arquivo .env antes de continuar ==="
echo "Copie o conteúdo do seu .env local e cole aqui:"
echo "  nano /opt/gestaorepassesbets/.env"
echo ""
echo "Adicione também a linha: SITE_URL=https://$DOMINIO"
echo ""
echo "Após salvar o .env, rode:"
echo "  bash /opt/gestaorepassesbets/infra/continuar-instalacao.sh $DOMINIO"
