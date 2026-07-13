from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
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
from ..core.auth import get_current_user, require_office, require_admin
from ..services.audit_service import log_action
from ..services.notification_service import render_placeholders
from ..services.email_service import send_email
from ..services.scheduler import is_endr_associated
from ..services.status_service import effective_conclusions, get_paid_map, LABELS_PT, month_start

router = APIRouter(prefix="/api/collections", tags=["collections"])


class NotificationRecipient(BaseModel):
    operator_id: int
    email: Optional[str] = None


class SendConfirmedRequest(BaseModel):
    notification_number: int = 1
    subject: str
    body: str
    deadline: Optional[str] = None   # prazo textual para a chave {prazo}
    recipients: List[NotificationRecipient]
    # Trava de segurança (política pós-incidente 12/07/2026): NENHUM e-mail sai
    # para agentes operadores sem o usuário confirmar com a própria senha de login.
    password: str


class SpaLetterRequest(BaseModel):
    inadimplente_operator_ids: List[int]
    city: Optional[str] = "Rio de Janeiro"
    first_notif_date: Optional[str] = ""
    second_notif_date: Optional[str] = ""
    spa_list_date: Optional[str] = ""
    endr_list_date: Optional[str] = ""


@router.get("/", response_model=List[CycleOut])
def list_cycles(confederation_id: Optional[int] = None, include_archived: bool = False,
                db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    q = db.query(CollectionCycle)
    if not include_archived:
        q = q.filter(CollectionCycle.archived == False)
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

    # O ciclo NÃO cria lista própria de operadores: ele espelha a relação da confederação
    # (Agentes Operadores = base central; ver endpoint /board). Nada é duplicado no banco.
    cycle = CollectionCycle(confederation_id=data.confederation_id, reference_month=data.reference_month, template_id=data.template_id)
    db.add(cycle)
    db.commit()
    db.refresh(cycle)
    log_action(db=db, action="CREATE", entity_type="CollectionCycle", entity_id=cycle.id, user_id=current_user.id,
               confederation_id=data.confederation_id)
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
    if notification_number == 1:
        occasion = TemplateOccasion.first_notification
    elif notification_number == 2:
        occasion = TemplateOccasion.second_notification
    else:
        occasion = TemplateOccasion.final_notice
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
    """Revisão do envio. Classificação vem da Conclusão de cada operador PERANTE a confederação
    do ciclo (SSOT): apenas INADIMPLENTES vêm pré-selecionados; ENDR, Adimplentes, Consignação
    e Sem Obrigação ficam disponíveis para inclusão manual."""
    cycle = db.query(CollectionCycle).get(id)
    if not cycle:
        raise HTTPException(status_code=404, detail="Ciclo não encontrado")
    conf = db.query(Confederation).get(cycle.confederation_id)

    conclusions = effective_conclusions(db, cycle.confederation_id, cycle.reference_month)
    operators = {o.id: o for o in db.query(BettingOperator).filter(BettingOperator.status == OperatorStatus.active).all()}

    groups = {"inadimplente": [], "adimplente": [], "endr": [], "consignacao": [], "sem_obrigacao": []}
    for op_id, op in operators.items():
        info = {"operator_id": op.id, "label": _operator_label(op), "cnpj": op.cnpj,
                "authorization_number": op.authorization_number or op.mf_license_number,
                "emails": _operator_emails(op)}
        groups.setdefault(conclusions.get(op_id, "inadimplente"), groups["inadimplente"]).append(info)

    tmpl = _find_occasion_template(db, cycle.confederation_id, notification_number)
    if tmpl:
        subject, body = tmpl.subject, tmpl.body
    else:
        subject = "{confederacaosigla} - Contrapartida Direito de Imagem {mes}/{ano}"
        body = ("Prezados representantes de {bet},\n\nSolicitamos o repasse da contrapartida de direito de imagem "
                "referente ao mês de {mes}/{ano}, em favor da {confederacao}, no prazo de {prazo}.\n\nAtenciosamente,\n{escritorio}")

    deadline_days = (conf.first_notification_deadline_days if notification_number == 1 else conf.second_notification_deadline_days) or 10
    deadline = (date.today() + timedelta(days=deadline_days)).strftime("%d/%m/%Y")

    return {
        "cycle_id": cycle.id,
        "confederation": {"id": conf.id, "name": conf.name, "acronym": conf.acronym},
        "reference_month": cycle.reference_month.strftime("%m/%Y"),
        "notification_number": notification_number,
        "deadline_days": deadline_days,
        "deadline": deadline,
        # pré-selecionados: somente inadimplentes
        "recipients": groups["inadimplente"],
        # disponíveis para inclusão manual (não selecionados por padrão)
        "paid": groups["adimplente"],
        "endr": groups["endr"],
        "consignacao": groups["consignacao"],
        "sem_obrigacao": groups["sem_obrigacao"],
        "message": {"subject": subject, "body": body},
    }


@router.post("/{id}/send-confirmed")
def send_confirmed(id: int, data: SendConfirmedRequest, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    """Envia a notificação apenas aos destinatários confirmados, com a mensagem revisada.

    ÚNICO caminho de envio de e-mail a agentes operadores em todo o sistema.
    Exige a senha de login do usuário (verificada abaixo) — envios automáticos
    foram abolidos em 13/07/2026."""
    from ..core.auth import verify_password
    if not data.password or not verify_password(data.password, current_user.hashed_password):
        log_action(db=db, action="SEND_AUTH_FAIL", entity_type="CollectionCycle", entity_id=id,
                   user_id=current_user.id,
                   description=f"Tentativa de disparo com senha incorreta ({len(data.recipients)} destinatário(s)) — envio BLOQUEADO")
        raise HTTPException(status_code=403, detail="Senha incorreta — o disparo não foi autorizado.")

    cycle = db.query(CollectionCycle).get(id)
    if not cycle:
        raise HTTPException(status_code=404, detail="Ciclo não encontrado")

    log_action(db=db, action="SEND_AUTHORIZED", entity_type="CollectionCycle", entity_id=id,
               user_id=current_user.id, confederation_id=cycle.confederation_id,
               description=f"Disparo autorizado por senha: {data.notification_number}ª notificação, {len(data.recipients)} destinatário(s)")
    conf = db.query(Confederation).get(cycle.confederation_id)
    ref = cycle.reference_month.strftime("%m/%Y")

    from ..models.office import OfficeSettings
    office = db.query(OfficeSettings).first()
    office_name = (office.signature_name or office.name) if office else None

    sent, failed = 0, 0
    results = []
    for rec in data.recipients:
        op = db.query(BettingOperator).get(rec.operator_id)
        if not op:
            failed += 1
            results.append({"operator_id": rec.operator_id, "label": "—", "email": rec.email, "ok": False, "reason": "operador inexistente"})
            continue
        to_addr = [rec.email] if rec.email else _operator_emails(op)[:3]
        subject = render_placeholders(data.subject, op, conf, ref, prazo=data.deadline, escritorio=office_name)
        body = render_placeholders(data.body, op, conf, ref, prazo=data.deadline, escritorio=office_name)
        ok = bool(to_addr) and send_email(to=to_addr, subject=subject, body=body,
                                          confederation_acronym=conf.acronym)
        ev = CollectionEvent(
            cycle_id=cycle.id, operator_id=op.id,
            event_type=EventType.notification_sent, channel=EventChannel.email,
            notes=(f"{data.notification_number}ª notificação enviada para {', '.join(to_addr)}"
                   if ok else f"[FALHOU] {data.notification_number}ª notificação — {_operator_label(op)} (sem e-mail ou serviço não configurado)"),
            performed_by_id=current_user.id,
        )
        db.add(ev)
        # Registra e-mail enviado para conciliação posterior e comprovante
        email_id = None
        try:
            from ..models.messaging import EmailMessage, EmailDirection
            from datetime import datetime
            em = EmailMessage(
                direction=EmailDirection.outbound, operator_id=op.id, confederation_id=conf.id,
                cycle_id=cycle.id, subject=subject, body_preview=body[:1000],
                to_addr=", ".join(to_addr), sent_at=datetime.now(), channel="email",
            )
            db.add(em)
            db.flush()
            email_id = em.id
            # Protocolo único de envio: SIGLA-AAAAMM-Nº
            em.protocol = f"{conf.acronym}-{cycle.reference_month.strftime('%Y%m')}-{em.id:05d}"
        except Exception:
            pass
        results.append({
            "operator_id": op.id, "label": _operator_label(op),
            "email": ", ".join(to_addr) if to_addr else None,
            "ok": ok, "email_id": email_id,
            "reason": None if ok else "sem e-mail cadastrado ou serviço de e-mail não configurado",
        })
        if ok:
            sent += 1
        else:
            failed += 1

    if cycle.status == CycleStatus.open:
        cycle.status = CycleStatus.collecting
    db.commit()
    log_action(db=db, action=f"SEND_NOTIFICATION_{data.notification_number}", entity_type="CollectionCycle",
               entity_id=cycle.id, user_id=current_user.id, confederation_id=conf.id,
               description=f"{data.notification_number}ª notificação: {sent} enviados, {failed} falhas")
    return {"sent": sent, "failed": failed, "total": len(data.recipients), "results": results}


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

    # contagem de associados ao ENDR na competência (fonte: aba ENDR)
    from ..services.status_service import get_endr_set
    endr_count = len(get_endr_set(db, cycle.reference_month))

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
               user_id=current_user.id, confederation_id=conf.id,
               description=f"Minuta de ofício à SPA gerada ({len(inadimplentes)} inadimplentes)")
    return {"document_id": doc.id, "file_name": result["file_name"], "text": result["text"]}


@router.get("/{id}/spa-letter/{document_id}/download")
def download_spa_letter(id: int, document_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    doc = db.query(Document).get(document_id)
    if not doc or doc.cycle_id != id:
        raise HTTPException(status_code=404, detail="Documento não encontrado")
    return FileResponse(doc.file_path, filename=doc.file_name,
                        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document")


@router.get("/{id}/board")
def cycle_board(id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Quadro do ciclo (ESPELHO): não há lista própria — as linhas são os agentes operadores da
    base central, com a Conclusão da confederação e os recebimentos da competência. A única
    informação operacional própria do ciclo são as Ações (Contactar / Registrar recebimento)."""
    cycle = db.query(CollectionCycle).get(id)
    if not cycle:
        raise HTTPException(status_code=404, detail="Ciclo não encontrado")
    conf = db.query(Confederation).get(cycle.confederation_id)
    if current_user.role == "confederation_viewer" and current_user.confederation_id != conf.id:
        raise HTTPException(status_code=403, detail="Acesso negado")

    conclusions = effective_conclusions(db, conf.id, cycle.reference_month)
    paid = get_paid_map(db, conf.id, cycle.reference_month)
    from ..models.operator import OperatorConfederationInfo
    infos = {i.operator_id: i for i in db.query(OperatorConfederationInfo).filter(
        OperatorConfederationInfo.confederation_id == conf.id).all()}

    rows = []
    for op in db.query(BettingOperator).filter(BettingOperator.status == OperatorStatus.active).order_by(BettingOperator.company_name).all():
        pm = paid.get(op.id, {})
        info = infos.get(op.id)
        rows.append({
            "operator_id": op.id,
            "label": _operator_label(op),
            "company_name": op.company_name,
            "cnpj": op.cnpj,
            "authorization": op.authorization_number or op.mf_license_number,
            "emails": _operator_emails(op),
            "conclusion": conclusions.get(op.id, "inadimplente"),
            "conclusion_label": LABELS_PT.get(conclusions.get(op.id, "inadimplente")),
            "conclusion_manual": bool(info.conclusion_manual) if info else False,
            "received_total": pm.get("total", 0.0),
            "last_payment_date": pm.get("last_date").isoformat() if pm.get("last_date") else None,
            "last_payment_amount": pm.get("last_amount"),
            "report_url": pm.get("report_url"),
            "notes": (info.notes if info else "") or "",
        })

    counts = {}
    for r in rows:
        counts[r["conclusion"]] = counts.get(r["conclusion"], 0) + 1
    return {
        "cycle": {"id": cycle.id, "status": cycle.status.value if hasattr(cycle.status, "value") else cycle.status,
                  "reference_month": cycle.reference_month.isoformat(), "archived": bool(cycle.archived)},
        "confederation": {"id": conf.id, "acronym": conf.acronym, "name": conf.name},
        "rows": rows,
        "counts": counts,
        "total": len(rows),
    }


@router.post("/{id}/archive")
def archive_cycle(id: int, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    """Arquiva o ciclo (somente admin). Ele some das listas, mas o histórico é preservado."""
    cycle = db.query(CollectionCycle).get(id)
    if not cycle:
        raise HTTPException(status_code=404, detail="Ciclo não encontrado")
    cycle.archived = True
    db.commit()
    log_action(db=db, action="ARCHIVE_CYCLE", entity_type="CollectionCycle", entity_id=id,
               user_id=current_user.id, confederation_id=cycle.confederation_id,
               description=f"Ciclo {cycle.reference_month.strftime('%m/%Y')} arquivado (histórico preservado)")
    return {"ok": True}


class CycleReceiptIn(BaseModel):
    operator_id: int
    amount: float
    received_date: date
    notes: Optional[str] = None


@router.post("/{id}/receipts")
def register_cycle_receipt(id: int, data: CycleReceiptIn, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    """Registra um recebimento a partir do ciclo — gravado na BASE CENTRAL (recebimento do
    operador × confederação × competência), sem criar estrutura própria do ciclo."""
    cycle = db.query(CollectionCycle).get(id)
    if not cycle:
        raise HTTPException(status_code=404, detail="Ciclo não encontrado")
    dp = DirectPayment(
        operator_id=data.operator_id, confederation_id=cycle.confederation_id,
        reference_month=cycle.reference_month, amount_received=data.amount,
        received_date=data.received_date, notes=data.notes, registered_by_id=current_user.id,
    )
    db.add(dp)
    db.add(CollectionEvent(
        cycle_id=id, operator_id=data.operator_id,
        event_type=EventType.payment_confirmed, channel=EventChannel.system,
        notes=f"Recebimento registrado: R$ {data.amount:,.2f} em {data.received_date.strftime('%d/%m/%Y')}",
        performed_by_id=current_user.id,
    ))
    db.commit()
    log_action(db=db, action="CYCLE_RECEIPT", entity_type="DirectPayment", entity_id=dp.id,
               user_id=current_user.id, confederation_id=cycle.confederation_id,
               new_values={"operator_id": data.operator_id, "amount": str(data.amount)})
    return {"ok": True, "receipt_id": dp.id}


@router.post("/{id}/receipts/{operator_id}/report")
async def upload_cycle_report(id: int, operator_id: int, file: UploadFile = File(...), db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    """Anexa o relatório de apuração do operador para a competência do ciclo.
    Se houver recebimento na competência, o arquivo é vinculado a ele; senão, fica como
    documento do operador com a competência marcada."""
    import os, uuid, shutil
    cycle = db.query(CollectionCycle).get(id)
    if not cycle:
        raise HTTPException(status_code=404, detail="Ciclo não encontrado")
    updir = "/app/uploads/reports"
    os.makedirs(updir, exist_ok=True)
    ext = os.path.splitext(file.filename or "relatorio.pdf")[1].lower()
    fname = f"cyc{id}_op{operator_id}_{uuid.uuid4().hex}{ext}"
    path = os.path.join(updir, fname)
    with open(path, "wb") as f:
        shutil.copyfileobj(file.file, f)
    url = f"/uploads/reports/{fname}"

    dp = db.query(DirectPayment).filter(
        DirectPayment.operator_id == operator_id,
        DirectPayment.confederation_id == cycle.confederation_id,
        DirectPayment.reference_month == cycle.reference_month,
    ).order_by(DirectPayment.received_date.desc()).first()
    if dp:
        dp.report_file_url = url
    db.add(Document(
        operator_id=operator_id, confederation_id=cycle.confederation_id, cycle_id=id,
        title=f"Relatório {cycle.reference_month.strftime('%m/%Y')} — competência",
        document_type=DocumentType.ggr_report, category=DocumentCategory.documento_oficial,
        file_path=path, file_name=file.filename or fname,
        file_size=os.path.getsize(path), reference_month=cycle.reference_month,
        uploaded_by_id=current_user.id,
    ))
    db.add(CollectionEvent(
        cycle_id=id, operator_id=operator_id, event_type=EventType.report_received,
        channel=EventChannel.system, notes="Relatório da competência anexado",
        performed_by_id=current_user.id,
    ))
    db.commit()
    return {"ok": True, "report_url": url}


@router.get("/{id}/emails")
def cycle_emails(id: int, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    """E-mails (enviados e recebidos) vinculados a este ciclo, agrupados por operador."""
    from ..models.messaging import EmailMessage, EmailDirection
    cycle = db.query(CollectionCycle).get(id)
    if not cycle:
        raise HTTPException(status_code=404, detail="Ciclo não encontrado")

    msgs = db.query(EmailMessage).filter(EmailMessage.cycle_id == id).order_by(EmailMessage.created_at.desc()).all()
    # também respostas não casadas a um ciclo mas do mesmo operador no mês podem ser úteis; mantemos só do ciclo
    op_ids = list({m.operator_id for m in msgs if m.operator_id})
    op_map = {o.id: _operator_label(o) for o in db.query(BettingOperator).filter(BettingOperator.id.in_(op_ids)).all()} if op_ids else {}

    out = []
    for m in msgs:
        out.append({
            "id": m.id,
            "direction": m.direction.value if hasattr(m.direction, "value") else m.direction,
            "operator_id": m.operator_id,
            "operator_label": op_map.get(m.operator_id, "—"),
            "subject": m.subject,
            "body_preview": m.body_preview,
            "from_addr": m.from_addr,
            "to_addr": m.to_addr,
            "matched": m.matched,
            "sent_at": m.sent_at.isoformat() if m.sent_at else None,
            "received_at": m.received_at.isoformat() if m.received_at else None,
        })
    sent = sum(1 for m in msgs if (m.direction == EmailDirection.outbound or m.direction == "outbound"))
    received = sum(1 for m in msgs if (m.direction == EmailDirection.inbound or m.direction == "inbound"))
    return {"emails": out, "sent": sent, "received": received}


@router.post("/{id}/sync-emails")
def cycle_sync_emails(id: int, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    """Lê a caixa de entrada (M365) e concilia respostas das Bets — mesma rotina do Financeiro,
    porém acionada a partir do ciclo de cobrança."""
    from ..services.email_matcher import sync_inbox
    return sync_inbox(db)


@router.get("/{id}/email/{email_id}/proof")
def email_send_proof(id: int, email_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    """Comprovante de envio de uma notificação a uma Bet (texto estruturado para impressão/arquivo)."""
    from ..models.messaging import EmailMessage
    em = db.query(EmailMessage).filter(EmailMessage.id == email_id, EmailMessage.cycle_id == id).first()
    if not em:
        raise HTTPException(status_code=404, detail="Registro de e-mail não encontrado")
    op = db.query(BettingOperator).get(em.operator_id) if em.operator_id else None
    conf = None
    cycle = db.query(CollectionCycle).get(id)
    if cycle:
        conf = db.query(Confederation).get(cycle.confederation_id)
    return {
        "operator": _operator_label(op) if op else "—",
        "confederation": conf.acronym if conf else "—",
        "to_addr": em.to_addr,
        "subject": em.subject,
        "body": em.body_preview,
        "sent_at": em.sent_at.isoformat() if em.sent_at else None,
        "reference_month": cycle.reference_month.strftime("%m/%Y") if cycle else None,
        "protocol": em.protocol,
    }


@router.get("/{id}/activity-report/pdf")
def cycle_activity_report(id: int, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    """Relatório de atividades do ciclo (PDF) — panorama do trabalho do mês."""
    from fastapi.responses import StreamingResponse
    from ..services.cycle_activity import generate_cycle_activity_pdf
    import io
    cycle = db.query(CollectionCycle).get(id)
    if not cycle:
        raise HTTPException(status_code=404, detail="Ciclo não encontrado")
    data = generate_cycle_activity_pdf(db, id)
    conf = db.query(Confederation).get(cycle.confederation_id)
    fname = f"atividades_{conf.acronym if conf else 'ciclo'}_{cycle.reference_month.strftime('%Y_%m')}.pdf"
    return StreamingResponse(io.BytesIO(data), media_type="application/pdf",
                             headers={"Content-Disposition": f"attachment; filename={fname}"})


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



