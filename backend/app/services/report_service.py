from sqlalchemy.orm import Session
from ..models.collection import CollectionCycle
from ..models.payment import Payment, PaymentStatus
from ..models.operator import BettingOperator
from ..models.confederation import Confederation
import io
from datetime import datetime


def get_compliance_report(db: Session, cycle_id: int) -> dict:
    cycle = db.query(CollectionCycle).get(cycle_id)
    if not cycle:
        return {}

    confederation = db.query(Confederation).get(cycle.confederation_id)
    payments = db.query(Payment).filter(Payment.cycle_id == cycle_id).all()

    # Adimplente = pagou E enviou relatório. report_pending = pagou mas relatório ainda pendente.
    paid = [p for p in payments if p.status == PaymentStatus.paid]
    report_pending = [p for p in payments if p.status == PaymentStatus.report_pending]
    overdue = [p for p in payments if p.status in [PaymentStatus.pending, PaymentStatus.overdue]]
    partial = [p for p in payments if p.status == PaymentStatus.partial]

    def payment_to_dict(p: Payment):
        op = db.query(BettingOperator).get(p.operator_id)
        return {
            "operator_id": op.id,
            "company_name": op.company_name,
            "fantasy_name": op.fantasy_name,
            "cnpj": op.cnpj,
            "status": p.status,
            "base_calculo": float(p.base_calculo) if p.base_calculo else None,
            "amount_due": float(p.amount_due) if p.amount_due else None,
            "amount_paid": float(p.amount_paid) if p.amount_paid else None,
            "payment_date": p.payment_date.isoformat() if p.payment_date else None,
            "report_received": bool(p.report_received),
            "report_reference_month": p.report_reference_month.isoformat() if p.report_reference_month else None,
            "payment_confirmed_at": p.payment_confirmed_at.isoformat() if p.payment_confirmed_at else None,
        }

    # Total recebido = regime de caixa (valor efetivamente recebido no ciclo)
    total_received = sum(float(p.amount_paid or 0) for p in payments)

    return {
        "cycle_id": cycle_id,
        "confederation": {"id": confederation.id, "name": confederation.name, "acronym": confederation.acronym},
        "reference_month": cycle.reference_month.strftime("%m/%Y"),
        "generated_at": datetime.utcnow().isoformat(),
        "summary": {
            "total_operators": len(payments),
            "paid": len(paid),
            "report_pending": len(report_pending),
            "overdue": len(overdue),
            "partial": len(partial),
            "compliance_rate": round((len(paid) + len(report_pending)) / len(payments) * 100, 2) if payments else 0,
            "total_received_brl": total_received,
        },
        "compliant": [payment_to_dict(p) for p in paid],
        "report_pending_list": [payment_to_dict(p) for p in report_pending],
        "non_compliant": [payment_to_dict(p) for p in overdue],
        "partial": [payment_to_dict(p) for p in partial],
    }


def generate_excel_report(db: Session, cycle_id: int) -> bytes:
    import pandas as pd
    report = get_compliance_report(db, cycle_id)

    output = io.BytesIO()
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        all_data = []
        for p in (report.get("compliant", []) + report.get("report_pending_list", [])
                  + report.get("non_compliant", []) + report.get("partial", [])):
            all_data.append({
                "Razão Social": p["company_name"],
                "Nome Fantasia": p["fantasy_name"] or "",
                "CNPJ": p["cnpj"] or "",
                "Status": {"paid": "Adimplente", "report_pending": "Pendente de Relatório", "pending": "Inadimplente", "overdue": "Em Atraso", "partial": "Parcial"}.get(p["status"], p["status"]),
                "Base de Cálculo (R$)": p["base_calculo"] or "",
                "Valor Devido (R$)": p["amount_due"] or "",
                "Valor Recebido (R$)": p["amount_paid"] or "",
                "Data Recebimento": p["payment_date"] or "",
                "Relatório Recebido": "Sim" if p["report_received"] else "Não",
                "Mês de Competência": p["report_reference_month"] or "",
            })

        df = pd.DataFrame(all_data)
        df.to_excel(writer, sheet_name="Relatório", index=False)

    return output.getvalue()
