"""Painel "A Fazer Hoje" — fila priorizada de tarefas operacionais e cadência de contato.

Agrega, a partir do estado atual do sistema, o que o escritório precisa fazer hoje:
notificações no prazo, repartições vencendo, e-mails a conciliar e Bets a cobrar —
cada item com um canal de contato sugerido (cadência inteligente).
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from datetime import date, timedelta
from ..database import get_db
from ..models.collection import CollectionCycle, CollectionEvent, EventType, CycleStatus
from ..models.payment import Payment, PaymentStatus
from ..models.operator import BettingOperator, OperatorContact, ContactType, OperatorResponsible
from ..models.confederation import Confederation
from ..models.redistribution import Redistribution, RedistributionStatus
from ..models.messaging import EmailMessage, EmailDirection
from ..core.auth import get_current_user
from ..models.user import User

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


def _suggested_channel(db: Session, operator_id: int) -> str:
    """Cadência: sugere o melhor canal com base nos dados e no histórico de respostas."""
    # Se já respondeu por e-mail antes, mantém e-mail; senão prioriza WhatsApp se houver telefone.
    has_phone = db.query(OperatorContact).filter(
        OperatorContact.operator_id == operator_id,
        OperatorContact.type.in_([ContactType.phone, ContactType.whatsapp]),
    ).first() or db.query(OperatorResponsible).filter(
        OperatorResponsible.operator_id == operator_id, OperatorResponsible.phone.isnot(None)
    ).first()
    has_email = db.query(OperatorContact).filter(
        OperatorContact.operator_id == operator_id,
        OperatorContact.type == ContactType.email, OperatorContact.is_primary == True,
    ).first()
    if has_email:
        return "e-mail"
    if has_phone:
        return "WhatsApp"
    return "telefone/redes"


@router.get("/today")
def tasks_today(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    today = date.today()
    conf_scope = current_user.confederation_id if current_user.role == "confederation_viewer" else None
    tasks = []

    confs = {c.id: c for c in db.query(Confederation).all()}

    # --- Ciclos que precisam de notificação hoje ---
    cyc_q = db.query(CollectionCycle).filter(CollectionCycle.status.in_([CycleStatus.open, CycleStatus.collecting]))
    if conf_scope:
        cyc_q = cyc_q.filter(CollectionCycle.confederation_id == conf_scope)
    for cycle in cyc_q.all():
        conf = confs.get(cycle.confederation_id)
        pendentes = db.query(Payment).filter(
            Payment.cycle_id == cycle.id,
            Payment.status.in_([PaymentStatus.pending, PaymentStatus.overdue]),
        ).count()
        if pendentes == 0:
            continue
        sent1 = db.query(CollectionEvent).filter(
            CollectionEvent.cycle_id == cycle.id, CollectionEvent.event_type == EventType.notification_sent,
        ).count()
        day = today.day
        first_day = conf.first_notification_day if conf else 12
        second_day = conf.second_notification_day if conf else 22
        if sent1 == 0 and day >= first_day:
            tasks.append({
                "priority": 1, "type": "first_notification",
                "title": f"Enviar 1ª notificação — {conf.acronym if conf else ''}",
                "detail": f"{pendentes} agente(s) pendente(s) no ciclo de {cycle.reference_month.strftime('%m/%Y')}.",
                "link": f"/cobrancas/{cycle.id}", "channel": "e-mail", "count": pendentes,
            })
        elif sent1 > 0 and day >= second_day:
            tasks.append({
                "priority": 2, "type": "second_notification",
                "title": f"Enviar 2ª notificação — {conf.acronym if conf else ''}",
                "detail": f"{pendentes} agente(s) ainda pendente(s) após a 1ª notificação.",
                "link": f"/cobrancas/{cycle.id}", "channel": "e-mail + WhatsApp", "count": pendentes,
            })

    # --- Repartições vencendo (Fase 2) ---
    red_q = db.query(Redistribution).filter(Redistribution.status != RedistributionStatus.completed)
    if conf_scope:
        red_q = red_q.filter(Redistribution.confederation_id == conf_scope)
    overdue, soon = 0, 0
    for r in red_q.all():
        if not r.deadline_date:
            continue
        if r.deadline_date < today:
            overdue += 1
        elif r.deadline_date <= today + timedelta(days=7):
            soon += 1
    if overdue:
        tasks.append({"priority": 0, "type": "redistribution_overdue", "title": "Repartições com prazo vencido",
                      "detail": f"{overdue} repartição(ões) ultrapassaram o prazo legal de repasse.",
                      "link": "/financeiro", "channel": "—", "count": overdue})
    if soon:
        tasks.append({"priority": 2, "type": "redistribution_soon", "title": "Repartições vencem em 7 dias",
                      "detail": f"{soon} repartição(ões) a vencer — programar o repasse.",
                      "link": "/financeiro", "channel": "—", "count": soon})

    # --- E-mails a conciliar ---
    em_q = db.query(EmailMessage).filter(EmailMessage.direction == EmailDirection.inbound, EmailMessage.matched == False)
    if conf_scope:
        em_q = em_q.filter(EmailMessage.confederation_id == conf_scope)
    unmatched = em_q.count()
    if unmatched:
        tasks.append({"priority": 1, "type": "reconcile_email", "title": "Conciliar respostas de e-mail",
                      "detail": f"{unmatched} e-mail(s) recebido(s) aguardando vínculo a um operador.",
                      "link": "/financeiro", "channel": "—", "count": unmatched})

    # --- Bets pendentes sem contato recente (cadência) ---
    if not conf_scope:
        cutoff = today - timedelta(days=7)
        sugest = []
        for cycle in cyc_q.all():
            pend = db.query(Payment).filter(
                Payment.cycle_id == cycle.id, Payment.status.in_([PaymentStatus.pending, PaymentStatus.overdue]),
            ).all()
            for p in pend[:200]:
                last = db.query(CollectionEvent).filter(
                    CollectionEvent.cycle_id == cycle.id, CollectionEvent.operator_id == p.operator_id,
                ).order_by(CollectionEvent.performed_at.desc()).first()
                if last and last.performed_at and last.performed_at.date() >= cutoff:
                    continue  # já contatado nos últimos 7 dias
                op = db.query(BettingOperator).get(p.operator_id)
                if not op:
                    continue
                sugest.append({"operator_id": op.id, "label": op.fantasy_name or op.company_name,
                               "cycle_id": cycle.id, "channel": _suggested_channel(db, op.id)})
                if len(sugest) >= 30:
                    break
            if len(sugest) >= 30:
                break
        if sugest:
            tasks.append({"priority": 3, "type": "contact_bets", "title": "Cobrar Bets sem contato recente",
                          "detail": f"{len(sugest)} agente(s) sem contato nos últimos 7 dias.",
                          "link": "/cobrancas", "channel": "variado", "count": len(sugest), "items": sugest})

    tasks.sort(key=lambda t: t["priority"])
    return {"tasks": tasks, "generated_at": today.isoformat()}
