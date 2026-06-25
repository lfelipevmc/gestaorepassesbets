from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime
from ..database import get_db
from ..models.payment import Payment, PaymentStatus
from ..models.user import User
from ..schemas.payment import PaymentOut, PaymentDeclareGGR, PaymentConfirm
from ..core.auth import get_current_user, require_office
from ..services.audit_service import log_action
from decimal import Decimal

router = APIRouter(prefix="/api/payments", tags=["payments"])

GGR_MULTIPLIER = Decimal("0.12") * Decimal("0.073")  # 12% × 7.3%


@router.get("/", response_model=List[PaymentOut])
def list_payments(
    cycle_id: Optional[int] = None,
    operator_id: Optional[int] = None,
    confederation_id: Optional[int] = None,
    status: Optional[PaymentStatus] = None,
    skip: int = 0, limit: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    q = db.query(Payment)
    if current_user.role == "confederation_viewer":
        q = q.filter(Payment.confederation_id == current_user.confederation_id)
    if cycle_id:
        q = q.filter(Payment.cycle_id == cycle_id)
    if operator_id:
        q = q.filter(Payment.operator_id == operator_id)
    if confederation_id:
        q = q.filter(Payment.confederation_id == confederation_id)
    if status:
        q = q.filter(Payment.status == status)
    return q.offset(skip).limit(limit).all()


@router.post("/{id}/declare-ggr", response_model=PaymentOut)
def declare_ggr(id: int, data: PaymentDeclareGGR, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    payment = db.query(Payment).get(id)
    if not payment:
        raise HTTPException(status_code=404, detail="Pagamento não encontrado")

    old = {"ggr_declared": str(payment.ggr_declared), "calculated_amount": str(payment.calculated_amount)}
    payment.ggr_declared = data.ggr_declared

    from ..models.confederation import Confederation
    conf = db.query(Confederation).get(payment.confederation_id)
    conf_pct = data.confederation_percentage or conf.ggr_percentage or Decimal("1")
    payment.calculated_amount = data.ggr_declared * GGR_MULTIPLIER * conf_pct

    if data.notes:
        payment.notes = data.notes
    db.commit()
    db.refresh(payment)
    log_action(db=db, action="DECLARE_GGR", entity_type="Payment", entity_id=id, old_values=old, new_values={"ggr_declared": str(data.ggr_declared)}, user_id=current_user.id)
    return payment


@router.post("/{id}/confirm", response_model=PaymentOut)
def confirm_payment(id: int, data: PaymentConfirm, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    payment = db.query(Payment).get(id)
    if not payment:
        raise HTTPException(status_code=404, detail="Pagamento não encontrado")

    old_status = payment.status
    payment.amount_paid = data.amount_paid
    payment.payment_date = data.payment_date
    payment.payment_confirmed_at = datetime.utcnow()
    payment.confirmed_by_id = current_user.id
    payment.status = PaymentStatus.paid
    if data.notes:
        payment.notes = (payment.notes or "") + f"\n{data.notes}"
    db.commit()
    db.refresh(payment)
    log_action(db=db, action="CONFIRM_PAYMENT", entity_type="Payment", entity_id=id, old_values={"status": str(old_status)}, new_values={"status": "paid", "amount_paid": str(data.amount_paid)}, user_id=current_user.id)
    return payment
