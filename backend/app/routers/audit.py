from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from typing import Optional, List
from ..database import get_db
from ..models.audit import AuditLog
from ..models.user import User
from ..core.auth import get_current_user, require_office
from pydantic import BaseModel
from datetime import datetime, date
import io

router = APIRouter(prefix="/api/audit", tags=["audit"])


class AuditOut(BaseModel):
    id: int
    user_id: Optional[int]
    action: str
    entity_type: Optional[str]
    entity_id: Optional[int]
    confederation_id: Optional[int] = None
    old_values: Optional[dict]
    new_values: Optional[dict]
    description: Optional[str]
    ip_address: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


def _apply_filters(q, action, entity_type, entity_id, user_id, date_from, date_to, confederation_id=None):
    if action:
        q = q.filter(AuditLog.action.ilike(f"%{action}%"))
    if entity_type:
        q = q.filter(AuditLog.entity_type == entity_type)
    if entity_id:
        q = q.filter(AuditLog.entity_id == entity_id)
    if user_id:
        q = q.filter(AuditLog.user_id == user_id)
    if confederation_id:
        # ação vinculada ao cliente OU ação registrada diretamente sobre o registro da confederação
        q = q.filter(
            (AuditLog.confederation_id == confederation_id)
            | ((AuditLog.entity_type == "Confederation") & (AuditLog.entity_id == confederation_id))
        )
    if date_from:
        q = q.filter(AuditLog.created_at >= datetime.combine(date_from, datetime.min.time()))
    if date_to:
        q = q.filter(AuditLog.created_at <= datetime.combine(date_to, datetime.max.time()))
    return q


@router.get("/", response_model=List[AuditOut])
def list_audit_logs(
    action: Optional[str] = None,
    entity_type: Optional[str] = None,
    entity_id: Optional[int] = None,
    user_id: Optional[int] = None,
    confederation_id: Optional[int] = None,
    date_from: Optional[date] = Query(None, description="Data inicial (YYYY-MM-DD)"),
    date_to: Optional[date] = Query(None, description="Data final (YYYY-MM-DD)"),
    skip: int = 0,
    limit: int = 200,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_office)
):
    q = _apply_filters(db.query(AuditLog), action, entity_type, entity_id, user_id, date_from, date_to, confederation_id)
    return q.order_by(AuditLog.created_at.desc()).offset(skip).limit(limit).all()


@router.get("/actions")
def distinct_actions(db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    """Lista de ações distintas para preencher o filtro."""
    rows = db.query(AuditLog.action).distinct().order_by(AuditLog.action).all()
    return [r[0] for r in rows]


@router.get("/pdf")
def export_audit_pdf(
    action: Optional[str] = None,
    entity_type: Optional[str] = None,
    entity_id: Optional[int] = None,
    user_id: Optional[int] = None,
    confederation_id: Optional[int] = None,
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_office),
):
    """Exporta o relatório de auditoria filtrado em PDF."""
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib import colors
    from reportlab.lib.units import cm
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
    from reportlab.lib.styles import getSampleStyleSheet

    q = _apply_filters(db.query(AuditLog), action, entity_type, entity_id, user_id, date_from, date_to, confederation_id)
    logs = q.order_by(AuditLog.created_at.desc()).limit(2000).all()
    users = {u.id: u.name for u in db.query(User).all()}

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=landscape(A4), topMargin=1*cm, bottomMargin=1*cm, leftMargin=1*cm, rightMargin=1*cm)
    styles = getSampleStyleSheet()
    small = styles["BodyText"]; small.fontSize = 7; small.leading = 9

    elements = [Paragraph("Relatório de Auditoria", styles["Title"])]
    filtros = []
    if action: filtros.append(f"Ação: {action}")
    if entity_type: filtros.append(f"Entidade: {entity_type}" + (f" #{entity_id}" if entity_id else ""))
    if user_id: filtros.append(f"Usuário: {users.get(user_id, user_id)}")
    if date_from: filtros.append(f"De: {date_from.strftime('%d/%m/%Y')}")
    if date_to: filtros.append(f"Até: {date_to.strftime('%d/%m/%Y')}")
    elements.append(Paragraph("Filtros: " + (" · ".join(filtros) if filtros else "nenhum") +
                              f" — Gerado em {datetime.now().strftime('%d/%m/%Y %H:%M')}", styles["Normal"]))
    elements.append(Spacer(1, 0.4*cm))

    data = [["Data/Hora", "Usuário", "Ação", "Entidade", "ID", "Descrição"]]
    for lg in logs:
        data.append([
            lg.created_at.strftime("%d/%m/%Y %H:%M") if lg.created_at else "",
            users.get(lg.user_id, "—") if lg.user_id else "—",
            lg.action or "",
            lg.entity_type or "—",
            str(lg.entity_id) if lg.entity_id else "—",
            Paragraph((lg.description or "")[:200], small),
        ])
    table = Table(data, colWidths=[3*cm, 3.5*cm, 4*cm, 3*cm, 1.2*cm, 11*cm], repeatRows=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1e293b")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTSIZE", (0, 0), (-1, -1), 7),
        ("GRID", (0, 0), (-1, -1), 0.3, colors.grey),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f1f5f9")]),
    ]))
    elements.append(table)
    doc.build(elements)
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/pdf",
                             headers={"Content-Disposition": "attachment; filename=auditoria.pdf"})
