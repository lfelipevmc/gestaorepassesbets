from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
from typing import List, Optional
from datetime import date, timedelta

from ..database import get_db
from ..models.process import TrackedProcess
from ..models.user import User
from ..schemas import TrackedProcessOut
from ..core.auth import get_current_user

router = APIRouter(prefix="/api/processes", tags=["processes"])


@router.get("", response_model=List[TrackedProcessOut])
def list_processes(
    detection_date: Optional[date] = None,
    since: Optional[date] = None,
    uf: Optional[str] = None,
    has_lead: Optional[bool] = None,
    search: Optional[str] = Query(None),
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(TrackedProcess)
    if detection_date:
        q = q.filter(TrackedProcess.detection_date == detection_date)
    if since:
        q = q.filter(TrackedProcess.detection_date >= since)
    if uf:
        q = q.filter(TrackedProcess.uf == uf.upper())
    if has_lead is True:
        q = q.filter(TrackedProcess.lead_id.isnot(None))
    elif has_lead is False:
        q = q.filter(TrackedProcess.lead_id.is_(None))
    if search:
        like = f"%{search}%"
        q = q.filter(or_(
            TrackedProcess.numero_processo.ilike(like),
            TrackedProcess.orgao_entidade.ilike(like),
            TrackedProcess.natureza.ilike(like),
            TrackedProcess.relator.ilike(like),
        ))
    return q.order_by(TrackedProcess.detection_date.desc().nullslast(),
                      TrackedProcess.first_seen_at.desc()).offset(skip).limit(min(limit, 500)).all()


@router.get("/stats")
def process_stats(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    today = date.today()
    week_ago = today - timedelta(days=7)
    return {
        "total": db.query(TrackedProcess).count(),
        "hoje": db.query(TrackedProcess).filter(TrackedProcess.detection_date == today).count(),
        "ontem": db.query(TrackedProcess).filter(TrackedProcess.detection_date == today - timedelta(days=1)).count(),
        "semana": db.query(TrackedProcess).filter(TrackedProcess.detection_date >= week_ago).count(),
        "com_lead": db.query(TrackedProcess).filter(TrackedProcess.lead_id.isnot(None)).count(),
        "por_dia": [
            {"data": d.isoformat() if d else None, "qtd": n}
            for d, n in db.query(TrackedProcess.detection_date, func.count(TrackedProcess.id))
            .filter(TrackedProcess.detection_date >= week_ago)
            .group_by(TrackedProcess.detection_date)
            .order_by(TrackedProcess.detection_date.desc()).all()
        ],
    }
