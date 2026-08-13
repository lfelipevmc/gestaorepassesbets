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


# ─────────────────────────────────────────────────────────────────────────────
# APRESENTAÇÃO DE MONITORAMENTO (aba 📽 Apresentação)
# Consolidação read-only da BASE CENTRAL para as reuniões com cada confederação:
# resultados, trabalho desenvolvido, recebimentos (direto × ENDR), pendências e
# próximos passos. Nenhum dado é redigitado — tudo vem da fonte única.
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/{id}/presentation")
def confederation_presentation(id: int, month: str = None, db: Session = Depends(get_db),
                               current_user: User = Depends(get_current_user)):
    from datetime import date as _date, timedelta as _td
    from calendar import monthrange
    from ..models.payment import Payment, DirectPayment, ENDRPayment
    from ..models.collection import CollectionCycle, CollectionEvent, CycleStatus
    from ..models.operator import BettingOperator
    from ..models.messaging import EmailMessage, EmailDirection
    from ..models.document import Document, DocumentCategory, DocumentType
    from ..services.status_service import effective_conclusions, get_paid_map, get_endr_set, LABELS_PT

    conf = db.query(Confederation).get(id)
    if not conf:
        raise HTTPException(status_code=404, detail="Confederação não encontrada")
    if current_user.role == "confederation_viewer" and current_user.confederation_id != id:
        raise HTTPException(status_code=403, detail="Acesso negado")

    today = _date.today()
    try:
        ref = _date.fromisoformat(month) if month else today.replace(day=1)
    except ValueError:
        ref = today.replace(day=1)
    ref = ref.replace(day=1)

    cycles = db.query(CollectionCycle).filter(CollectionCycle.confederation_id == id).all()
    cycle_ids = [c.id for c in cycles]
    cycle_by_month = {c.reference_month: c for c in cycles}
    ops = {o.id: o for o in db.query(BettingOperator).all()}

    def op_label(i):
        o = ops.get(i)
        return (o.fantasy_name or o.company_name) if o else f"#{i}"

    # ---- séries e acumulados -------------------------------------------------
    directs = db.query(DirectPayment).filter(DirectPayment.confederation_id == id).all()
    legacy = db.query(Payment).filter(Payment.confederation_id == id,
                                      Payment.amount_paid.isnot(None), Payment.amount_paid > 0).all()
    endrs = db.query(ENDRPayment).filter(ENDRPayment.confederation_id == id).all()

    def _mkey(d):
        return d.strftime("%Y-%m") if d else None

    per_month = {}
    for d in directs:
        k = _mkey(d.reference_month) or _mkey(d.received_date)
        if k:
            per_month.setdefault(k, [0.0, 0.0])[0] += float(d.amount_received or 0)
    for p in legacy:
        cy = next((c for c in cycles if c.id == p.cycle_id), None)
        k = _mkey(cy.reference_month) if cy else None
        if k:
            per_month.setdefault(k, [0.0, 0.0])[0] += float(p.amount_paid or 0)
    for e in endrs:
        k = _mkey(e.reference_month) or _mkey(e.received_date)
        if k:
            per_month.setdefault(k, [0.0, 0.0])[1] += float(e.amount_received or 0)

    MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"]
    monthly = []
    y, m = ref.year, ref.month
    keys = []
    for _ in range(12):
        keys.append(f"{y:04d}-{m:02d}")
        m -= 1
        if m == 0:
            m, y = 12, y - 1
    for k in reversed(keys):
        vy, vm = int(k[:4]), int(k[5:])
        vals = per_month.get(k, [0.0, 0.0])
        monthly.append({"month": k, "label": f"{MESES[vm-1]}/{str(vy)[2:]}",
                        "direto": round(vals[0], 2), "endr": round(vals[1], 2)})

    acumulado_direto = sum(v[0] for v in per_month.values())
    acumulado_endr = sum(v[1] for v in per_month.values())
    mes_vals = per_month.get(ref.strftime("%Y-%m"), [0.0, 0.0])

    # ---- conclusões / adimplência do mês ------------------------------------
    conclusions = effective_conclusions(db, id, ref)
    counts = {"adimplente": 0, "inadimplente": 0, "endr": 0, "consignacao": 0, "sem_obrigacao": 0}
    for v in conclusions.values():
        counts[v] = counts.get(v, 0) + 1
    bets_total = len(conclusions)
    em_conformidade = bets_total - counts["inadimplente"]

    # ---- recebimentos do mês (linhas) ---------------------------------------
    paid_map = get_paid_map(db, id, ref)
    recebimentos = []
    for op_id, pm in sorted(paid_map.items(), key=lambda kv: -(kv[1].get("total") or 0)):
        if (pm.get("total") or 0) <= 0:
            continue
        recebimentos.append({
            "operator_id": op_id, "label": op_label(op_id),
            "total": round(pm["total"], 2),
            "last_date": pm.get("last_date").isoformat() if pm.get("last_date") else None,
            "report_url": pm.get("report_url"),
        })

    # ---- trabalho desenvolvido ----------------------------------------------
    out_q = db.query(EmailMessage).filter(EmailMessage.direction == EmailDirection.outbound)
    in_q = db.query(EmailMessage).filter(EmailMessage.direction == EmailDirection.inbound)
    if cycle_ids:
        out_q = out_q.filter((EmailMessage.cycle_id.in_(cycle_ids)) | (EmailMessage.confederation_id == id))
        in_q = in_q.filter((EmailMessage.cycle_id.in_(cycle_ids)) | (EmailMessage.confederation_id == id))
    else:
        out_q = out_q.filter(EmailMessage.confederation_id == id)
        in_q = in_q.filter(EmailMessage.confederation_id == id)
    outbound = out_q.all()
    inbound = in_q.all()
    nxt = _date(ref.year + 1, 1, 1) if ref.month == 12 else _date(ref.year, ref.month + 1, 1)

    def in_ref(dt):
        return dt and ref <= dt.date() < nxt

    oficios_spa = (db.query(Document)
                   .filter(Document.confederation_id == id, Document.category == DocumentCategory.minuta)
                   .count())
    relatorios = (db.query(Document)
                  .filter(Document.confederation_id == id, Document.document_type == DocumentType.ggr_report)
                  .count())

    ev_q = db.query(CollectionEvent).filter(CollectionEvent.cycle_id.in_(cycle_ids)) if cycle_ids else None
    timeline = []
    if ev_q is not None:
        for ev in ev_q.order_by(CollectionEvent.performed_at.desc()).limit(14).all():
            timeline.append({
                "date": ev.performed_at.isoformat() if ev.performed_at else None,
                "type": ev.event_type.value if hasattr(ev.event_type, "value") else str(ev.event_type),
                "operator": op_label(ev.operator_id) if ev.operator_id else None,
                "notes": (ev.notes or "")[:160],
            })

    # ---- bloco ENDR ----------------------------------------------------------
    endr_assoc = get_endr_set(db, ref)
    endr_last = []
    for e in sorted(endrs, key=lambda x: (x.received_date or _date.min), reverse=True)[:6]:
        comp = e.reference_month.strftime("%m/%Y") if e.reference_month else None
        if e.reference_month and getattr(e, "reference_month_end", None):
            comp = f"{comp} – {e.reference_month_end.strftime('%m/%Y')}"
        endr_last.append({
            "received_date": e.received_date.isoformat() if e.received_date else None,
            "amount": float(e.amount_received or 0),
            "competencia": comp or "a definir",
            "bets": len(e.bet_links),
            "report_url": e.report_file_url,
        })
    endr_pend_rel = len([e for e in endrs if not e.report_file_url])

    # ---- pendências (inadimplentes do mês) ----------------------------------
    cycle_ref = cycle_by_month.get(ref)
    due_by_op = {}
    if cycle_ref:
        for p in db.query(Payment).filter(Payment.cycle_id == cycle_ref.id).all():
            if p.amount_due:
                due_by_op[p.operator_id] = float(p.amount_due)
    pendencias = []
    for op_id, concl in conclusions.items():
        if concl != "inadimplente":
            continue
        from datetime import datetime as _dtm
        my_out = [m2 for m2 in outbound if m2.operator_id == op_id]
        last_out = max(my_out, key=lambda m2: m2.sent_at or _dtm.min, default=None) if my_out else None
        replied = False
        replied_at = None
        if last_out and last_out.sent_at:
            for m2 in inbound:
                if m2.operator_id == op_id and m2.received_at and m2.received_at >= last_out.sent_at:
                    replied = True
                    if not replied_at or m2.received_at.isoformat() < replied_at:
                        replied_at = m2.received_at.isoformat()
        o = ops.get(op_id)
        pendencias.append({
            "operator_id": op_id, "label": op_label(op_id),
            "cnpj": o.cnpj if o else None,
            "amount_due": due_by_op.get(op_id),
            "notif_count": len(my_out),
            "last_notification_at": last_out.sent_at.isoformat() if last_out and last_out.sent_at else None,
            "replied": replied, "replied_at": replied_at,
        })
    pendencias.sort(key=lambda r: (-(r["notif_count"]), r["label"]))

    # ---- próximos passos -----------------------------------------------------
    cronograma = []
    active = [c for c in cycles if c.status in (CycleStatus.open, CycleStatus.collecting)]
    cyc = None
    if active:
        cyc = max(active, key=lambda c: c.reference_month)
    if cyc:
        base = cyc.reference_month
        last_day = monthrange(base.year, base.month)[1]

        def _d(day):
            return _date(base.year, base.month, min(day, last_day))

        d1 = conf.first_notification_day or 12
        d2 = conf.second_notification_day or 22
        cronograma.append({"label": f"1ª notificação ({cyc.reference_month.strftime('%m/%Y')})",
                           "due": _d(d1).isoformat(), "done": any(in_ref(m2.sent_at) for m2 in outbound)})
        cronograma.append({"label": "2ª notificação (inadimplentes)", "due": _d(d2).isoformat(),
                           "done": False})
        cronograma.append({"label": "Ofício à SPA (persistindo inadimplência)",
                           "due": _d(min(d2 + 4, 28)).isoformat(), "done": False})
        cronograma.append({"label": "Relatório de Atividades do mês",
                           "due": _d(last_day).isoformat(), "done": False})

    return {
        "confederation": {"id": conf.id, "name": conf.name, "acronym": conf.acronym, "logo_url": conf.logo_url},
        "month": ref.isoformat(), "month_label": ref.strftime("%m/%Y"),
        "generated_at": today.isoformat(),
        "summary": {
            "total_acumulado": round(acumulado_direto + acumulado_endr, 2),
            "acumulado_direto": round(acumulado_direto, 2),
            "acumulado_endr": round(acumulado_endr, 2),
            "recebido_mes": round(mes_vals[0] + mes_vals[1], 2),
            "recebido_mes_direto": round(mes_vals[0], 2),
            "recebido_mes_endr": round(mes_vals[1], 2),
            "bets_total": bets_total,
            "counts": counts,
            "labels": LABELS_PT,
            "em_conformidade": em_conformidade,
            "taxa_conformidade": round(em_conformidade / bets_total * 100, 1) if bets_total else 0,
        },
        "trabalho": {
            "notificacoes_total": len(outbound),
            "notificacoes_mes": len([m2 for m2 in outbound if in_ref(m2.sent_at)]),
            "respostas_total": len(inbound),
            "respostas_mes": len([m2 for m2 in inbound if in_ref(m2.received_at)]),
            "oficios_spa": oficios_spa,
            "relatorios_anexados": relatorios,
            "timeline": timeline,
        },
        "monthly": monthly,
        "recebimentos_mes": recebimentos,
        "endr": {
            "total": round(acumulado_endr, 2),
            "count": len(endrs),
            "associadas_mes": len([i for i in endr_assoc if i in conclusions]),
            "pendentes_relatorio": endr_pend_rel,
            "ultimos": endr_last,
        },
        "pendencias": pendencias,
        "proximos": {
            "cronograma": cronograma,
            "next_steps": conf.next_steps or "",
        },
    }


@router.get("/{id}/presentation/pdf")
def confederation_presentation_pdf(id: int, month: str = None, logo_office: int = 1, logo_conf: int = 1,
                                   db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Relatório de Monitoramento em PDF — espelho da aba Apresentação."""
    from fastapi.responses import StreamingResponse
    from ..services.presentation_service import generate_presentation_pdf
    import io as _io
    data = confederation_presentation(id, month=month, db=db, current_user=current_user)
    pdf = generate_presentation_pdf(db, data, logo_office=bool(logo_office), logo_conf=bool(logo_conf))
    fname = f"monitoramento_{data['confederation']['acronym']}_{data['month'][:7].replace('-', '_')}.pdf"
    return StreamingResponse(_io.BytesIO(pdf), media_type="application/pdf",
                             headers={"Content-Disposition": f"attachment; filename={fname}"})
