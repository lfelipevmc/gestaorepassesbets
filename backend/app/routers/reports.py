from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from ..database import get_db
from ..models.user import User
from ..core.auth import get_current_user
from ..services.report_service import get_compliance_report, generate_excel_report
import io

router = APIRouter(prefix="/api/reports", tags=["reports"])


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
