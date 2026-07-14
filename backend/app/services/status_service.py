"""Conclusão do operador perante cada confederação (Single Source of Truth de situação).

Valores: inadimplente | adimplente | consignacao | sem_obrigacao | endr

Regra (definida com o escritório):
- AUTOMÁTICA por padrão, calculada para uma competência:
    · associado ao ENDR no mês  -> endr
    · recebimento registrado no mês (avulso ou legado de ciclo) -> adimplente
    · caso contrário -> inadimplente
- MANUAL prevalece: se o usuário definiu a Conclusão na aba da confederação
  (conclusion_manual=True), esse valor vale para qualquer competência até ser
  revertido ao automático. Consignação em Pagamento e Sem Obrigação Corrente
  são sempre manuais.
"""
from datetime import date
from sqlalchemy.orm import Session
from ..models.operator import BettingOperator, OperatorConfederationInfo, EndrAssociation
from ..models.payment import DirectPayment, Payment
from ..models.collection import CollectionCycle

CONCLUSIONS = ("inadimplente", "adimplente", "consignacao", "sem_obrigacao", "endr")

LABELS_PT = {
    "inadimplente": "Inadimplente",
    "adimplente": "Adimplente",
    "consignacao": "Consignação em Pagamento",
    "sem_obrigacao": "Sem Obrigação Corrente",
    "endr": "ENDR",
}


def month_start(d: date) -> date:
    return date(d.year, d.month, 1)


def get_manual_map(db: Session, confederation_id: int) -> dict:
    """operator_id -> conclusion (apenas onde o usuário fixou manualmente)."""
    rows = db.query(OperatorConfederationInfo).filter(
        OperatorConfederationInfo.confederation_id == confederation_id,
        OperatorConfederationInfo.conclusion_manual == True,
        OperatorConfederationInfo.conclusion.isnot(None),
    ).all()
    return {r.operator_id: r.conclusion for r in rows}


def get_endr_set(db: Session, month: date) -> set:
    """operator_ids associados ao ENDR na competência (fonte: aba ENDR)."""
    rows = db.query(EndrAssociation).filter(
        EndrAssociation.reference_month == month,
        EndrAssociation.is_associated == True,
    ).all()
    return {r.operator_id for r in rows}


def get_paid_map(db: Session, confederation_id: int, month: date, regime: str = "competencia") -> dict:
    """operator_id -> {'total','last_date','last_amount','report_url'}.

    regime="competencia": filtra pelo mês a que o pagamento se refere (reference_month).
    regime="caixa": filtra pelo mês em que o valor foi RECEBIDO (received_date).
    As CONCLUSÕES do sistema usam sempre competência; o regime de caixa é para visualização.
    Considera os recebimentos centrais (DirectPayment) e, para compatibilidade,
    os pagamentos legados registrados em ciclos antigos (Payment com amount_paid).
    """
    out: dict = {}

    def add(op_id, amount, dt, report):
        e = out.setdefault(op_id, {"total": 0.0, "last_date": None, "last_amount": None, "report_url": None})
        e["total"] += float(amount or 0)
        if dt and (e["last_date"] is None or dt >= e["last_date"]):
            e["last_date"] = dt
            e["last_amount"] = float(amount or 0)
            if report:
                e["report_url"] = report
        elif report and not e["report_url"]:
            e["report_url"] = report

    dq = db.query(DirectPayment).filter(DirectPayment.confederation_id == confederation_id)
    if month:
        if regime == "caixa":
            from datetime import date as _date
            nxt = _date(month.year + 1, 1, 1) if month.month == 12 else _date(month.year, month.month + 1, 1)
            dq = dq.filter(DirectPayment.received_date >= month, DirectPayment.received_date < nxt)
        else:
            dq = dq.filter(DirectPayment.reference_month == month)
    for d in dq.all():
        add(d.operator_id, d.amount_received, d.received_date, d.report_file_url)

    pq = db.query(Payment).filter(
        Payment.confederation_id == confederation_id,
        Payment.amount_paid.isnot(None), Payment.amount_paid > 0,
    )
    if month:
        if regime == "caixa":
            from datetime import date as _date
            nxt = _date(month.year + 1, 1, 1) if month.month == 12 else _date(month.year, month.month + 1, 1)
            pq = pq.filter(Payment.payment_date >= month, Payment.payment_date < nxt)
        else:
            cycle_ids = [c.id for c in db.query(CollectionCycle).filter(
                CollectionCycle.confederation_id == confederation_id,
                CollectionCycle.reference_month == month,
            ).all()]
            if not cycle_ids:
                return out
            pq = pq.filter(Payment.cycle_id.in_(cycle_ids))
    for p in pq.all():
        add(p.operator_id, p.amount_paid, p.payment_date, p.report_file_url)
    return out


def effective_conclusions(db: Session, confederation_id: int, month: date) -> dict:
    """operator_id -> conclusão efetiva para a competência (manual prevalece)."""
    manual = get_manual_map(db, confederation_id)
    endr = get_endr_set(db, month)
    paid = get_paid_map(db, confederation_id, month)
    result = {}
    for op in db.query(BettingOperator).all():
        if op.id in manual:
            result[op.id] = manual[op.id]
        elif op.id in endr:
            result[op.id] = "endr"
        elif paid.get(op.id, {}).get("total", 0) > 0:
            result[op.id] = "adimplente"
        else:
            result[op.id] = "inadimplente"
    return result
