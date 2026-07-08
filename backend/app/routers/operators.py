from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks, UploadFile, File, Form
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime
from ..database import get_db
from ..models.operator import BettingOperator, OperatorContact, OperatorStatus, OperatorBrand, OperatorResponsible, ResponsibleRole, EndrAssociation
from ..models.user import User
from ..schemas.operator import OperatorCreate, OperatorUpdate, OperatorOut, ContactCreate, ContactOut, BrandCreate, BrandUpdate, BrandOut, EndrAssociationCreate, EndrAssociationOut, ContactSuggestionOut, ResponsibleCreate, ResponsibleUpdate, ResponsibleOut
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
    from sqlalchemy import func, or_
    q = db.query(BettingOperator)
    if status:
        q = q.filter(BettingOperator.status == status)
    if search:
        term = search.strip()
        conds = [
            BettingOperator.company_name.ilike(f"%{term}%"),
            BettingOperator.fantasy_name.ilike(f"%{term}%"),
            BettingOperator.cnpj.ilike(f"%{term}%"),
        ]
        # CNPJ digitado sem pontuação: compara contra o CNPJ sem máscara
        digits = "".join(ch for ch in term if ch.isdigit())
        if len(digits) >= 4:
            conds.append(func.regexp_replace(func.coalesce(BettingOperator.cnpj, ""), r"\D", "", "g").ilike(f"%{digits}%"))
        # Busca também pelo nome das marcas vinculadas
        brand_op_ids = db.query(OperatorBrand.operator_id).filter(OperatorBrand.name.ilike(f"%{term}%")).subquery()
        conds.append(BettingOperator.id.in_(brand_op_ids))
        q = q.filter(or_(*conds))
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


# --- Responsáveis (Legal / Financeiro / Jurídico) ---

@router.get("/{id}/responsibles", response_model=List[ResponsibleOut])
def list_responsibles(id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    op = db.query(BettingOperator).get(id)
    if not op:
        raise HTTPException(status_code=404, detail="Operador não encontrado")
    return op.responsibles


@router.post("/{id}/responsibles", response_model=ResponsibleOut)
def add_responsible(id: int, data: ResponsibleCreate, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    op = db.query(BettingOperator).get(id)
    if not op:
        raise HTTPException(status_code=404, detail="Operador não encontrado")
    resp = OperatorResponsible(operator_id=id, **data.model_dump())
    db.add(resp)
    db.commit()
    db.refresh(resp)
    log_action(db=db, action="ADD_RESPONSIBLE", entity_type="BettingOperator", entity_id=id, new_values=data.model_dump(), user_id=current_user.id)
    return resp


@router.patch("/{id}/responsibles/{resp_id}", response_model=ResponsibleOut)
def update_responsible(id: int, resp_id: int, data: ResponsibleUpdate, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    resp = db.query(OperatorResponsible).filter(OperatorResponsible.id == resp_id, OperatorResponsible.operator_id == id).first()
    if not resp:
        raise HTTPException(status_code=404, detail="Responsável não encontrado")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(resp, k, v)
    db.commit()
    db.refresh(resp)
    return resp


@router.delete("/{id}/responsibles/{resp_id}")
def delete_responsible(id: int, resp_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    resp = db.query(OperatorResponsible).filter(OperatorResponsible.id == resp_id, OperatorResponsible.operator_id == id).first()
    if not resp:
        raise HTTPException(status_code=404, detail="Responsável não encontrado")
    db.delete(resp)
    db.commit()
    log_action(db=db, action="DELETE_RESPONSIBLE", entity_type="BettingOperator", entity_id=id, user_id=current_user.id)
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
    """Inicia pesquisa de contatos para todos os operadores ativos (em segundo plano,
    com sessão de banco própria — a da requisição é encerrada ao responder)."""
    from ..services.contact_researcher import research_all_operators_bg
    background_tasks.add_task(research_all_operators_bg)
    return {"message": "Pesquisa de contatos iniciada para todos os operadores ativos"}


@router.post("/{id}/research-contacts")
def research_contacts(
    id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_office)
):
    """Pesquisa contatos do operador de forma síncrona (BrasilAPI/CNPJ, dedução por domínio,
    busca web e IA) e retorna quantas sugestões novas foram criadas."""
    op = db.query(BettingOperator).get(id)
    if not op:
        raise HTTPException(status_code=404, detail="Operador não encontrado")

    from ..services.contact_researcher import research_operator
    try:
        result = research_operator(db, id, current_user.id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro na pesquisa de contatos: {e}")
    return result


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


@router.get("/{id}/compliance-score")
def operator_compliance_score(
    id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Score de adimplência histórica do operador (0-100) baseado nos últimos 12 meses."""
    from ..models.payment import Payment, PaymentStatus
    from ..models.collection import CollectionCycle
    from datetime import date

    op = db.query(BettingOperator).get(id)
    if not op:
        raise HTTPException(404, "Operador não encontrado")

    payments = db.query(Payment).filter(Payment.operator_id == id).all()
    if not payments:
        return {"score": None, "label": "Sem histórico", "paid": 0, "total": 0, "breakdown": []}

    total = len(payments)
    paid = len([p for p in payments if p.status in (PaymentStatus.paid, PaymentStatus.report_pending)])
    overdue = len([p for p in payments if p.status == PaymentStatus.overdue])

    score = round((paid / total) * 100) if total else 0
    label = "Excelente" if score >= 90 else "Bom" if score >= 70 else "Regular" if score >= 40 else "Crítico"

    return {
        "score": score,
        "label": label,
        "paid": paid,
        "total": total,
        "overdue": overdue,
        "pending": total - paid - overdue,
    }


@router.get("/{id}/monthly-history")
def operator_monthly_history(
    id: int,
    months: int = 12,
    end: Optional[str] = None,   # "YYYY-MM" — fim da janela (navegação no histórico desde jan/2025)
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Histórico mês a mês do operador (janela navegável desde jan/2025)."""
    from ..models.payment import Payment, PaymentStatus, DirectPayment
    from ..models.collection import CollectionCycle
    from datetime import date

    op = db.query(BettingOperator).get(id)
    if not op:
        raise HTTPException(404, "Operador não encontrado")

    today = date.today()
    if end:
        try:
            y, m = end.split("-")
            today = date(int(y), int(m), 1)
        except Exception:
            pass
    # mapa cycle_id -> reference_month
    cycle_map = {c.id: c.reference_month for c in db.query(CollectionCycle).all()}

    payments = db.query(Payment).filter(Payment.operator_id == id).all()
    directs = db.query(DirectPayment).filter(DirectPayment.operator_id == id).all()

    # Constrói lista dos últimos N meses
    history = []
    for i in range(months - 1, -1, -1):
        m = today.month - i
        y = today.year
        while m <= 0:
            m += 12
            y -= 1
        ref = date(y, m, 1)
        label = ref.strftime("%m/%Y")

        # pagamentos de ciclo cujo mês de referência == ref
        month_payments = [p for p in payments if cycle_map.get(p.cycle_id) == ref]
        month_directs = [d for d in directs if d.reference_month == ref]

        received = sum(float(p.amount_paid or 0) for p in month_payments) + \
                   sum(float(d.amount_received or 0) for d in month_directs)

        # situação: paid se algum pago; overdue se algum vencido sem pagamento; pending; sem cobrança
        statuses = [p.status for p in month_payments]
        if any(s in (PaymentStatus.paid, PaymentStatus.report_pending) for s in statuses) or month_directs:
            situation = "paid"
        elif any(s == PaymentStatus.overdue for s in statuses):
            situation = "overdue"
        elif statuses:
            situation = "pending"
        else:
            situation = "none"

        history.append({
            "month": label,
            "ref": ref.isoformat(),
            "received": received,
            "situation": situation,
            "has_report": any(p.report_received for p in month_payments) or any(d.report_file_url for d in month_directs),
        })

    return {"history": history}


@router.get("/{id}/confederation-summary")
def operator_confederation_summary(id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Visão consolidada do relacionamento financeiro do operador com CADA confederação
    (substitui a visão por ciclo de cobrança): total recebido, último pagamento, relatório
    do último pagamento e situação atual (Conclusão)."""
    from ..models.confederation import Confederation
    from ..services.status_service import effective_conclusions, get_paid_map, LABELS_PT, month_start
    from datetime import date as _date

    op = db.query(BettingOperator).get(id)
    if not op:
        raise HTTPException(404, "Operador não encontrado")

    cur = _date.today().replace(day=1)
    out = []
    for conf in db.query(Confederation).order_by(Confederation.acronym).all():
        if current_user.role == "confederation_viewer" and current_user.confederation_id != conf.id:
            continue
        all_paid = get_paid_map(db, conf.id, None)   # todos os meses (total consolidado)
        pm = all_paid.get(id, {})
        conclusion = effective_conclusions(db, conf.id, cur).get(id, "inadimplente")
        out.append({
            "confederation_id": conf.id,
            "acronym": conf.acronym,
            "name": conf.name,
            "received_total": pm.get("total", 0.0),
            "last_payment_date": pm.get("last_date").isoformat() if pm.get("last_date") else None,
            "last_payment_amount": pm.get("last_amount"),
            "report_url": pm.get("report_url"),
            "status": conclusion,
            "status_label": LABELS_PT.get(conclusion),
        })
    return out


@router.get("/export/pdf")
def export_operators_pdf(
    status: Optional[OperatorStatus] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Exporta a relação de agentes operadores cadastrados em PDF."""
    from fastapi.responses import StreamingResponse
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib import colors
    from reportlab.lib.units import cm
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
    from reportlab.lib.styles import getSampleStyleSheet
    import io
    from datetime import datetime as _dt

    q = db.query(BettingOperator)
    if status:
        q = q.filter(BettingOperator.status == status)
    ops = q.order_by(BettingOperator.company_name).all()

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=landscape(A4), topMargin=1*cm, bottomMargin=1*cm, leftMargin=1*cm, rightMargin=1*cm)
    styles = getSampleStyleSheet()
    small = styles["BodyText"]; small.fontSize = 7; small.leading = 9

    el = [Paragraph("Agentes Operadores — Base Cadastral", styles["Title"]),
          Paragraph(f"{len(ops)} operadores · Gerado em {_dt.now().strftime('%d/%m/%Y %H:%M')}", styles["Normal"]),
          Spacer(1, 0.4*cm)]
    data = [["Razão Social", "Nome Fantasia", "CNPJ", "Autorização", "Status", "E-mail principal", "Marcas"]]
    for op in ops:
        emails = [c.value for c in op.contacts if c.type == ContactType.email and c.value]
        for r in op.responsibles:
            if r.email:
                emails.append(r.email)
        data.append([
            Paragraph(op.company_name or "—", small),
            Paragraph(op.fantasy_name or "—", small),
            op.cnpj or "—",
            op.authorization_number or op.mf_license_number or "—",
            (op.status.value if hasattr(op.status, "value") else str(op.status)),
            Paragraph(emails[0] if emails else "—", small),
            Paragraph(", ".join(b.name for b in op.brands) or "—", small),
        ])
    t = Table(data, colWidths=[6.5*cm, 4*cm, 3.4*cm, 2.4*cm, 1.8*cm, 5*cm, 4.6*cm], repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1e293b")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTSIZE", (0, 0), (-1, -1), 7),
        ("GRID", (0, 0), (-1, -1), 0.3, colors.grey),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f1f5f9")]),
    ]))
    el.append(t)
    doc.build(el)
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/pdf",
                             headers={"Content-Disposition": "attachment; filename=agentes_operadores.pdf"})
