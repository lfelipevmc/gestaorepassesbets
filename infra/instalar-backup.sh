#!/usr/bin/env bash
#
# Instala e agenda o backup automático diário no servidor.
# Rode UMA vez no servidor, a partir de /opt/gestaorepassesbets, como root.
#
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT_DIR="$(pwd)"

echo "== 1. Instalando dependências (aws-cli v2, gnupg) =="
apt-get update -y
apt-get install -y gnupg curl unzip

# AWS CLI v2 pelo instalador oficial (o pacote apt 'awscli' foi removido no Ubuntu Noble)
if ! command -v aws >/dev/null 2>&1; then
  TMP="$(mktemp -d)"
  ARCH="$(uname -m)"   # x86_64 ou aarch64
  curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-${ARCH}.zip" -o "$TMP/awscliv2.zip"
  unzip -q "$TMP/awscliv2.zip" -d "$TMP"
  "$TMP/aws/install" --update
  rm -rf "$TMP"
fi
echo "  aws-cli: $(aws --version 2>&1)"

echo "== 2. Verificando variáveis no .env =="
for v in SPACES_KEY SPACES_SECRET SPACES_BUCKET BACKUP_GPG_PASSPHRASE; do
  if ! grep -q "^${v}=" .env; then
    echo "  ⚠ Falta ${v} no .env — adicione antes de continuar."
  fi
done

chmod +x infra/backup.sh infra/restaurar.sh
touch /var/log/haveres-backup.log

echo "== 3. Agendando no cron (todo dia às 02:00) =="
CRON_LINE="0 2 * * * cd ${PROJECT_DIR} && ./infra/backup.sh >> /var/log/haveres-backup.log 2>&1"
# remove agendamento anterior deste script e recria
( crontab -l 2>/dev/null | grep -v "infra/backup.sh" ; echo "$CRON_LINE" ) | crontab -

echo "== 4. Rodando um backup de teste agora =="
./infra/backup.sh

echo
echo "✅ Backup instalado e testado. Agendado diariamente às 02:00."
echo "   Log: /var/log/haveres-backup.log"
echo "   Listar backups:  ./infra/restaurar.sh"
