#!/usr/bin/env bash
#
# RESET DE LANÇAMENTO — zera os dados de teste de FINANCEIRO e COBRANÇAS,
# preservando os cadastros (Agentes Operadores, ENDR, Confederações, Usuários,
# beneficiários, regras de rateio, modelos de mensagem e trilha de auditoria).
#
# Segurança: executa um BACKUP COMPLETO antes de qualquer exclusão e exige
# confirmação digitada. Rode no servidor: bash infra/reset-lancamento.sh
#
set -euo pipefail
cd "$(dirname "$0")/.."
COMPOSE="docker compose -f docker-compose.prod.yml"

echo "=============================================================="
echo "  RESET DE LANÇAMENTO — Gestão de Haveres de Bets"
echo "=============================================================="
echo
echo "Será APAGADO (movimentação de teste):"
echo "  • Ciclos de cobrança, eventos e linha do tempo"
echo "  • Recebimentos (avulsos, de ciclo e legados) e repasses ENDR"
echo "  • Repartições da Fase 2 (itens e lotes)"
echo "  • Histórico de e-mails (enviados e respostas)"
echo "  • Documentos vinculados a ciclos/recebimentos/respostas/ENDR"
echo "  • Checklists do painel A Fazer"
echo "  • Conclusões manuais (voltam ao cálculo automático)"
echo
echo "Será PRESERVADO:"
echo "  • Agentes Operadores (marcas, contatos, responsáveis, sugestões)"
echo "  • Confederações, regras de rateio e beneficiários"
echo "  • ENDR: cadastro e associações mensais"
echo "  • Usuários, escritório, modelos de mensagem"
echo "  • Trilha de auditoria (imutável) e lembretes do administrador"
echo
read -r -p "Digite 'CONFIRMAR' para executar (backup completo roda antes): " ok
[ "$ok" = "CONFIRMAR" ] || { echo "Cancelado."; exit 1; }

echo
echo "== 1/2 Backup completo de segurança =="
./infra/backup.sh

echo
echo "== 2/2 Limpeza (transação única) =="
$COMPOSE exec -T backend python - <<'PYEOF'
from sqlalchemy import text
from app.database import SessionLocal

db = SessionLocal()

def count(tbl, where="TRUE"):
    return db.execute(text(f"SELECT COUNT(*) FROM {tbl} WHERE {where}")).scalar()

# Ordem segura em relação às chaves estrangeiras
PASSOS = [
    ("redistribution_items", "TRUE"),
    ("redistributions", "TRUE"),
    ("payment_receipts", "TRUE"),
    ("documents", "cycle_id IS NOT NULL OR payment_id IS NOT NULL "
                  "OR description LIKE 'Resposta recebida%' OR description LIKE '[ENDR]%' "
                  "OR (document_type = 'report' AND reference_month IS NOT NULL)"),
    ("payments", "TRUE"),
    ("direct_payments", "TRUE"),
    ("endr_payment_bet_links", "TRUE"),
    ("endr_payments", "TRUE"),
    ("email_messages", "TRUE"),
    ("collection_events", "TRUE"),
    ("collection_cycles", "TRUE"),
    ("task_checks", "TRUE"),
]

print(f"{'tabela':<26} {'antes':>7} {'apagados':>9}")
total = 0
for tbl, where in PASSOS:
    antes = count(tbl)
    r = db.execute(text(f"DELETE FROM {tbl} WHERE {where}"))
    print(f"{tbl:<26} {antes:>7} {r.rowcount:>9}")
    total += r.rowcount

# Conclusões manuais voltam ao automático (anotações preservadas)
r = db.execute(text("UPDATE operator_confederation_info SET conclusion = NULL, conclusion_manual = FALSE "
                    "WHERE conclusion IS NOT NULL OR conclusion_manual = TRUE"))
print(f"{'conclusões resetadas':<26} {'-':>7} {r.rowcount:>9}")

# Registro na trilha de auditoria
db.execute(text("INSERT INTO audit_logs (action, description, created_at) "
                "VALUES ('RESET_LANCAMENTO', :d, NOW())"),
           {"d": f"Reset de lançamento: {total} registros de financeiro/cobranças removidos; cadastros preservados."})

db.commit()
print(f"\n✅ Reset concluído: {total} registros removidos. Cadastros preservados.")
PYEOF

echo
echo "✅ Pronto. O sistema está zerado para a operação real."
echo "   Backup pré-reset disponível no Spaces (restaure com ./infra/restaurar.sh se preciso)."
