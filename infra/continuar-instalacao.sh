#!/bin/bash
# Segunda parte da instalação — rode após criar o .env
DOMINIO=${1:-"repasses.vascav.com.br"}
DIR="/opt/gestaorepassesbets"

echo "=== Configurando Nginx ==="
cp $DIR/infra/nginx.conf /etc/nginx/sites-available/repasses
# Substitui o domínio no arquivo de configuração
sed -i "s/repasses.vascav.com.br/$DOMINIO/g" /etc/nginx/sites-available/repasses
ln -sf /etc/nginx/sites-available/repasses /etc/nginx/sites-enabled/repasses
rm -f /etc/nginx/sites-enabled/default

echo "=== Obtendo certificado HTTPS gratuito (Let's Encrypt) ==="
certbot --nginx -d $DOMINIO --non-interactive --agree-tos -m admin@vascav.com.br

echo "=== Construindo e subindo os containers ==="
cd $DIR
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d

echo "=== Reiniciando Nginx ==="
systemctl restart nginx
systemctl enable nginx

echo ""
echo "✅ Instalação concluída!"
echo "Acesse: https://$DOMINIO"
