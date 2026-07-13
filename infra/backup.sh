#!/usr/bin/env bash
#
# Backup diário do sistema Gestão de Haveres de Bets.
#
# Gera um pacote criptografado contendo:
#   - dump completo do banco PostgreSQL (pg_dump)
#   - todos os arquivos enviados (uploads: relatórios, documentos, comprovantes)
# e envia para o DigitalOcean Spaces (armazenamento externo/offsite), aplicando
# retenção GFS (diário 30d / semanal 12s / mensal 12m). Em caso de falha, dispara
# um e-mail de alerta reutilizando a integração Microsoft 365 do próprio sistema.
#
# Rode a partir de /opt/gestaorepassesbets. Configuração vem do arquivo .env.
#
set -euo pipefail

# ---------------------------------------------------------------------------
# Configuração (lida do .env do projeto)
# ---------------------------------------------------------------------------
cd "$(dirname "$0")/.."          # raiz do projeto (/opt/gestaorepassesbets)
PROJECT_DIR="$(pwd)"
COMPOSE="docker compose -f docker-compose.prod.yml"

# Carrega variáveis do .env de forma robusta — sem `source`, para tolerar valores com
# espaços (ex.: REPASSES_FOLDER_ROOT=Gestão de Repasses), com `=` (secrets/base64) ou aspas.
load_env() {
  local file="${1:-./.env}"
  [ -f "$file" ] || return 0
  local key val
  while IFS='=' read -r key val || [ -n "$key" ]; do
    key="${key%%[[:space:]]}"; key="${key##[[:space:]]}"
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue   # ignora comentários/linhas inválidas
    val="${val%$'\r'}"                                      # remove CR de arquivos salvos no Windows
    if [[ "$val" == \"*\" ]]; then val="${val#\"}"; val="${val%\"}";
    elif [[ "$val" == \'*\' ]]; then val="${val#\'}"; val="${val%\'}"; fi
    export "$key=$val"
  done < "$file"
}
load_env ./.env

: "${SPACES_KEY:?Defina SPACES_KEY no .env}"
: "${SPACES_SECRET:?Defina SPACES_SECRET no .env}"
: "${SPACES_BUCKET:?Defina SPACES_BUCKET no .env}"
: "${SPACES_REGION:=nyc3}"
: "${SPACES_ENDPOINT:=https://${SPACES_REGION}.digitaloceanspaces.com}"
: "${BACKUP_GPG_PASSPHRASE:?Defina BACKUP_GPG_PASSPHRASE no .env (guarde também offline!)}"
: "${POSTGRES_USER:=postgres}"
: "${POSTGRES_DB:=gestaobets}"
: "${BACKUP_ALERT_TO:=${OFFICE_EMAIL:-}}"

STAMP="$(date +%Y-%m-%d)"
DOW="$(date +%u)"        # 1=segunda ... 7=domingo
DOM="$(date +%d)"        # dia do mês
WORK="$(mktemp -d)"
LOG="/var/log/haveres-backup.log"
ARQUIVO="backup-${STAMP}.tar.gz.gpg"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }

# aws-cli configurado para o Spaces (S3-compatível)
aws_s3() {
  AWS_ACCESS_KEY_ID="$SPACES_KEY" \
  AWS_SECRET_ACCESS_KEY="$SPACES_SECRET" \
  aws --endpoint-url "$SPACES_ENDPOINT" --region "$SPACES_REGION" "$@"
}

# ---------------------------------------------------------------------------
# Alerta de falha por e-mail (reutiliza o Microsoft 365 já integrado no backend)
# ---------------------------------------------------------------------------
alerta_falha() {
  local etapa="$1"
  log "FALHA na etapa: ${etapa}"
  if [ -n "$BACKUP_ALERT_TO" ]; then
    $COMPOSE exec -T backend python -c "
from app.services.email_service import send_email
send_email(
  to=['${BACKUP_ALERT_TO}'],
  subject='[ALERTA] Falha no backup do sistema de Haveres (${STAMP})',
  body='O backup automático falhou na etapa: ${etapa}.\n\nVerifique o servidor e o log /var/log/haveres-backup.log o quanto antes. O sistema continua funcionando normalmente, mas o backup do dia NÃO foi concluído.',
)
" >>"$LOG" 2>&1 || log "Não foi possível enviar o e-mail de alerta (verifique M365)."
  fi
  rm -rf "$WORK"
  exit 1
}

trap 'alerta_falha "erro inesperado (linha $LINENO)"' ERR

log "===== Iniciando backup ${STAMP} ====="

# ---------------------------------------------------------------------------
# 1. Dump do banco de dados
# ---------------------------------------------------------------------------
log "1/5 Gerando dump do PostgreSQL..."
$COMPOSE exec -T db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists \
  > "$WORK/banco.sql" || alerta_falha "pg_dump"

# ---------------------------------------------------------------------------
# 2. Coleta dos arquivos enviados (volume uploads)
# ---------------------------------------------------------------------------
log "2/5 Copiando arquivos enviados (uploads)..."
CID="$($COMPOSE ps -q backend)"
if [ -n "$CID" ]; then
  docker cp "$CID:/app/uploads" "$WORK/uploads" 2>>"$LOG" || log "Aviso: sem uploads a copiar."
fi
[ -d "$WORK/uploads" ] || mkdir -p "$WORK/uploads"

# ---------------------------------------------------------------------------
# 3. Empacota e criptografa (GPG simétrico — LGPD: backup cifrado em repouso)
# ---------------------------------------------------------------------------
log "3/5 Compactando e criptografando..."
tar -czf "$WORK/pacote.tar.gz" -C "$WORK" banco.sql uploads
gpg --batch --yes --passphrase "$BACKUP_GPG_PASSPHRASE" \
    --symmetric --cipher-algo AES256 \
    -o "$WORK/$ARQUIVO" "$WORK/pacote.tar.gz" || alerta_falha "criptografia GPG"

TAM="$(du -h "$WORK/$ARQUIVO" | cut -f1)"
log "    Pacote criptografado: $ARQUIVO ($TAM)"

# ---------------------------------------------------------------------------
# 4. Envio ao Spaces (diário sempre; semanal aos domingos; mensal no dia 01)
# ---------------------------------------------------------------------------
log "4/5 Enviando ao Spaces ($SPACES_BUCKET)..."
aws_s3 s3 cp "$WORK/$ARQUIVO" "s3://$SPACES_BUCKET/daily/$ARQUIVO" >>"$LOG" 2>&1 || alerta_falha "upload diário"
if [ "$DOW" = "7" ]; then
  aws_s3 s3 cp "$WORK/$ARQUIVO" "s3://$SPACES_BUCKET/weekly/$ARQUIVO" >>"$LOG" 2>&1 || log "Aviso: falha na cópia semanal."
fi
if [ "$DOM" = "01" ]; then
  aws_s3 s3 cp "$WORK/$ARQUIVO" "s3://$SPACES_BUCKET/monthly/$ARQUIVO" >>"$LOG" 2>&1 || log "Aviso: falha na cópia mensal."
fi

# ---------------------------------------------------------------------------
# 5. Retenção GFS — apaga cópias vencidas
#    diário > 30 dias | semanal > 84 dias (12 semanas) | mensal > 365 dias
# ---------------------------------------------------------------------------
log "5/5 Aplicando retenção GFS..."
podar() {
  local prefixo="$1" dias="$2"
  local limite
  limite="$(date -d "-${dias} days" +%Y-%m-%d)"
  # a pasta pode ainda não existir (weekly/monthly no 1º uso) — não deve abortar o backup
  local listagem
  listagem="$(aws_s3 s3 ls "s3://$SPACES_BUCKET/${prefixo}/" 2>/dev/null || true)"
  [ -z "$listagem" ] && return 0
  while read -r _ _ _ nome; do
    [ -z "${nome:-}" ] && continue
    local d
    d="$(echo "$nome" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' || true)"
    [ -z "$d" ] && continue
    if [[ "$d" < "$limite" ]]; then
      aws_s3 s3 rm "s3://$SPACES_BUCKET/${prefixo}/${nome}" >>"$LOG" 2>&1 && log "    Removido antigo: ${prefixo}/${nome}" || true
    fi
  done <<< "$listagem"
}
podar daily 30
podar weekly 84
podar monthly 365

rm -rf "$WORK"
log "===== Backup ${STAMP} concluído com sucesso ====="
trap - ERR
