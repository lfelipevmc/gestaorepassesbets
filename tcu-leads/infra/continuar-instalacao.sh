#!/bin/bash
# Segunda parte da instalação do TCU Leads — rode após criar o .env.
# Uso: bash continuar-instalacao.sh tculeads.vascav.com.br [email-para-certificado]
set -e

DOMINIO=${1:-"tculeads.vascav.com.br"}
EMAIL=${2:-"admin@$DOMINIO"}
DIR="/opt/gestaorepassesbets/tcu-leads"

if [ ! -f "$DIR/.env" ]; then
  echo "ERRO: $DIR/.env não encontrado. Crie-o antes (veja setup-servidor.sh)."
  exit 1
fi

echo "=== Configurando Nginx para $DOMINIO ==="
cp "$DIR/infra/nginx-http.conf" /etc/nginx/sites-available/tculeads
sed -i "s/tculeads.vascav.com.br/$DOMINIO/g" /etc/nginx/sites-available/tculeads
ln -sf /etc/nginx/sites-available/tculeads /etc/nginx/sites-enabled/tculeads
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx

echo "=== Construindo e subindo os containers ==="
cd "$DIR"
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d

echo "=== Obtendo certificado HTTPS gratuito (Let's Encrypt) ==="
certbot --nginx -d "$DOMINIO" --non-interactive --agree-tos -m "$EMAIL" --redirect

systemctl enable nginx

echo ""
echo "✅ Instalação concluída!"
echo "Acesse: https://$DOMINIO"
echo "Login inicial: use ADMIN_EMAIL / ADMIN_PASSWORD definidos no .env (troque a senha depois)."
