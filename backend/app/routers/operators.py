from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks, UploadFile, File, Form
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime
from ..database import get_db
from ..models.operator import BettingOperator, OperatorContact, OperatorStatus, OperatorBrand, EndrAssociation
from ..models.user import User
from ..schemas.operator import OperatorCreate, OperatorUpdate, OperatorOut, ContactCreate, ContactOut, BrandCreate, BrandUpdate, BrandOut, EndrAssociationCreate, EndrAssociationOut, ContactSuggestionOut
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


# --- Brands ---

@router.get("/{id}/brands", response_model=List[BrandOut])
def list_brands(id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    op = db.query(BettingOperator).get(id)
    if not op:
        raise HTTPException(status_code=404, detail="Operador não encontrado")
    return op.brands


@router.post("/{id}/brands", response_model=BrandOut)
def add_brand(id: int, data: BrandCreate, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    op = db.query(BettingOperator).get(id)
    if not op:
        raise HTTPException(status_code=404, detail="Operador não encontrado")
    if len(op.brands) >= 3:
        raise HTTPException(status_code=400, detail="Limite de 3 marcas por agente operador atingido")
    brand = OperatorBrand(operator_id=id, **data.model_dump())
    db.add(brand)
    db.commit()
    db.refresh(brand)
    log_action(db=db, action="ADD_BRAND", entity_type="BettingOperator", entity_id=id, new_values=data.model_dump(), user_id=current_user.id)
    return brand


@router.patch("/{id}/brands/{brand_id}", response_model=BrandOut)
def update_brand(id: int, brand_id: int, data: BrandUpdate, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    brand = db.query(OperatorBrand).filter(OperatorBrand.id == brand_id, OperatorBrand.operator_id == id).first()
    if not brand:
        raise HTTPException(status_code=404, detail="Marca não encontrada")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(brand, k, v)
    db.commit()
    db.refresh(brand)
    log_action(db=db, action="UPDATE_BRAND", entity_type="BettingOperator", entity_id=id, new_values=data.model_dump(exclude_none=True), user_id=current_user.id)
    return brand


@router.delete("/{id}/brands/{brand_id}")
def delete_brand(id: int, brand_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    brand = db.query(OperatorBrand).filter(OperatorBrand.id == brand_id, OperatorBrand.operator_id == id).first()
    if not brand:
        raise HTTPException(status_code=404, detail="Marca não encontrada")
    db.delete(brand)
    db.commit()
    log_action(db=db, action="DELETE_BRAND", entity_type="BettingOperator", entity_id=id, user_id=current_user.id)
    return {"ok": True}


# --- ENDR Associations ---

@router.get("/{id}/endr", response_model=List[EndrAssociationOut])
def list_endr(id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    op = db.query(BettingOperator).get(id)
    if not op:
        raise HTTPException(status_code=404, detail="Operador não encontrado")
    return op.endr_associations


@router.post("/{id}/endr", response_model=EndrAssociationOut)
def add_endr(id: int, data: EndrAssociationCreate, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    op = db.query(BettingOperator).get(id)
    if not op:
        raise HTTPException(status_code=404, detail="Operador não encontrado")
    assoc = EndrAssociation(operator_id=id, updated_by_id=current_user.id, **data.model_dump())
    db.add(assoc)
    db.commit()
    db.refresh(assoc)
    log_action(db=db, action="ADD_ENDR_ASSOCIATION", entity_type="BettingOperator", entity_id=id, new_values=data.model_dump(default=str), user_id=current_user.id)
    return assoc


@router.delete("/{id}/endr/{assoc_id}")
def delete_endr(id: int, assoc_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    assoc = db.query(EndrAssociation).filter(EndrAssociation.id == assoc_id, EndrAssociation.operator_id == id).first()
    if not assoc:
        raise HTTPException(status_code=404, detail="Associação ENDR não encontrada")
    db.delete(assoc)
    db.commit()
    log_action(db=db, action="DELETE_ENDR_ASSOCIATION", entity_type="BettingOperator", entity_id=id, user_id=current_user.id)
    return {"ok": True}


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


# --- Contact Research ---

@router.post("/research-all")
def research_all(
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_office)
):
    """Inicia pesquisa de contatos para todos os operadores ativos."""
    from ..services.contact_researcher import research_all_operators
    background_tasks.add_task(research_all_operators, db)
    return {"message": "Pesquisa de contatos iniciada para todos os operadores ativos"}


@router.post("/{id}/research-contacts")
def research_contacts(
    id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_office)
):
    """Inicia pesquisa automática de contatos para o operador."""
    op = db.query(BettingOperator).get(id)
    if not op:
        raise HTTPException(status_code=404, detail="Operador não encontrado")

    from ..services.contact_researcher import research_operator
    background_tasks.add_task(research_operator, db, id, current_user.id)
    return {"message": f"Pesquisa de contatos iniciada para {op.company_name}"}


@router.get("/{id}/suggestions", response_model=List[ContactSuggestionOut])
def list_suggestions(
    id: int,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Lista sugestões de contato para um operador."""
    from ..models.operator import ContactSuggestion
    q = db.query(ContactSuggestion).filter(ContactSuggestion.operator_id == id)
    if status:
        q = q.filter(ContactSuggestion.status == status)
    return q.order_by(ContactSuggestion.found_at.desc()).all()


@router.post("/{id}/suggestions/{suggestion_id}/approve")
def approve_suggestion(
    id: int,
    suggestion_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_office)
):
    """Aprova uma sugestão de contato — cria o contato oficial."""
    from ..models.operator import ContactSuggestion, SuggestionStatus
    suggestion = db.query(ContactSuggestion).filter(
        ContactSuggestion.id == suggestion_id,
        ContactSuggestion.operator_id == id
    ).first()
    if not suggestion:
        raise HTTPException(status_code=404, detail="Sugestão não encontrada")

    # Cria contato oficial
    contact = OperatorContact(
        operator_id=id,
        type=suggestion.type,
        value=suggestion.value,
        label=suggestion.relationship_label,
        source=suggestion.source,
        is_primary=False,
    )
    db.add(contact)

    suggestion.status = SuggestionStatus.approved
    suggestion.reviewed_by_id = current_user.id
    suggestion.reviewed_at = datetime.utcnow()
    db.commit()
    db.refresh(contact)

    log_action(db=db, action="APPROVE_SUGGESTION", entity_type="BettingOperator", entity_id=id,
               new_values={"value": suggestion.value, "type": str(suggestion.type)}, user_id=current_user.id)
    return {"ok": True, "contact_id": contact.id}


@router.post("/{id}/suggestions/{suggestion_id}/reject")
def reject_suggestion(
    id: int,
    suggestion_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_office)
):
    """Rejeita uma sugestão de contato."""
    from ..models.operator import ContactSuggestion, SuggestionStatus
    suggestion = db.query(ContactSuggestion).filter(
        ContactSuggestion.id == suggestion_id,
        ContactSuggestion.operator_id == id
    ).first()
    if not suggestion:
        raise HTTPException(status_code=404, detail="Sugestão não encontrada")

    suggestion.status = SuggestionStatus.rejected
    suggestion.reviewed_by_id = current_user.id
    suggestion.reviewed_at = datetime.utcnow()
    db.commit()

    log_action(db=db, action="REJECT_SUGGESTION", entity_type="BettingOperator", entity_id=id,
               new_values={"value": suggestion.value}, user_id=current_user.id)
    return {"ok": True}
