from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from typing import Optional
from datetime import date
from ..database import get_db
from ..models.user import User
from ..models.payment import PaymentStatus
from ..core.auth import get_current_user
from ..services.report_service import (
    get_compliance_report, generate_excel_report, get_cross_report, generate_cross_excel, generate_cross_pdf
)
import io

router = APIRouter(prefix="/api/reports", tags=["reports"])


@router.get("/cross")
def cross_report(
    confederation_id: Optional[int] = None,
    month: Optional[date] = Query(None, description="Mês de referência do ciclo (YYYY-MM-01)"),
    operator_id: Optional[int] = None,
    status: Optional[PaymentStatus] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Relatório individualizado e cruzado por confederação, mês e Bet (filtros combináveis)."""
    if current_user.role == "confederation_viewer":
        confederation_id = current_user.confederation_id
    return get_cross_report(db, confederation_id, month, operator_id, status)


@router.get("/cross/excel")
def cross_report_excel(
    confederation_id: Optional[int] = None,
    month: Optional[date] = Query(None),
    operator_id: Optional[int] = None,
    status: Optional[PaymentStatus] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role == "confederation_viewer":
        confederation_id = current_user.confederation_id
    data = generate_cross_excel(db, confederation_id, month, operator_id, status)
    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=relatorio_consolidado.xlsx"},
    )


@router.get("/cross/pdf")
def cross_report_pdf(
    confederation_id: Optional[int] = None,
    month: Optional[date] = Query(None),
    operator_id: Optional[int] = None,
    status: Optional[PaymentStatus] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role == "confederation_viewer":
        confederation_id = current_user.confederation_id
    data = generate_cross_pdf(db, confederation_id, month, operator_id, status)
    return StreamingResponse(
        io.BytesIO(data), media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=relatorio_consolidado.pdf"},
    )


@router.get("/evidence/pdf")
def evidence_report_pdf(
    month: date = Query(..., description="Mês de competência (YYYY-MM-01)"),
    confederation_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Relatório de Evidências Mensal (ISO 9001): dossiê consolidado do mês para auditoria."""
    from ..services.evidence_report import generate_evidence_pdf
    if current_user.role == "confederation_viewer":
        confederation_id = current_user.confederation_id
    data = generate_evidence_pdf(db, month, confederation_id)
    fname = f"evidencias_{month.strftime('%Y_%m')}.pdf"
    return StreamingResponse(
        io.BytesIO(data), media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={fname}"},
    )


@router.post("/monthly/send-to-office")
def send_monthly_to_office(
    month: date = Query(..., description="Mês de competência (YYYY-MM-01)"),
    confederation_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Gera o dossiê de evidências do mês e envia ao e-mail do escritório para revisão
    antes do encaminhamento à confederação."""
    import base64
    from ..services.evidence_report import generate_evidence_pdf
    from ..services.email_service import send_email
    from ..models.office import OfficeSettings
    from ..models.confederation import Confederation as _Conf

    pdf = generate_evidence_pdf(db, month, confederation_id)
    office = db.query(OfficeSettings).first()
    to_addr = office.email if office and office.email else None
    if not to_addr:
        raise HTTPException(status_code=400, detail="Cadastre o e-mail do escritório na aba Escritório para receber o relatório.")

    conf_label = "todas as confederações"
    if confederation_id:
        c = db.query(_Conf).get(confederation_id)
        conf_label = c.acronym if c else conf_label

    fname = f"evidencias_{month.strftime('%Y_%m')}.pdf"
    body = (
        f"Prezados,\n\nSegue em anexo o relatório de evidências da competência {month.strftime('%m/%Y')} "
        f"({conf_label}), gerado automaticamente para revisão interna antes do encaminhamento à confederação.\n\n"
        f"Este e-mail foi enviado pelo sistema de Gestão de Haveres de Bets."
    )
    ok = send_email(
        to=[to_addr],
        subject=f"[Revisão] Relatório de Evidências {month.strftime('%m/%Y')} — {conf_label}",
        body=body,
        attachments=[{"filename": fname, "content_bytes": base64.b64encode(pdf).decode(), "content_type": "application/pdf"}],
    )
    if not ok:
        raise HTTPException(status_code=502, detail="Não foi possível enviar o e-mail (verifique a integração M365 no .env).")
    from ..services.audit_service import log_action
    log_action(db=db, action="SEND_MONTHLY_REPORT", entity_type="Report", user_id=current_user.id,
               confederation_id=confederation_id, description=f"Relatório de {month.strftime('%m/%Y')} enviado ao escritório ({to_addr})")
    return {"ok": True, "sent_to": to_addr}


@router.get("/compliance/{cycle_id}")
def compliance_report(cycle_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    report = get_compliance_report(db, cycle_id)
    if not report:
        raise HTTPException(status_code=404, detail="Ciclo não encontrado")
    if current_user.role == "confederation_viewer" and report["confederation"]["id"] != current_user.confederation_id:
        raise HTTPException(status_code=403, detail="Acesso negado")
    return report


@router.get("/compliance/{cycle_id}/excel")
def compliance_report_excel(cycle_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    data = generate_excel_report(db, cycle_id)
    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=relatorio_ciclo_{cycle_id}.xlsx"}
    )
