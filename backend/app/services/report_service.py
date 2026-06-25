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

    paid = [p for p in payments if p.status == PaymentStatus.paid]
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
            "ggr_declared": float(p.ggr_declared) if p.ggr_declared else None,
            "calculated_amount": float(p.calculated_amount) if p.calculated_amount else None,
            "amount_paid": float(p.amount_paid) if p.amount_paid else None,
            "payment_date": p.payment_date.isoformat() if p.payment_date else None,
            "payment_confirmed_at": p.payment_confirmed_at.isoformat() if p.payment_confirmed_at else None,
        }

    total_expected = sum(float(p.calculated_amount or 0) for p in payments)
    total_received = sum(float(p.amount_paid or 0) for p in paid)

    return {
        "cycle_id": cycle_id,
        "confederation": {"id": confederation.id, "name": confederation.name, "acronym": confederation.acronym},
        "reference_month": cycle.reference_month.strftime("%m/%Y"),
        "generated_at": datetime.utcnow().isoformat(),
        "summary": {
            "total_operators": len(payments),
            "paid": len(paid),
            "overdue": len(overdue),
            "partial": len(partial),
            "compliance_rate": round(len(paid) / len(payments) * 100, 2) if payments else 0,
            "total_expected_brl": total_expected,
            "total_received_brl": total_received,
        },
        "compliant": [payment_to_dict(p) for p in paid],
        "non_compliant": [payment_to_dict(p) for p in overdue],
        "partial": [payment_to_dict(p) for p in partial],
    }


def generate_excel_report(db: Session, cycle_id: int) -> bytes:
    import pandas as pd
    report = get_compliance_report(db, cycle_id)

    output = io.BytesIO()
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        all_data = []
        for p in report.get("compliant", []) + report.get("non_compliant", []) + report.get("partial", []):
            all_data.append({
                "Razão Social": p["company_name"],
                "Nome Fantasia": p["fantasy_name"] or "",
                "CNPJ": p["cnpj"] or "",
                "Status": {"paid": "Adimplente", "pending": "Inadimplente", "overdue": "Em Atraso", "partial": "Parcial"}.get(p["status"], p["status"]),
                "GGR Declarado (R$)": p["ggr_declared"] or "",
                "Valor Calculado (R$)": p["calculated_amount"] or "",
                "Valor Pago (R$)": p["amount_paid"] or "",
                "Data Pagamento": p["payment_date"] or "",
            })

        df = pd.DataFrame(all_data)
        df.to_excel(writer, sheet_name="Relatório", index=False)

    return output.getvalue()
