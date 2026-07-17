from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
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
    direct_q = db.query(DirectPayment)
    endr_q = db.query(ENDRPayment)
    redis_q = db.query(Redistribution)
    if confederation_id:
        pay_q = pay_q.filter(Payment.confederation_id == confederation_id)
        direct_q = direct_q.filter(DirectPayment.confederation_id == confederation_id)
        endr_q = endr_q.filter(ENDRPayment.confederation_id == confederation_id)
        redis_q = redis_q.filter(Redistribution.confederation_id == confederation_id)
    if month:
        cycle_ids = [c.id for c in db.query(CollectionCycle.id).filter(CollectionCycle.reference_month == month).all()]
        pay_q = pay_q.filter(Payment.cycle_id.in_(cycle_ids)) if cycle_ids else pay_q.filter(false())
        direct_q = direct_q.filter(DirectPayment.reference_month == month)
        endr_q = endr_q.filter(ENDRPayment.reference_month == month)
        redis_q = redis_q.filter(Redistribution.reference_month == month)

    payments = pay_q.all()
    direct_payments = direct_q.all()
    endr_payments = endr_q.all()
    redistributions = redis_q.all()

    # Receita direta = lançamentos da base central (direct_payments) + ciclos legados
    receita_direct = sum(_f(p.amount_paid) for p in payments) + sum(_f(d.amount_received) for d in direct_payments)
    receita_endr = sum(_f(e.amount_received) for e in endr_payments)
    receita_total = receita_direct + receita_endr

    # adimplência: pela Conclusão efetiva (SSOT) do mês corrente
    from ..services.status_service import effective_conclusions
    from datetime import date as _date
    _cur = _date.today().replace(day=1)
    if confederation_id:
        _eff = effective_conclusions(db, confederation_id, month or _cur)
        _vals = list(_eff.values())
    else:
        _vals = []
        for _c in db.query(Confederation).all():
            _vals += list(effective_conclusions(db, _c.id, month or _cur).values())
    paid = _vals.count("adimplente")
    report_pending = 0
    overdue = _vals.count("inadimplente")

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
    month: Optional[date] = Query(None, description="Mês do filtro (YYYY-MM-01)"),
    regime: str = Query("competencia", description="competencia = mês a que o pagamento se refere; caixa = mês em que foi recebido"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Fase 1 — repasses efetivamente recebidos (ciclos + avulsos + ENDR), base única (SSOT).

    Suporta os dois regimes: por COMPETÊNCIA (reference_month) ou por CAIXA (received_date)."""
    def in_month_caixa(d):
        return bool(d and month and d.year == month.year and d.month == month.month)
    def in_month_comp(ref, ref_end=None):
        if not month:
            return True
        if ref is None:
            return False
        end = ref_end or ref
        return ref <= month <= end
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
        if month:
            if regime == "caixa":
                if not in_month_caixa(p.payment_date):
                    continue
            elif not in_month_comp(ref):
                continue
        c = confs.get(p.confederation_id)
        results.append({
            "source": "payment", "id": p.id, "confederation_id": p.confederation_id,
            "confederation_acronym": c.acronym if c else "?", "operator_id": p.operator_id,
            "operator_label": op_label(p.operator_id),
            "reference_month": ref.isoformat() if ref else None,
            "amount": float(p.amount_paid or 0), "received_date": p.payment_date.isoformat() if p.payment_date else None,
            "report_received": bool(p.report_received), "report_url": p.report_file_url,
        })

    # Lançamentos avulsos (DirectPayment)
    dq = db.query(DirectPayment)
    if confederation_id:
        dq = dq.filter(DirectPayment.confederation_id == confederation_id)
    if operator_id:
        dq = dq.filter(DirectPayment.operator_id == operator_id)
    for d in dq.all():
        if month:
            if regime == "caixa":
                if not in_month_caixa(d.received_date):
                    continue
            elif not in_month_comp(d.reference_month):
                continue
        c = confs.get(d.confederation_id)
        results.append({
            "source": "direct", "id": d.id, "confederation_id": d.confederation_id,
            "confederation_acronym": c.acronym if c else "?", "operator_id": d.operator_id,
            "operator_label": op_label(d.operator_id),
            "reference_month": d.reference_month.isoformat() if d.reference_month else None,
            "amount": float(d.amount_received or 0), "received_date": d.received_date.isoformat() if d.received_date else None,
            "report_received": bool(d.report_file_url), "report_url": d.report_file_url,
        })

    # Repasses ENDR (tabela única endr_payments) — sincronizados automaticamente.
    # Quando o filtro é por operador, listamos os repasses que o cobrem via bet_links,
    # com amount não individualizado (não soma no total para não duplicar).
    from ..models.payment import ENDRPayment, ENDRPaymentBetLink
    eq = db.query(ENDRPayment)
    if confederation_id:
        eq = eq.filter(ENDRPayment.confederation_id == confederation_id)
    for ep in eq.all():
        if operator_id:
            if not any(l.operator_id == operator_id for l in ep.bet_links):
                continue
        if month:
            if regime == "caixa":
                if not in_month_caixa(ep.received_date):
                    continue
            elif not in_month_comp(ep.reference_month, ep.reference_month_end):
                continue
        c = confs.get(ep.confederation_id)
        ref_lbl = ep.reference_month.isoformat() if ep.reference_month else None
        results.append({
            "source": "endr", "id": ep.id, "confederation_id": ep.confederation_id,
            "confederation_acronym": c.acronym if c else "?", "operator_id": None,
            "operator_label": "ENDR (consolidado)" if not operator_id else "via ENDR (não individualizado)",
            "reference_month": ref_lbl,
            "reference_month_end": ep.reference_month_end.isoformat() if ep.reference_month_end else None,
            "amount": float(ep.amount_received or 0) if not operator_id else None,
            "received_date": ep.received_date.isoformat() if ep.received_date else None,
            "report_received": bool(ep.report_file_url), "report_url": ep.report_file_url,
        })

    results.sort(key=lambda r: (r["received_date"] or ""), reverse=True)
    return {"items": results, "total": sum((r["amount"] or 0) for r in results)}


@router.get("/by-confederation")
def summary_by_confederation(db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    """Quadro consolidado por confederação."""
    result = []
    confs = db.query(Confederation).all()
    for c in confs:
        payments = db.query(Payment).filter(Payment.confederation_id == c.id).all()
        directs = db.query(DirectPayment).filter(DirectPayment.confederation_id == c.id).all()
        endr = db.query(ENDRPayment).filter(ENDRPayment.confederation_id == c.id).all()
        redis = db.query(Redistribution).filter(Redistribution.confederation_id == c.id).all()
        receita = (sum(_f(p.amount_paid) for p in payments)
                   + sum(_f(d.amount_received) for d in directs)
                   + sum(_f(e.amount_received) for e in endr))
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
    confederation_id: Optional[int] = None,
    matched: Optional[bool] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_office),
):
    q = db.query(EmailMessage)
    if operator_id:
        q = q.filter(EmailMessage.operator_id == operator_id)
    if confederation_id:
        q = q.filter(EmailMessage.confederation_id == confederation_id)
    if matched is not None:
        q = q.filter(EmailMessage.matched == matched)
    return q.order_by(EmailMessage.created_at.desc()).limit(200).all()


@router.post("/sync-emails")
def sync_emails(db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    """Lê a caixa de entrada (M365) e importa respostas das Bets, casando por remetente."""
    from ..services.email_matcher import sync_inbox
    return sync_inbox(db)


@router.post("/emails/{email_id}/suggest-operator")
def suggest_operator(email_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    """Usa IA para sugerir qual agente operador é o remetente de um e-mail não casado."""
    from ..services.ai_service import suggest_operator_for_email
    from ..models.operator import OperatorBrand

    email = db.query(EmailMessage).get(email_id)
    if not email:
        from fastapi import HTTPException
        raise HTTPException(404, "E-mail não encontrado")

    # Monta candidatos com domínios das marcas
    operators = db.query(BettingOperator).filter(BettingOperator.status == "active").all()
    brands = db.query(OperatorBrand).all()
    brands_by_op = {}
    for b in brands:
        brands_by_op.setdefault(b.operator_id, []).append(b)

    candidates = []
    for op in operators:
        domains = []
        for b in brands_by_op.get(op.id, []):
            for d in (b.domain, b.website):
                if d:
                    domains.append(d.replace("https://", "").replace("http://", "").split("/")[0])
        if op.website:
            domains.append(op.website.replace("https://", "").replace("http://", "").split("/")[0])
        candidates.append({
            "id": op.id, "company_name": op.company_name,
            "fantasy_name": op.fantasy_name, "domains": domains,
        })

    result = suggest_operator_for_email(email.from_addr, email.subject, email.body_preview, candidates)
    # Anexa rótulo do operador sugerido
    if result.get("operator_id"):
        op = db.query(BettingOperator).get(result["operator_id"])
        if op:
            result["operator_label"] = op.fantasy_name or op.company_name
    return result


class LinkEmailRequest(BaseModel):
    operator_id: int
    add_as_contact: bool = False


@router.post("/emails/{email_id}/link")
def link_email_to_operator(
    email_id: int, data: LinkEmailRequest,
    db: Session = Depends(get_db), current_user: User = Depends(require_office),
):
    """Vincula manualmente um e-mail não casado a um operador (revisão humana da fila)."""
    from fastapi import HTTPException
    from ..models.operator import OperatorContact, ContactType
    from ..services.audit_service import log_action

    email = db.query(EmailMessage).get(email_id)
    if not email:
        raise HTTPException(404, "E-mail não encontrado")
    op = db.query(BettingOperator).get(data.operator_id)
    if not op:
        raise HTTPException(404, "Operador não encontrado")

    email.operator_id = data.operator_id
    email.matched = True

    # Opcionalmente cadastra o remetente como contato de e-mail do operador
    if data.add_as_contact and email.from_addr:
        exists = db.query(OperatorContact).filter(
            OperatorContact.operator_id == data.operator_id,
            OperatorContact.value == email.from_addr,
        ).first()
        if not exists:
            db.add(OperatorContact(
                operator_id=data.operator_id, type=ContactType.email,
                value=email.from_addr, label="Identificado por e-mail recebido",
                source="email_queue",
            ))

    log_action(db=db, action="LINK_EMAIL", entity_type="BettingOperator", entity_id=data.operator_id,
               new_values={"email_id": email_id, "from": email.from_addr}, user_id=current_user.id)
    db.commit()
    return {"ok": True, "operator_id": data.operator_id, "operator_label": op.fantasy_name or op.company_name}
