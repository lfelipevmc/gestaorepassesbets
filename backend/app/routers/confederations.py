from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from typing import List
import os, shutil, uuid
from ..database import get_db
from ..models.confederation import Confederation, DistributionRule
from ..models.user import User
from ..schemas.confederation import ConfederationCreate, ConfederationUpdate, ConfederationOut, DistributionRuleCreate, DistributionRuleUpdate, DistributionRuleOut
from ..core.auth import get_current_user, require_office
from ..services.audit_service import log_action

router = APIRouter(prefix="/api/confederations", tags=["confederations"])

UPLOAD_DIR = "/app/uploads/logos"


@router.get("/", response_model=List[ConfederationOut])
def list_confederations(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if current_user.role == "confederation_viewer":
        return db.query(Confederation).filter(Confederation.id == current_user.confederation_id).all()
    return db.query(Confederation).all()


@router.post("/", response_model=ConfederationOut)
def create_confederation(data: ConfederationCreate, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    conf = Confederation(**data.model_dump())
    db.add(conf)
    db.commit()
    db.refresh(conf)
    log_action(db=db, action="CREATE", entity_type="Confederation", entity_id=conf.id, new_values=data.model_dump(), user_id=current_user.id)
    return conf


@router.get("/{id}", response_model=ConfederationOut)
def get_confederation(id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    conf = db.query(Confederation).get(id)
    if not conf:
        raise HTTPException(status_code=404, detail="Confederação não encontrada")
    if current_user.role == "confederation_viewer" and current_user.confederation_id != id:
        raise HTTPException(status_code=403, detail="Acesso negado")
    return conf


@router.patch("/{id}", response_model=ConfederationOut)
def update_confederation(id: int, data: ConfederationUpdate, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    conf = db.query(Confederation).get(id)
    if not conf:
        raise HTTPException(status_code=404, detail="Confederação não encontrada")
    old = {k: str(v) for k, v in conf.__dict__.items() if not k.startswith("_")}
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(conf, k, v)
    db.commit()
    db.refresh(conf)
    log_action(db=db, action="UPDATE", entity_type="Confederation", entity_id=id, old_values=old, new_values=data.model_dump(exclude_none=True), user_id=current_user.id)
    return conf


@router.post("/{id}/upload-logo")
async def upload_logo(id: int, file: UploadFile = File(...), db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    conf = db.query(Confederation).get(id)
    if not conf:
        raise HTTPException(status_code=404, detail="Confederação não encontrada")
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    ext = os.path.splitext(file.filename or "logo.png")[1].lower()
    if ext not in (".png", ".jpg", ".jpeg", ".svg", ".webp"):
        raise HTTPException(status_code=400, detail="Formato inválido. Use PNG, JPG, SVG ou WebP.")
    filename = f"conf_{id}_{uuid.uuid4().hex}{ext}"
    path = os.path.join(UPLOAD_DIR, filename)
    with open(path, "wb") as f:
        shutil.copyfileobj(file.file, f)
    conf.logo_url = f"/uploads/logos/{filename}"
    db.commit()
    return {"logo_url": conf.logo_url}


@router.post("/{id}/upload-regulation")
async def upload_regulation(id: int, file: UploadFile = File(...), db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    conf = db.query(Confederation).get(id)
    if not conf:
        raise HTTPException(status_code=404, detail="Confederação não encontrada")
    reg_dir = "/app/uploads/regulations"
    os.makedirs(reg_dir, exist_ok=True)
    ext = os.path.splitext(file.filename or "regulamento.pdf")[1].lower()
    allowed = (".pdf", ".docx", ".doc", ".xlsx", ".xls", ".png", ".jpg", ".jpeg")
    if ext not in allowed:
        raise HTTPException(status_code=400, detail="Formato inválido.")
    filename = f"reg_{id}_{uuid.uuid4().hex}{ext}"
    path = os.path.join(reg_dir, filename)
    with open(path, "wb") as f:
        shutil.copyfileobj(file.file, f)
    conf.regulation_file_url = f"/uploads/regulations/{filename}"
    db.commit()
    log_action(db=db, action="UPLOAD_REGULATION", entity_type="Confederation", entity_id=id, user_id=current_user.id)
    return {"regulation_file_url": conf.regulation_file_url}


# --- Regras de rateio (matriz por cenário de competição, conforme regulamento) ---

@router.get("/{id}/distribution-rules", response_model=List[DistributionRuleOut])
def list_distribution_rules(id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return (
        db.query(DistributionRule)
        .filter(DistributionRule.confederation_id == id)
        .order_by(DistributionRule.order_index)
        .all()
    )


@router.post("/{id}/distribution-rules", response_model=DistributionRuleOut)
def create_distribution_rule(id: int, data: DistributionRuleCreate, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    rule = DistributionRule(confederation_id=id, updated_by_id=current_user.id, **data.model_dump())
    db.add(rule)
    db.commit()
    db.refresh(rule)
    log_action(db=db, action="CREATE_DISTRIBUTION_RULE", entity_type="Confederation", entity_id=id,
               new_values={"scenario": data.scenario_code}, user_id=current_user.id)
    return rule


@router.patch("/{id}/distribution-rules/{rule_id}", response_model=DistributionRuleOut)
def update_distribution_rule(id: int, rule_id: int, data: DistributionRuleUpdate, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    rule = db.query(DistributionRule).filter(
        DistributionRule.id == rule_id, DistributionRule.confederation_id == id
    ).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Regra de rateio não encontrada")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(rule, k, v)
    rule.updated_by_id = current_user.id
    db.commit()
    db.refresh(rule)
    log_action(db=db, action="UPDATE_DISTRIBUTION_RULE", entity_type="Confederation", entity_id=id,
               new_values=data.model_dump(exclude_none=True), user_id=current_user.id)
    return rule


@router.delete("/{id}/distribution-rules/{rule_id}")
def delete_distribution_rule(id: int, rule_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    rule = db.query(DistributionRule).filter(
        DistributionRule.id == rule_id, DistributionRule.confederation_id == id
    ).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Regra de rateio não encontrada")
    db.delete(rule)
    db.commit()
    return {"ok": True}


# ---------- Visão Geral: operadores com anotações específicas desta confederação ----------

from pydantic import BaseModel as _BM


class _OperatorNoteIn(_BM):
    notes: str | None = None
    extra_notes: str | None = None
    conclusion: str | None = None        # inadimplente|adimplente|consignacao|sem_obrigacao|endr
    conclusion_auto: bool = False        # True = voltar ao cálculo automático


@router.get("/{id}/operators-overview")
def operators_overview(id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Todos os agentes operadores (do cadastro central) + anotações específicas desta confederação."""
    from datetime import date as _date
    from ..models.operator import BettingOperator, ContactType, OperatorConfederationInfo, EndrAssociation

    conf = db.query(Confederation).get(id)
    if not conf:
        raise HTTPException(status_code=404, detail="Confederação não encontrada")
    if current_user.role == "confederation_viewer" and current_user.confederation_id != id:
        raise HTTPException(status_code=403, detail="Acesso negado")

    infos = {
        i.operator_id: i
        for i in db.query(OperatorConfederationInfo).filter(OperatorConfederationInfo.confederation_id == id).all()
    }
    today = _date.today()
    month_start = _date(today.year, today.month, 1)
    from ..services.status_service import effective_conclusions, get_endr_set
    effective = effective_conclusions(db, id, month_start)
    endr_ids = get_endr_set(db, month_start)

    out = []
    for op in db.query(BettingOperator).order_by(BettingOperator.company_name).all():
        emails = [c.value for c in op.contacts if c.type == ContactType.email and c.value]
        phones = [c.value for c in op.contacts if c.type in (ContactType.phone, ContactType.whatsapp) and c.value]
        for r in op.responsibles:
            if r.email:
                emails.append(r.email)
            if r.phone:
                phones.append(r.phone)
        out.append({
            "operator_id": op.id,
            "company_name": op.company_name,
            "fantasy_name": op.fantasy_name,
            "cnpj": op.cnpj,
            "status": op.status.value if hasattr(op.status, "value") else op.status,
            "authorization": op.authorization_number or op.mf_license_number,
            "email": emails[0] if emails else None,
            "phone": phones[0] if phones else None,
            "brands": [b.name for b in op.brands],
            "endr_current_month": op.id in endr_ids,
            "notes": (infos.get(op.id).notes if infos.get(op.id) else "") or "",
            "extra_notes": (infos.get(op.id).extra_notes if infos.get(op.id) else "") or "",
            "conclusion": effective.get(op.id, "inadimplente"),
            "conclusion_manual": bool(infos.get(op.id).conclusion_manual) if infos.get(op.id) else False,
        })
    return out


@router.put("/{id}/operators/{operator_id}/note")
def save_operator_note(
    id: int, operator_id: int, data: _OperatorNoteIn,
    db: Session = Depends(get_db), current_user: User = Depends(require_office),
):
    """Cria/atualiza a anotação específica desta confederação sobre o operador (upsert)."""
    from ..models.operator import OperatorConfederationInfo
    info = db.query(OperatorConfederationInfo).filter(
        OperatorConfederationInfo.confederation_id == id,
        OperatorConfederationInfo.operator_id == operator_id,
    ).first()
    if not info:
        info = OperatorConfederationInfo(confederation_id=id, operator_id=operator_id)
        db.add(info)
    changes = []
    if data.notes is not None:
        info.notes = data.notes
        changes.append("anotações")
    if data.extra_notes is not None:
        info.extra_notes = data.extra_notes
        changes.append("anotações adicionais")
    if data.conclusion_auto:
        info.conclusion = None
        info.conclusion_manual = False
        changes.append("conclusão: automática")
    elif data.conclusion is not None:
        from ..services.status_service import CONCLUSIONS
        if data.conclusion not in CONCLUSIONS:
            raise HTTPException(status_code=400, detail="Conclusão inválida")
        info.conclusion = data.conclusion
        info.conclusion_manual = True
        changes.append(f"conclusão: {data.conclusion} (manual)")
    info.updated_by_id = current_user.id
    db.commit()
    log_action(db=db, action="OPERATOR_CONF_NOTE", entity_type="BettingOperator", entity_id=operator_id,
               user_id=current_user.id, confederation_id=id,
               description="Relação operador×confederação: " + (", ".join(changes) or "sem alterações"))
    return {"ok": True}
