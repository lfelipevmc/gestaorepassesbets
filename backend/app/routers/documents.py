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
