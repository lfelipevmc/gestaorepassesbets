"""Conciliação de respostas de e-mail das Bets.

Estratégia: lê a caixa de entrada via Microsoft Graph e casa cada resposta a um agente operador
pelo endereço do remetente (comparado aos contatos de e-mail cadastrados). Vincula a resposta ao
ciclo de cobrança aberto mais recente daquele operador, quando houver.
"""
from sqlalchemy.orm import Session
from datetime import datetime
import os
import re
import uuid
import logging
from .email_service import read_inbox_emails, ensure_confederation_folder, move_message, get_access_token, get_mailbox
from ..models.operator import BettingOperator, OperatorContact, ContactType
from ..models.messaging import EmailMessage, EmailDirection
from ..models.collection import CollectionCycle, CollectionEvent, EventType, EventChannel
from ..models.confederation import Confederation
from ..models.document import Document, DocumentType, DocumentCategory
from ..models.audit import AuditLog

logger = logging.getLogger(__name__)

REPLIES_DIR = "/app/uploads/email_replies"


def _archive_reply_as_document(db: Session, operator_id, cycle_id, subject, from_addr, full_body, received):
    """Salva a resposta como arquivo .html e registra um Documento para auditoria futura."""
    try:
        os.makedirs(REPLIES_DIR, exist_ok=True)
        safe_subj = re.sub(r"[^\w\-]+", "_", (subject or "resposta"))[:60]
        file_name = f"Resposta_{safe_subj}_{(received or datetime.now()).strftime('%Y%m%d')}.html"
        disk_name = f"{uuid.uuid4().hex}_{file_name}"
        file_path = os.path.join(REPLIES_DIR, disk_name)
        html = (
            f"<html><body><p><strong>De:</strong> {from_addr or ''}</p>"
            f"<p><strong>Assunto:</strong> {subject or ''}</p>"
            f"<p><strong>Recebido em:</strong> {received or ''}</p><hr/>"
            f"<div>{full_body or ''}</div></body></html>"
        )
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(html)
        doc = Document(
            operator_id=operator_id, cycle_id=cycle_id,
            title=f"Resposta de e-mail — {subject or from_addr}"[:255],
            document_type=DocumentType.correspondence, category=DocumentCategory.documento_oficial,
            file_path=file_path, file_name=file_name,
            file_size=os.path.getsize(file_path) if os.path.exists(file_path) else None,
            description=f"Resposta recebida de {from_addr} e arquivada automaticamente para auditoria.",
            uploaded_by_id=None,
        )
        db.add(doc)
    except Exception as e:
        logger.warning(f"Falha ao arquivar resposta como documento: {e}")


def _parse_dt(s):
    """Converte o horário UTC do Graph para o horário local do sistema (America/Sao_Paulo,
    definido via TZ no container) e grava como datetime 'naive' — coerente com os demais
    carimbos do banco. Sem isso, respostas apareceriam 3h adiantadas."""
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone().replace(tzinfo=None)
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

    # credenciais/caixa para arquivar respostas nas pastas por confederação
    token = get_access_token()
    box = get_mailbox()
    filed = 0

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
        full_body = (m.get("body") or {}).get("content") or ""
        body = full_body[:1000]
        received = _parse_dt(m.get("receivedDateTime"))
        conv = m.get("conversationId")

        operator_id = email_map.get(from_addr)
        cycle_id = None
        confederation_id = None
        is_matched = operator_id is not None
        if operator_id:
            op = db.query(BettingOperator).get(operator_id)
            # 1) Melhor casamento: mesmo fio de conversa de um envio anterior (traz a confederação certa)
            prior = None
            if conv:
                prior = (db.query(EmailMessage)
                         .filter(EmailMessage.graph_conversation_id == conv,
                                 EmailMessage.direction == EmailDirection.outbound)
                         .order_by(EmailMessage.sent_at.desc().nullslast())
                         .first())
            if prior:
                confederation_id = prior.confederation_id
                cycle_id = prior.cycle_id
            if not cycle_id:
                # 2) Fallback: ciclo mais recente do operador
                cycle = (
                    db.query(CollectionCycle)
                    .order_by(CollectionCycle.reference_month.desc())
                    .first()
                )
                cycle_id = cycle.id if cycle else None
                if cycle and not confederation_id:
                    confederation_id = cycle.confederation_id
            matched += 1
            if cycle_id:
                db.add(CollectionEvent(
                    cycle_id=cycle_id, operator_id=operator_id,
                    event_type=EventType.email_read, channel=EventChannel.email,
                    notes=f"Resposta recebida de {from_addr}: {subject}",
                ))
            # Arquiva a resposta como documento anexo para auditoria futura
            _archive_reply_as_document(db, operator_id, cycle_id, subject, from_addr, full_body, received)

            # Arquiva a mensagem na pasta da confederação dentro da caixa dedicada
            if token and box and graph_id and confederation_id:
                conf = db.query(Confederation).get(confederation_id)
                if conf:
                    folder_id = ensure_confederation_folder(conf.acronym, box=box, token=token)
                    if folder_id and move_message(graph_id, folder_id, box=box, token=token):
                        filed += 1

        db.add(EmailMessage(
            direction=EmailDirection.inbound,
            operator_id=operator_id,
            confederation_id=confederation_id,
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

    db.add(AuditLog(action="SYNC_INBOX", description=f"Caixa de entrada: {imported} importados, {matched} casados, {filed} arquivados por confederação"))
    db.commit()
    return {"imported": imported, "matched": matched, "skipped": skipped, "filed": filed, "configured": True}
