from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from ..database import get_db
from ..models.collection import CollectionCycle, CollectionEvent, CycleStatus
from ..models.operator import BettingOperator, OperatorStatus
from ..models.payment import Payment, PaymentStatus
from ..models.user import User
from ..schemas.collection import CycleCreate, CycleOut, EventCreate, EventOut
from ..core.auth import get_current_user, require_office
from ..services.audit_service import log_action
from ..services.notification_service import send_collection_notification

router = APIRouter(prefix="/api/collections", tags=["collections"])


@router.get("/", response_model=List[CycleOut])
def list_cycles(confederation_id: Optional[int] = None, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    q = db.query(CollectionCycle)
    if current_user.role == "confederation_viewer":
        q = q.filter(CollectionCycle.confederation_id == current_user.confederation_id)
    elif confederation_id:
        q = q.filter(CollectionCycle.confederation_id == confederation_id)
    return q.order_by(CollectionCycle.reference_month.desc()).all()


@router.post("/", response_model=CycleOut)
def create_cycle(data: CycleCreate, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    existing = db.query(CollectionCycle).filter(
        CollectionCycle.confederation_id == data.confederation_id,
        CollectionCycle.reference_month == data.reference_month
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Ciclo já existe para esse mês e confederação")

    cycle = CollectionCycle(confederation_id=data.confederation_id, reference_month=data.reference_month)
    db.add(cycle)
    db.flush()

    operators = db.query(BettingOperator).filter(BettingOperator.status == OperatorStatus.active).all()
    for op in operators:
        db.add(Payment(cycle_id=cycle.id, operator_id=op.id, confederation_id=data.confederation_id, status=PaymentStatus.pending))

    db.commit()
    db.refresh(cycle)
    log_action(db=db, action="CREATE", entity_type="CollectionCycle", entity_id=cycle.id, user_id=current_user.id)
    return cycle


@router.get("/{id}", response_model=CycleOut)
def get_cycle(id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    cycle = db.query(CollectionCycle).get(id)
    if not cycle:
        raise HTTPException(status_code=404, detail="Ciclo não encontrado")
    return cycle


@router.get("/{id}/events", response_model=List[EventOut])
def list_events(id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(CollectionEvent).filter(CollectionEvent.cycle_id == id).order_by(CollectionEvent.performed_at.desc()).all()


@router.post("/{id}/events", response_model=EventOut)
def add_event(id: int, data: EventCreate, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    cycle = db.query(CollectionCycle).get(id)
    if not cycle:
        raise HTTPException(status_code=404, detail="Ciclo não encontrado")
    event = CollectionEvent(cycle_id=id, performed_by_id=current_user.id, **data.model_dump())
    db.add(event)
    db.commit()
    db.refresh(event)
    log_action(db=db, action="ADD_EVENT", entity_type="CollectionCycle", entity_id=id, user_id=current_user.id)
    return event


@router.post("/{id}/send-notifications")
def send_notifications(id: int, notification_number: int = 1, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    from ..models.confederation import Confederation
    cycle = db.query(CollectionCycle).get(id)
    if not cycle:
        raise HTTPException(status_code=404, detail="Ciclo não encontrado")
    confederation = db.query(Confederation).get(cycle.confederation_id)

    pending = db.query(Payment).filter(
        Payment.cycle_id == id,
        Payment.status.in_([PaymentStatus.pending, PaymentStatus.overdue])
    ).all()

    from ..services.scheduler import is_endr_associated
    from ..models.collection import CollectionEvent, EventType, EventChannel

    sent = 0
    failed = 0
    skipped_endr = 0
    for payment in pending:
        op = db.query(BettingOperator).get(payment.operator_id)
        if is_endr_associated(db, op.id, cycle.reference_month):
            event = CollectionEvent(
                cycle_id=id,
                operator_id=op.id,
                event_type=EventType.manual_note,
                channel=EventChannel.system,
                notes="Operador associado ao ENDR — cobrança suspensa neste mês",
                performed_by_id=current_user.id,
            )
            db.add(event)
            db.commit()
            skipped_endr += 1
            continue
        success = send_collection_notification(
            db=db, cycle_id=id, operator=op, confederation=confederation,
            reference_month=cycle.reference_month.strftime("%m/%Y"),
            notification_number=notification_number,
            performed_by_id=current_user.id,
            calculated_amount=float(payment.amount_due) if payment.amount_due else None
        )
        if success:
            sent += 1
        else:
            failed += 1

    return {"sent": sent, "failed": failed, "skipped_endr": skipped_endr, "total": len(pending)}
