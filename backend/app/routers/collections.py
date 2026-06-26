from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import date, timedelta
from ..database import get_db
from ..models.collection import CollectionCycle, CollectionEvent, CycleStatus, EventType, EventChannel
from ..models.operator import BettingOperator, OperatorStatus, ContactType
from ..models.payment import Payment, PaymentStatus, DirectPayment
from ..models.confederation import Confederation
from ..models.document import Document, DocumentType, DocumentCategory
from ..models.user import User
from ..schemas.collection import CycleCreate, CycleOut, EventCreate, EventOut
from ..core.auth import get_current_user, require_office
from ..services.audit_service import log_action
from ..services.notification_service import send_collection_notification, render_placeholders
from ..services.email_service import send_email
from ..services.scheduler import is_endr_associated

router = APIRouter(prefix="/api/collections", tags=["collections"])


class NotificationRecipient(BaseModel):
    operator_id: int
    email: Optional[str] = None


class SendConfirmedRequest(BaseModel):
    notification_number: int = 1
    subject: str
    body: str
    recipients: List[NotificationRecipient]


class SpaLetterRequest(BaseModel):
    inadimplente_operator_ids: List[int]
    city: Optional[str] = "Rio de Janeiro"
    first_notif_date: Optional[str] = ""
    second_notif_date: Optional[str] = ""
    spa_list_date: Optional[str] = ""
    endr_list_date: Optional[str] = ""


@router.get("/", response_model=List[CycleOut])
def list_cycles(confederation_id: Optional[int] = None, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    q = db.query(CollectionCycle)
    if current_user.role == "confederation_viewer":
        q = q.filter(CollectionCycle.confederation_id == current_user.confederation_id)
    elif confederation_id:
        q = q.filter(CollectionCycle.confederation_id == confederation_id)
    return q.order_by(CollectionCycle.reference_month.desc()).all()


@router.post("/", response_model=CycleOut)
def create_cycle(data: CycleCreate, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    existing = db.query(CollectionCycle).filter(
        CollectionCycle.confederation_id == data.confederation_id,
        CollectionCycle.reference_month == data.reference_month
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Ciclo já existe para esse mês e confederação")

    cycle = CollectionCycle(confederation_id=data.confederation_id, reference_month=data.reference_month, template_id=data.template_id)
    db.add(cycle)
    db.flush()

    operators = db.query(BettingOperator).filter(BettingOperator.status == OperatorStatus.active).all()
    for op in operators:
        db.add(Payment(cycle_id=cycle.id, operator_id=op.id, confederation_id=data.confederation_id, status=PaymentStatus.pending))

    db.commit()
    db.refresh(cycle)
    log_action(db=db, action="CREATE", entity_type="CollectionCycle", entity_id=cycle.id, user_id=current_user.id)
    return cycle


@router.get("/{id}", response_model=CycleOut)
def get_cycle(id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    cycle = db.query(CollectionCycle).get(id)
    if not cycle:
        raise HTTPException(status_code=404, detail="Ciclo não encontrado")
    return cycle


def _operator_label(op: BettingOperator) -> str:
    return op.fantasy_name or op.company_name or f"Operador #{op.id}"


def _operator_emails(op: BettingOperator) -> List[str]:
    return [c.value for c in op.contacts if c.type == ContactType.email and c.value]


def _has_paid(db: Session, cycle: CollectionCycle, operator_id: int) -> bool:
    """Operador considerado adimplente se há repasse registrado no ciclo OU lançamento avulso no mês."""
    pay = db.query(Payment).filter(
        Payment.cycle_id == cycle.id, Payment.operator_id == operator_id
    ).first()
    if pay and (pay.status in (PaymentStatus.paid, PaymentStatus.report_pending) or (pay.amount_paid and float(pay.amount_paid) > 0)):
        return True
    direct = db.query(DirectPayment).filter(
        DirectPayment.operator_id == operator_id,
        DirectPayment.confederation_id == cycle.confederation_id,
        DirectPayment.reference_month == cycle.reference_month,
    ).first()
    return direct is not None


def _find_occasion_template(db: Session, confederation_id: int, notification_number: int):
    from ..models.messaging import MessageTemplate, TemplateOccasion
    occasion = TemplateOccasion.first_notification if notification_number == 1 else TemplateOccasion.second_notification
    tmpl = db.query(MessageTemplate).filter(
        MessageTemplate.occasion == occasion, MessageTemplate.active == True,
        MessageTemplate.confederation_id == confederation_id,
    ).first()
    if tmpl:
        return tmpl
    return db.query(MessageTemplate).filter(
        MessageTemplate.occasion == occasion, MessageTemplate.active == True,
        MessageTemplate.confederation_id.is_(None),
    ).first()


@router.get("/{id}/notification-preview")
def notification_preview(id: int, notification_number: int = 1, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    """Tela de revisão: separa quem pagou, quem está no ENDR e quem receberá a notificação."""
    cycle = db.query(CollectionCycle).get(id)
    if not cycle:
        raise HTTPException(status_code=404, detail="Ciclo não encontrado")
    conf = db.query(Confederation).get(cycle.confederation_id)

    payments = db.query(Payment).filter(Payment.cycle_id == cycle.id).all()
    op_ids = [p.operator_id for p in payments]
    operators = {o.id: o for o in db.query(BettingOperator).filter(BettingOperator.id.in_(op_ids)).all()} if op_ids else {}

    paid, endr, recipients = [], [], []
    for op_id in op_ids:
        op = operators.get(op_id)
        if not op:
            continue
        info = {"operator_id": op.id, "label": _operator_label(op), "cnpj": op.cnpj,
                "authorization_number": op.authorization_number, "emails": _operator_emails(op)}
        if _has_paid(db, cycle, op_id):
            paid.append(info)
        elif is_endr_associated(db, op_id, cycle.reference_month):
            endr.append(info)
        else:
            recipients.append(info)

    # mensagem padrão (template da ocasião) com placeholders preservados para edição
    tmpl = _find_occasion_template(db, cycle.confederation_id, notification_number)
    if tmpl:
        subject, body = tmpl.subject, tmpl.body
    else:
        subject = f"{notification_number}ª Notificação - Repasse Direito de Imagem {{mes}} - {conf.acronym}"
        body = ("Prezados representantes de {bet},\n\nSolicitamos o repasse da contrapartida de direito de imagem "
                "referente ao mês de {mes}, em favor da {confederacao}, no prazo de {prazo}.\n\nAtenciosamente,\n{escritorio}")

    deadline_days = (conf.first_notification_deadline_days if notification_number == 1 else conf.second_notification_deadline_days) or 10
    deadline = (date.today() + timedelta(days=deadline_days)).strftime("%d/%m/%Y")

    return {
        "cycle_id": cycle.id,
        "confederation": {"id": conf.id, "name": conf.name, "acronym": conf.acronym},
        "reference_month": cycle.reference_month.strftime("%m/%Y"),
        "notification_number": notification_number,
        "deadline_days": deadline_days,
        "deadline": deadline,
        "paid": paid,
        "endr": endr,
        "recipients": recipients,
        "message": {"subject": subject, "body": body},
    }


@router.post("/{id}/send-confirmed")
def send_confirmed(id: int, data: SendConfirmedRequest, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    """Envia a notificação apenas aos destinatários confirmados, com a mensagem revisada."""
    cycle = db.query(CollectionCycle).get(id)
    if not cycle:
        raise HTTPException(status_code=404, detail="Ciclo não encontrado")
    conf = db.query(Confederation).get(cycle.confederation_id)
    ref = cycle.reference_month.strftime("%m/%Y")

    sent, failed = 0, 0
    for rec in data.recipients:
        op = db.query(BettingOperator).get(rec.operator_id)
        if not op:
            failed += 1
            continue
        to_addr = [rec.email] if rec.email else _operator_emails(op)[:3]
        subject = render_placeholders(data.subject, op, conf, ref)
        body = render_placeholders(data.body, op, conf, ref)
        ok = bool(to_addr) and send_email(to=to_addr, subject=subject, body=body)
        ev = CollectionEvent(
            cycle_id=cycle.id, operator_id=op.id,
            event_type=EventType.notification_sent, channel=EventChannel.email,
            notes=(f"{data.notification_number}ª notificação enviada para {', '.join(to_addr)}"
                   if ok else f"[FALHOU] {data.notification_number}ª notificação — {_operator_label(op)} (sem e-mail ou serviço não configurado)"),
            performed_by_id=current_user.id,
        )
        db.add(ev)
        # Registra e-mail enviado para conciliação posterior
        try:
            from ..models.messaging import EmailMessage, EmailDirection
            from datetime import datetime
            db.add(EmailMessage(
                direction=EmailDirection.outbound, operator_id=op.id, confederation_id=conf.id,
                cycle_id=cycle.id, subject=subject, body_preview=body[:1000],
                to_addr=", ".join(to_addr), sent_at=datetime.utcnow(),
            ))
        except Exception:
            pass
        if ok:
            sent += 1
        else:
            failed += 1

    if cycle.status == CycleStatus.open:
        cycle.status = CycleStatus.collecting
    db.commit()
    log_action(db=db, action=f"SEND_NOTIFICATION_{data.notification_number}", entity_type="CollectionCycle",
               entity_id=cycle.id, user_id=current_user.id,
               description=f"{data.notification_number}ª notificação: {sent} enviados, {failed} falhas")
    return {"sent": sent, "failed": failed, "total": len(data.recipients)}


@router.post("/{id}/spa-letter")
def generate_spa_letter(id: int, data: SpaLetterRequest, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    """Gera a minuta (.docx) do ofício à SPA com a relação de inadimplentes e arquiva como Documento."""
    from ..services.spa_letter import generate_spa_letter_docx
    cycle = db.query(CollectionCycle).get(id)
    if not cycle:
        raise HTTPException(status_code=404, detail="Ciclo não encontrado")
    conf = db.query(Confederation).get(cycle.confederation_id)

    inadimplentes = []
    for op_id in data.inadimplente_operator_ids:
        op = db.query(BettingOperator).get(op_id)
        if op:
            inadimplentes.append({
                "autorizacao": op.authorization_number or op.mf_license_number,
                "cnpj": op.cnpj,
                "razao_social": op.company_name,
            })

    # contagem de associados ao ENDR (para o parágrafo do ofício)
    payments = db.query(Payment).filter(Payment.cycle_id == cycle.id).all()
    endr_count = sum(1 for p in payments if is_endr_associated(db, p.operator_id, cycle.reference_month))

    try:
        result = generate_spa_letter_docx(
            confederation=conf, reference_month=cycle.reference_month,
            inadimplentes=inadimplentes, endr_count=endr_count,
            city=data.city or "Rio de Janeiro",
            first_notif_date=data.first_notif_date or "", second_notif_date=data.second_notif_date or "",
            spa_list_date=data.spa_list_date or "", endr_list_date=data.endr_list_date or "",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao gerar minuta: {e}")

    import os
    doc = Document(
        confederation_id=conf.id, cycle_id=cycle.id,
        title=f"Minuta - Ofício SPA - {conf.acronym} - {cycle.reference_month.strftime('%m/%Y')}",
        document_type=DocumentType.correspondence, category=DocumentCategory.minuta,
        file_path=result["file_path"], file_name=result["file_name"],
        file_size=os.path.getsize(result["file_path"]) if os.path.exists(result["file_path"]) else None,
        description="Minuta gerada automaticamente do ofício à Secretaria de Prêmios e Apostas.",
        uploaded_by_id=current_user.id,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    log_action(db=db, action="GENERATE_SPA_LETTER", entity_type="CollectionCycle", entity_id=cycle.id,
               user_id=current_user.id, description=f"Minuta de ofício à SPA gerada ({len(inadimplentes)} inadimplentes)")
    return {"document_id": doc.id, "file_name": result["file_name"], "text": result["text"]}


@router.get("/{id}/spa-letter/{document_id}/download")
def download_spa_letter(id: int, document_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    doc = db.query(Document).get(document_id)
    if not doc or doc.cycle_id != id:
        raise HTTPException(status_code=404, detail="Documento não encontrado")
    return FileResponse(doc.file_path, filename=doc.file_name,
                        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document")


@router.get("/{id}/events", response_model=List[EventOut])
def list_events(id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(CollectionEvent).filter(CollectionEvent.cycle_id == id).order_by(CollectionEvent.performed_at.desc()).all()


@router.post("/{id}/events", response_model=EventOut)
def add_event(id: int, data: EventCreate, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    cycle = db.query(CollectionCycle).get(id)
    if not cycle:
        raise HTTPException(status_code=404, detail="Ciclo não encontrado")
    event = CollectionEvent(cycle_id=id, performed_by_id=current_user.id, **data.model_dump())
    db.add(event)
    db.commit()
    db.refresh(event)
    log_action(db=db, action="ADD_EVENT", entity_type="CollectionCycle", entity_id=id, user_id=current_user.id)
    return event


@router.post("/{id}/send-notifications")
def send_notifications(id: int, notification_number: int = 1, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    from ..models.confederation import Confederation
    cycle = db.query(CollectionCycle).get(id)
    if not cycle:
        raise HTTPException(status_code=404, detail="Ciclo não encontrado")
    confederation = db.query(Confederation).get(cycle.confederation_id)

    pending = db.query(Payment).filter(
        Payment.cycle_id == id,
        Payment.status.in_([PaymentStatus.pending, PaymentStatus.overdue])
    ).all()

    from ..services.scheduler import is_endr_associated
    from ..models.collection import CollectionEvent, EventType, EventChannel

    sent = 0
    failed = 0
    skipped_endr = 0
    for payment in pending:
        op = db.query(BettingOperator).get(payment.operator_id)
        if is_endr_associated(db, op.id, cycle.reference_month):
            event = CollectionEvent(
                cycle_id=id,
                operator_id=op.id,
                event_type=EventType.manual_note,
                channel=EventChannel.system,
                notes="Operador associado ao ENDR — cobrança suspensa neste mês",
                performed_by_id=current_user.id,
            )
            db.add(event)
            db.commit()
            skipped_endr += 1
            continue
        success = send_collection_notification(
            db=db, cycle_id=id, operator=op, confederation=confederation,
            reference_month=cycle.reference_month.strftime("%m/%Y"),
            notification_number=notification_number,
            performed_by_id=current_user.id,
            calculated_amount=float(payment.amount_due) if payment.amount_due else None
        )
        if success:
            sent += 1
        else:
            failed += 1

    return {"sent": sent, "failed": failed, "skipped_endr": skipped_endr, "total": len(pending)}
