from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, false
from typing import List, Optional
from datetime import date
from decimal import Decimal
from ..database import get_db
from ..models.payment import Payment, PaymentStatus, ENDRPayment, DirectPayment
from ..models.redistribution import Redistribution, RedistributionItem, RedistributionStatus, ItemStatus
from ..models.beneficiary import Beneficiary
from ..models.collection import CollectionCycle
from ..models.confederation import Confederation
from ..models.operator import BettingOperator
from ..models.messaging import EmailMessage
from ..models.user import User
from ..schemas.finance import EmailMessageOut
from ..core.auth import get_current_user, require_office

router = APIRouter(prefix="/api/finance", tags=["finance"])


def _f(v):
    return float(v) if v is not None else 0.0


@router.get("/summary")
def financial_summary(
    confederation_id: Optional[int] = None,
    month: Optional[date] = Query(None, description="Mês de referência do ciclo (YYYY-MM-01)"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Resumo financeiro: receitas (cobranças + ENDR) e repasses (redistribuição)."""
    if current_user.role == "confederation_viewer":
        confederation_id = current_user.confederation_id

    pay_q = db.query(Payment)
    endr_q = db.query(ENDRPayment)
    redis_q = db.query(Redistribution)
    if confederation_id:
        pay_q = pay_q.filter(Payment.confederation_id == confederation_id)
        endr_q = endr_q.filter(ENDRPayment.confederation_id == confederation_id)
        redis_q = redis_q.filter(Redistribution.confederation_id == confederation_id)
    if month:
        cycle_ids = [c.id for c in db.query(CollectionCycle.id).filter(CollectionCycle.reference_month == month).all()]
        pay_q = pay_q.filter(Payment.cycle_id.in_(cycle_ids)) if cycle_ids else pay_q.filter(false())
        endr_q = endr_q.filter(ENDRPayment.reference_month == month)
        redis_q = redis_q.filter(Redistribution.reference_month == month)

    payments = pay_q.all()
    endr_payments = endr_q.all()
    redistributions = redis_q.all()

    receita_direct = sum(_f(p.amount_paid) for p in payments)
    receita_endr = sum(_f(e.amount_received) for e in endr_payments)
    receita_total = receita_direct + receita_endr

    # adimplência
    paid = len([p for p in payments if p.status == PaymentStatus.paid])
    report_pending = len([p for p in payments if p.status == PaymentStatus.report_pending])
    overdue = len([p for p in payments if p.status in (PaymentStatus.pending, PaymentStatus.overdue)])

    # repasses (Fase 2)
    total_a_repassar = sum(_f(r.amount_received) for r in redistributions)
    total_repassado = 0.0
    total_pendente_repasse = 0.0
    for r in redistributions:
        for it in r.items:
            if it.status == ItemStatus.paid:
                total_repassado += _f(it.amount)
            else:
                total_pendente_repasse += _f(it.amount)
    redis_overdue = len([
        r for r in redistributions
        if r.deadline_date and r.deadline_date < date.today() and r.status != RedistributionStatus.completed
    ])

    return {
        "receita": {
            "total": receita_total,
            "repasse_direto": receita_direct,
            "via_endr": receita_endr,
        },
        "adimplencia": {
            "adimplentes": paid,
            "pendente_relatorio": report_pending,
            "inadimplentes": overdue,
        },
        "repasses": {
            "total_a_repassar": total_a_repassar,
            "total_repassado": total_repassado,
            "pendente_repasse": total_pendente_repasse,
            "redistribuicoes_vencidas": redis_overdue,
            "total_redistribuicoes": len(redistributions),
        },
    }


@router.get("/phase1")
def phase1_received(
    confederation_id: Optional[int] = None,
    operator_id: Optional[int] = None,
    month: Optional[date] = Query(None, description="Mês de competência (YYYY-MM-01)"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Fase 1 — repasses efetivamente recebidos (ciclos + lançamentos avulsos), base para a Repartição (Fase 2)."""
    if current_user.role == "confederation_viewer":
        confederation_id = current_user.confederation_id

    confs = {c.id: c for c in db.query(Confederation).all()}
    ops = {o.id: o for o in db.query(BettingOperator).all()}

    def op_label(i):
        o = ops.get(i)
        return (o.fantasy_name or o.company_name) if o else f"Operador #{i}"

    results = []

    # Repasses registrados em ciclos (amount_paid > 0)
    pq = db.query(Payment).filter(Payment.amount_paid.isnot(None), Payment.amount_paid > 0)
    if confederation_id:
        pq = pq.filter(Payment.confederation_id == confederation_id)
    if operator_id:
        pq = pq.filter(Payment.operator_id == operator_id)
    for p in pq.all():
        cyc = db.query(CollectionCycle).get(p.cycle_id) if p.cycle_id else None
        ref = cyc.reference_month if cyc else None
        if month and ref != month:
            continue
        c = confs.get(p.confederation_id)
        results.append({
            "source": "payment", "id": p.id, "confederation_id": p.confederation_id,
            "confederation_acronym": c.acronym if c else "?", "operator_id": p.operator_id,
            "operator_label": op_label(p.operator_id),
            "reference_month": ref.isoformat() if ref else None,
            "amount": float(p.amount_paid or 0), "received_date": p.payment_date.isoformat() if p.payment_date else None,
            "report_received": bool(p.report_received),
        })

    # Lançamentos avulsos (DirectPayment)
    dq = db.query(DirectPayment)
    if confederation_id:
        dq = dq.filter(DirectPayment.confederation_id == confederation_id)
    if operator_id:
        dq = dq.filter(DirectPayment.operator_id == operator_id)
    if month:
        dq = dq.filter(DirectPayment.reference_month == month)
    for d in dq.all():
        c = confs.get(d.confederation_id)
        results.append({
            "source": "direct", "id": d.id, "confederation_id": d.confederation_id,
            "confederation_acronym": c.acronym if c else "?", "operator_id": d.operator_id,
            "operator_label": op_label(d.operator_id),
            "reference_month": d.reference_month.isoformat() if d.reference_month else None,
            "amount": float(d.amount_received or 0), "received_date": d.received_date.isoformat() if d.received_date else None,
            "report_received": bool(d.report_file_url),
        })

    results.sort(key=lambda r: (r["received_date"] or ""), reverse=True)
    return {"items": results, "total": sum(r["amount"] for r in results)}


@router.get("/by-confederation")
def summary_by_confederation(db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    """Quadro consolidado por confederação."""
    result = []
    confs = db.query(Confederation).all()
    for c in confs:
        payments = db.query(Payment).filter(Payment.confederation_id == c.id).all()
        endr = db.query(ENDRPayment).filter(ENDRPayment.confederation_id == c.id).all()
        redis = db.query(Redistribution).filter(Redistribution.confederation_id == c.id).all()
        receita = sum(_f(p.amount_paid) for p in payments) + sum(_f(e.amount_received) for e in endr)
        repassado = sum(_f(it.amount) for r in redis for it in r.items if it.status == ItemStatus.paid)
        pendente = sum(_f(it.amount) for r in redis for it in r.items if it.status != ItemStatus.paid)
        overdue = len([r for r in redis if r.deadline_date and r.deadline_date < date.today() and r.status != RedistributionStatus.completed])
        result.append({
            "confederation_id": c.id,
            "acronym": c.acronym,
            "name": c.name,
            "receita_total": receita,
            "total_repassado": repassado,
            "pendente_repasse": pendente,
            "redistribuicoes_vencidas": overdue,
            "beneficiarios": db.query(func.count(Beneficiary.id)).filter(Beneficiary.confederation_id == c.id).scalar() or 0,
        })
    return result


@router.get("/emails", response_model=List[EmailMessageOut])
def list_emails(
    operator_id: Optional[int] = None,
    matched: Optional[bool] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_office),
):
    q = db.query(EmailMessage)
    if operator_id:
        q = q.filter(EmailMessage.operator_id == operator_id)
    if matched is not None:
        q = q.filter(EmailMessage.matched == matched)
    return q.order_by(EmailMessage.created_at.desc()).limit(200).all()


@router.post("/sync-emails")
def sync_emails(db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    """Lê a caixa de entrada (M365) e importa respostas das Bets, casando por remetente."""
    from ..services.email_matcher import sync_inbox
    return sync_inbox(db)
