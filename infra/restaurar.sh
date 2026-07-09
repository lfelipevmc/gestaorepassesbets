#!/usr/bin/env bash
#
# Restauração de backup do sistema Gestão de Haveres de Bets.
#
# ATENÇÃO: isto SUBSTITUI o banco de dados atual e os arquivos enviados pelos
# do backup escolhido. Use com cuidado. Recomenda-se testar a restauração num
# ambiente separado periodicamente (backup não testado não é backup).
#
# Uso:
#   ./infra/restaurar.sh                      -> lista os backups disponíveis
#   ./infra/restaurar.sh daily/backup-2026-07-09.tar.gz.gpg
#
set -euo pipefail

cd "$(dirname "$0")/.."
COMPOSE="docker compose -f docker-compose.prod.yml"

set -a
# shellcheck disable=SC1091
source ./.env
set +a

: "${SPACES_KEY:?}"; : "${SPACES_SECRET:?}"; : "${SPACES_BUCKET:?}"
: "${SPACES_REGION:=nyc3}"
: "${SPACES_ENDPOINT:=https://${SPACES_REGION}.digitaloceanspaces.com}"
: "${BACKUP_GPG_PASSPHRASE:?}"
: "${POSTGRES_USER:=postgres}"; : "${POSTGRES_DB:=gestaobets}"

aws_s3() {
  AWS_ACCESS_KEY_ID="$SPACES_KEY" AWS_SECRET_ACCESS_KEY="$SPACES_SECRET" \
  aws --endpoint-url "$SPACES_ENDPOINT" --region "$SPACES_REGION" "$@"
}

ALVO="${1:-}"
if [ -z "$ALVO" ]; then
  echo "Backups disponíveis no Spaces ($SPACES_BUCKET):"
  echo "--- Diários ---";  aws_s3 s3 ls "s3://$SPACES_BUCKET/daily/"   || true
  echo "--- Semanais ---"; aws_s3 s3 ls "s3://$SPACES_BUCKET/weekly/"  || true
  echo "--- Mensais ---";  aws_s3 s3 ls "s3://$SPACES_BUCKET/monthly/" || true
  echo
  echo "Para restaurar:  ./infra/restaurar.sh daily/backup-AAAA-MM-DD.tar.gz.gpg"
  exit 0
fi

echo "!!! ATENÇÃO: isto vai SUBSTITUIR o banco e os arquivos atuais por: $ALVO"
read -r -p "Digite 'CONFIRMAR' para prosseguir: " ok
[ "$ok" = "CONFIRMAR" ] || { echo "Cancelado."; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "Baixando do Spaces..."
aws_s3 s3 cp "s3://$SPACES_BUCKET/$ALVO" "$WORK/pacote.gpg"

echo "Descriptografando..."
gpg --batch --yes --passphrase "$BACKUP_GPG_PASSPHRASE" -o "$WORK/pacote.tar.gz" -d "$WORK/pacote.gpg"
tar -xzf "$WORK/pacote.tar.gz" -C "$WORK"

echo "Restaurando banco de dados..."
$COMPOSE exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" < "$WORK/banco.sql"

echo "Restaurando arquivos enviados..."
CID="$($COMPOSE ps -q backend)"
if [ -n "$CID" ] && [ -d "$WORK/uploads" ]; then
  docker cp "$WORK/uploads/." "$CID:/app/uploads/"
fi

echo "Reiniciando serviços..."
$COMPOSE restart backend

echo "Restauração concluída a partir de: $ALVO"
