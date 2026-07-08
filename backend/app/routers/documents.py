from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from typing import Optional, List
from ..database import get_db
from ..models.document import Document, DocumentType, DocumentCategory
from ..models.user import User
from ..core.auth import get_current_user, require_office
from ..config import settings
from ..services.audit_service import log_action
import os, aiofiles, uuid

router = APIRouter(prefix="/api/documents", tags=["documents"])


@router.get("/")
def list_documents(
    operator_id: Optional[int] = None,
    confederation_id: Optional[int] = None,
    cycle_id: Optional[int] = None,
    category: Optional[DocumentCategory] = None,
    document_type: Optional[DocumentType] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    q = db.query(Document)
    if operator_id:
        q = q.filter(Document.operator_id == operator_id)
    if confederation_id:
        q = q.filter(Document.confederation_id == confederation_id)
    if cycle_id:
        q = q.filter(Document.cycle_id == cycle_id)
    if category:
        q = q.filter(Document.category == category)
    if document_type:
        q = q.filter(Document.document_type == document_type)
    if current_user.role == "confederation_viewer":
        q = q.filter(Document.confederation_id == current_user.confederation_id)
    return q.order_by(Document.created_at.desc()).all()


@router.post("/upload")
async def upload_document(
    file: UploadFile = File(...),
    title: str = Form(...),
    document_type: DocumentType = Form(...),
    category: DocumentCategory = Form(DocumentCategory.documento_oficial),
    operator_id: Optional[int] = Form(None),
    confederation_id: Optional[int] = Form(None),
    cycle_id: Optional[int] = Form(None),
    description: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_office)
):
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    ext = os.path.splitext(file.filename)[1]
    stored_name = f"{uuid.uuid4()}{ext}"
    file_path = os.path.join(settings.UPLOAD_DIR, stored_name)

    content = await file.read()
    # Qualquer formato é aceito; o tamanho é limitado para não consumir o armazenamento do servidor.
    MAX_SIZE = 25 * 1024 * 1024  # 25 MB
    if len(content) > MAX_SIZE:
        raise HTTPException(status_code=413, detail="Arquivo maior que 25 MB. Compacte ou divida o documento.")

    async with aiofiles.open(file_path, "wb") as f:
        await f.write(content)

    doc = Document(
        operator_id=operator_id,
        confederation_id=confederation_id,
        cycle_id=cycle_id,
        title=title,
        document_type=document_type,
        category=category,
        file_path=file_path,
        file_name=file.filename,
        file_size=len(content),
        description=description,
        uploaded_by_id=current_user.id,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    log_action(db=db, action="UPLOAD_DOCUMENT", entity_type="Document", entity_id=doc.id, user_id=current_user.id)
    return doc


@router.get("/{id}/download")
def download_document(id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    doc = db.query(Document).get(id)
    if not doc or not os.path.exists(doc.file_path):
        raise HTTPException(status_code=404, detail="Documento não encontrado")
    return FileResponse(doc.file_path, filename=doc.file_name)


# ============================================================================
# HISTÓRICO DE E-MAILS POR OPERADOR (item 14)
# Auditoria: envios e respostas separados por Bet, com download consolidado.
# ============================================================================

@router.get("/email-history/{operator_id}")
def email_history(operator_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Histórico completo de e-mails (enviados e respostas) de um operador."""
    from ..models.messaging import EmailMessage
    msgs = (db.query(EmailMessage)
            .filter(EmailMessage.operator_id == operator_id)
            .order_by(EmailMessage.created_at.desc())
            .all())
    return [{
        "id": m.id,
        "direction": m.direction.value if hasattr(m.direction, "value") else m.direction,
        "subject": m.subject,
        "body_preview": m.body_preview,
        "from_addr": m.from_addr,
        "to_addr": m.to_addr,
        "protocol": m.protocol,
        "channel": m.channel,
        "confederation_id": m.confederation_id,
        "sent_at": m.sent_at.isoformat() if m.sent_at else None,
        "received_at": m.received_at.isoformat() if m.received_at else None,
        "created_at": m.created_at.isoformat() if m.created_at else None,
    } for m in msgs]


@router.get("/email-history/{operator_id}/download")
def email_history_download(operator_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Gera um arquivo HTML com todo o histórico de e-mails do operador, para auditoria."""
    from fastapi.responses import Response
    from datetime import datetime
    from ..models.messaging import EmailMessage
    from ..models.operator import BettingOperator
    from ..models.confederation import Confederation

    op = db.query(BettingOperator).get(operator_id)
    if not op:
        raise HTTPException(status_code=404, detail="Operador não encontrado")
    msgs = (db.query(EmailMessage)
            .filter(EmailMessage.operator_id == operator_id)
            .order_by(EmailMessage.created_at.asc())
            .all())
    conf_map = {c.id: c.acronym for c in db.query(Confederation).all()}

    def esc(s):
        return (s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    parts = [
        "<html><head><meta charset='utf-8'><title>Histórico de E-mails</title>",
        "<style>body{font-family:Arial,sans-serif;margin:24px;color:#222}"
        ".msg{border:1px solid #ccc;border-radius:8px;padding:12px 16px;margin-bottom:14px}"
        ".out{border-left:5px solid #2563eb}.in{border-left:5px solid #16a34a}"
        ".meta{font-size:12px;color:#555}h1{font-size:20px}h2{font-size:14px;margin:0 0 6px}"
        ".tag{display:inline-block;font-size:11px;padding:1px 8px;border-radius:10px;background:#eee;margin-right:6px}</style></head><body>",
        f"<h1>Histórico de E-mails — {esc(op.company_name)}</h1>",
        f"<p class='meta'>CNPJ: {esc(op.cnpj) or '—'} · Gerado em {datetime.now().strftime('%d/%m/%Y %H:%M')} · {len(msgs)} mensagem(ns)</p><hr>",
    ]
    for m in msgs:
        d = m.direction.value if hasattr(m.direction, "value") else str(m.direction)
        cls = "out" if d == "outbound" else "in"
        rotulo = "ENVIADO" if d == "outbound" else "RESPOSTA RECEBIDA"
        when = m.sent_at or m.received_at or m.created_at
        parts.append(
            f"<div class='msg {cls}'>"
            f"<span class='tag'>{rotulo}</span>"
            + (f"<span class='tag'>{esc(conf_map.get(m.confederation_id))}</span>" if m.confederation_id else "")
            + (f"<span class='tag'>Protocolo {esc(m.protocol)}</span>" if m.protocol else "")
            + f"<h2>{esc(m.subject) or '(sem assunto)'}</h2>"
            f"<p class='meta'>De: {esc(m.from_addr) or '—'} · Para: {esc(m.to_addr) or '—'} · "
            f"{when.strftime('%d/%m/%Y %H:%M') if when else '—'}</p>"
            f"<p>{esc(m.body_preview) or '<i>(sem prévia do conteúdo)</i>'}</p></div>"
        )
    parts.append("</body></html>")
    html = "".join(parts)
    fname = f"emails_{(op.fantasy_name or op.company_name or 'operador').replace(' ', '_')[:40]}.html"
    return Response(content=html, media_type="text/html; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{fname}"'})
