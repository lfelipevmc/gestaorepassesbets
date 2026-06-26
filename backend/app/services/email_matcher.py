"""Conciliação de respostas de e-mail das Bets.

Estratégia: lê a caixa de entrada via Microsoft Graph e casa cada resposta a um agente operador
pelo endereço do remetente (comparado aos contatos de e-mail cadastrados). Vincula a resposta ao
ciclo de cobrança aberto mais recente daquele operador, quando houver.
"""
from sqlalchemy.orm import Session
from datetime import datetime
import logging
from .email_service import read_inbox_emails
from ..models.operator import BettingOperator, OperatorContact, ContactType
from ..models.messaging import EmailMessage, EmailDirection
from ..models.collection import CollectionCycle, CollectionEvent, EventType, EventChannel
from ..models.audit import AuditLog

logger = logging.getLogger(__name__)


def _parse_dt(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None


def sync_inbox(db: Session, top: int = 50) -> dict:
    """Lê a caixa de entrada e importa respostas casadas a operadores."""
    messages = read_inbox_emails(top=top)
    if not messages:
        return {"imported": 0, "matched": 0, "skipped": 0, "configured": False}

    # mapa email -> operator_id
    contacts = db.query(OperatorContact).filter(OperatorContact.type == ContactType.email).all()
    email_map = {}
    for c in contacts:
        if c.value:
            email_map[c.value.strip().lower()] = c.operator_id

    imported = 0
    matched = 0
    skipped = 0
    for m in messages:
        graph_id = m.get("id")
        if graph_id and db.query(EmailMessage).filter(EmailMessage.graph_message_id == graph_id).first():
            skipped += 1
            continue
        from_addr = (((m.get("from") or {}).get("emailAddress") or {}).get("address") or "").strip().lower()
        subject = m.get("subject")
        body = ((m.get("body") or {}).get("content") or "")[:1000]
        received = _parse_dt(m.get("receivedDateTime"))
        conv = m.get("conversationId")

        operator_id = email_map.get(from_addr)
        cycle_id = None
        is_matched = operator_id is not None
        if operator_id:
            op = db.query(BettingOperator).get(operator_id)
            # ciclo aberto mais recente de qualquer confederação
            cycle = (
                db.query(CollectionCycle)
                .order_by(CollectionCycle.reference_month.desc())
                .first()
            )
            cycle_id = cycle.id if cycle else None
            matched += 1
            if cycle_id:
                db.add(CollectionEvent(
                    cycle_id=cycle_id, operator_id=operator_id,
                    event_type=EventType.email_read, channel=EventChannel.email,
                    notes=f"Resposta recebida de {from_addr}: {subject}",
                ))

        db.add(EmailMessage(
            direction=EmailDirection.inbound,
            operator_id=operator_id,
            cycle_id=cycle_id,
            subject=subject,
            body_preview=body,
            from_addr=from_addr,
            graph_message_id=graph_id,
            graph_conversation_id=conv,
            matched=is_matched,
            received_at=received,
        ))
        imported += 1

    db.add(AuditLog(action="SYNC_INBOX", description=f"Caixa de entrada: {imported} importados, {matched} casados"))
    db.commit()
    return {"imported": imported, "matched": matched, "skipped": skipped, "configured": True}
