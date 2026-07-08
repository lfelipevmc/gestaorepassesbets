from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
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


# ============================================================================
# RELATÓRIOS POR CONFEDERAÇÃO (item 13)
# Visão separada por confederação — cada Bet aparece uma única vez — com
# upload do arquivo de relatório enviado pela Bet (um por confederação paga).
# ============================================================================

@router.get("/by-confederation")
def report_by_confederation(
    confederation_id: int,
    month: date = Query(..., description="Competência (YYYY-MM-01)"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Relatório mensal de uma confederação: cada Bet aparece uma única vez, com a
    conclusão efetiva, valores recebidos na competência e o relatório enviado."""
    if current_user.role == "confederation_viewer" and current_user.confederation_id != confederation_id:
        raise HTTPException(status_code=403, detail="Acesso negado")
    from ..models.operator import BettingOperator, OperatorStatus
    from ..services.status_service import effective_conclusions, get_paid_map, LABELS_PT

    conclusions = effective_conclusions(db, confederation_id, month)
    paid = get_paid_map(db, confederation_id, month)
    ops = db.query(BettingOperator).filter(BettingOperator.status == OperatorStatus.active).order_by(BettingOperator.company_name).all()

    rows, counts = [], {}
    total_received = 0.0
    for op in ops:
        conc = conclusions.get(op.id, "inadimplente")
        counts[conc] = counts.get(conc, 0) + 1
        p = paid.get(op.id) or {}
        total_received += float(p.get("total") or 0)
        rows.append({
            "operator_id": op.id,
            "company_name": op.company_name,
            "fantasy_name": op.fantasy_name,
            "cnpj": op.cnpj,
            "conclusion": conc,
            "conclusion_label": LABELS_PT.get(conc, conc),
            "received_total": float(p.get("total") or 0),
            "last_payment_date": p.get("last_date").isoformat() if p.get("last_date") else None,
            "report_url": p.get("report_url"),
        })
    return {
        "confederation_id": confederation_id,
        "month": month.isoformat(),
        "rows": rows,
        "counts": counts,
        "total_operators": len(ops),
        "total_received": total_received,
        "reports_received": sum(1 for r in rows if r["report_url"]),
    }


@router.post("/bet-report/{operator_id}/{confederation_id}")
async def upload_bet_report(
    operator_id: int,
    confederation_id: int,
    month: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Upload do relatório enviado pela Bet para uma confederação numa competência.
    Anexa ao lançamento (DirectPayment) do mês, se houver, e registra como Documento."""
    import os, shutil, uuid
    from ..models.payment import DirectPayment
    from ..models.document import Document, DocumentType
    from ..models.operator import BettingOperator
    from ..services.audit_service import log_action

    op = db.query(BettingOperator).get(operator_id)
    if not op:
        raise HTTPException(status_code=404, detail="Operador não encontrado")
    ref = date.fromisoformat(month[:7] + "-01")

    updir = "/app/uploads/reports"
    os.makedirs(updir, exist_ok=True)
    ext = os.path.splitext(file.filename or "relatorio.pdf")[1].lower()
    filename = f"betrep_{operator_id}_{confederation_id}_{uuid.uuid4().hex}{ext}"
    path = os.path.join(updir, filename)
    with open(path, "wb") as f:
        shutil.copyfileobj(file.file, f)
    url = f"/uploads/reports/{filename}"

    # Anexa ao lançamento da competência, se existir (para aparecer no histórico consolidado)
    dp = (db.query(DirectPayment)
          .filter(DirectPayment.operator_id == operator_id,
                  DirectPayment.confederation_id == confederation_id,
                  DirectPayment.reference_month == ref)
          .order_by(DirectPayment.received_date.desc())
          .first())
    if dp:
        dp.report_file_url = url

    doc = Document(
        operator_id=operator_id,
        confederation_id=confederation_id,
        title=f"Relatório {op.fantasy_name or op.company_name} — {ref.strftime('%m/%Y')}",
        document_type=DocumentType.report,
        file_path=url,
        file_name=file.filename or filename,
        file_size=os.path.getsize(path),
        reference_month=ref,
        uploaded_by_id=current_user.id,
    )
    db.add(doc)
    db.commit()
    log_action(db=db, action="UPLOAD_BET_REPORT", entity_type="Document", entity_id=doc.id,
               user_id=current_user.id, confederation_id=confederation_id,
               description=f"Relatório da Bet #{operator_id} — competência {ref.strftime('%m/%Y')}")
    return {"report_file_url": url, "attached_to_payment": bool(dp), "document_id": doc.id}
