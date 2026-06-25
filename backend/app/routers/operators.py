from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks, UploadFile, File, Form
from sqlalchemy.orm import Session
from typing import List, Optional
from ..database import get_db
from ..models.operator import BettingOperator, OperatorContact, OperatorStatus
from ..models.user import User
from ..schemas.operator import OperatorCreate, OperatorUpdate, OperatorOut, ContactCreate, ContactOut
from ..core.auth import get_current_user, require_office
from ..services.audit_service import log_action
from ..services.mf_scraper import scrape_mf_operators, import_from_file, get_last_sync_info
from ..services.ai_service import find_operator_contacts

router = APIRouter(prefix="/api/operators", tags=["operators"])


@router.get("/sync-status")
def sync_status(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Retorna data/hora da última sincronização e total de operadores."""
    total = db.query(BettingOperator).count()
    ativos = db.query(BettingOperator).filter(BettingOperator.status == OperatorStatus.active).count()
    sync_info = get_last_sync_info(db)
    return {
        "total_operators": total,
        "active_operators": ativos,
        **sync_info
    }


@router.get("/", response_model=List[OperatorOut])
def list_operators(
    status: Optional[OperatorStatus] = None,
    search: Optional[str] = Query(None),
    skip: int = 0,
    limit: int = 200,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    q = db.query(BettingOperator)
    if status:
        q = q.filter(BettingOperator.status == status)
    if search:
        q = q.filter(
            BettingOperator.company_name.ilike(f"%{search}%") |
            BettingOperator.fantasy_name.ilike(f"%{search}%") |
            BettingOperator.cnpj.ilike(f"%{search}%")
        )
    return q.order_by(BettingOperator.company_name).offset(skip).limit(limit).all()


@router.post("/", response_model=OperatorOut)
def create_operator(data: OperatorCreate, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    op = BettingOperator(**data.model_dump())
    db.add(op)
    db.commit()
    db.refresh(op)
    log_action(db=db, action="CREATE", entity_type="BettingOperator", entity_id=op.id, new_values=data.model_dump(), user_id=current_user.id)
    return op


@router.get("/{id}", response_model=OperatorOut)
def get_operator(id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    op = db.query(BettingOperator).get(id)
    if not op:
        raise HTTPException(status_code=404, detail="Operador não encontrado")
    return op


@router.patch("/{id}", response_model=OperatorOut)
def update_operator(id: int, data: OperatorUpdate, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    op = db.query(BettingOperator).get(id)
    if not op:
        raise HTTPException(status_code=404, detail="Operador não encontrado")
    old = {k: str(v) for k, v in op.__dict__.items() if not k.startswith("_")}
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(op, k, v)
    db.commit()
    db.refresh(op)
    log_action(db=db, action="UPDATE", entity_type="BettingOperator", entity_id=id, old_values=old, new_values=data.model_dump(exclude_none=True), user_id=current_user.id)
    return op


@router.post("/{id}/contacts", response_model=ContactOut)
def add_contact(id: int, data: ContactCreate, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    op = db.query(BettingOperator).get(id)
    if not op:
        raise HTTPException(status_code=404, detail="Operador não encontrado")
    contact = OperatorContact(operator_id=id, **data.model_dump())
    db.add(contact)
    db.commit()
    db.refresh(contact)
    log_action(db=db, action="ADD_CONTACT", entity_type="BettingOperator", entity_id=id, new_values=data.model_dump(), user_id=current_user.id)
    return contact


@router.delete("/{id}/contacts/{contact_id}")
def delete_contact(id: int, contact_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    contact = db.query(OperatorContact).filter(OperatorContact.id == contact_id, OperatorContact.operator_id == id).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contato não encontrado")
    db.delete(contact)
    db.commit()
    log_action(db=db, action="DELETE_CONTACT", entity_type="BettingOperator", entity_id=id, user_id=current_user.id)
    return {"ok": True}


@router.post("/{id}/find-contacts")
def ai_find_contacts(id: int, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    op = db.query(BettingOperator).get(id)
    if not op:
        raise HTTPException(status_code=404, detail="Operador não encontrado")
    result = find_operator_contacts(op.company_name, op.fantasy_name, op.cnpj, op.website)
    log_action(db=db, action="AI_FIND_CONTACTS", entity_type="BettingOperator", entity_id=id, user_id=current_user.id)
    return result


@router.post("/sync-mf")
def sync_from_mf(db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    """Tenta sincronizar diretamente com o site do MF/SPA."""
    result = scrape_mf_operators(db)
    return result


@router.post("/import")
async def import_operators(
    file: UploadFile = File(...),
    category: str = Form("autorizada"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_office)
):
    """
    Importa operadores de um arquivo CSV ou XLSX.
    Categorias: 'autorizada' ou 'judicial' (decisão judicial).
    Colunas aceitas: Razão Social, Nome Fantasia, CNPJ, Site, Licença/Autorização
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="Nenhum arquivo enviado")

    allowed = (".csv", ".xlsx", ".xls")
    if not any(file.filename.lower().endswith(ext) for ext in allowed):
        raise HTTPException(status_code=400, detail="Formato inválido. Use CSV ou XLSX.")

    content = await file.read()
    result = import_from_file(db, content, file.filename, category, current_user.id)
    return result
