from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime, date
import os, shutil, uuid
from ..database import get_db
from ..models.payment import Payment, PaymentStatus, ENDRPayment, ENDRPaymentBetLink
from ..models.user import User
from ..schemas.payment import PaymentOut, PaymentDeclareValue, PaymentConfirm, PaymentRegisterReport, ENDRPaymentOut, ENDRPaymentCreate
from ..core.auth import get_current_user, require_office
from ..services.audit_service import log_action

router = APIRouter(prefix="/api/payments", tags=["payments"])

# NOTA: o escritório NÃO calcula o valor da contrapartida. A apuração é exclusiva do agente
# operador (CBT/CBTM Art. 4º e 8º §2º; CBW Art. 10 §único). Apenas registramos o valor informado.
REPORT_UPLOAD_DIR = "/app/uploads/reports"


@router.get("/", response_model=List[PaymentOut])
def list_payments(
    cycle_id: Optional[int] = None,
    operator_id: Optional[int] = None,
    confederation_id: Optional[int] = None,
    status: Optional[PaymentStatus] = None,
    month: Optional[date] = Query(None, description="Filtro por mês de referência do ciclo (YYYY-MM-DD)"),
    skip: int = 0, limit: int = 200,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    from ..models.collection import CollectionCycle
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
    if month:
        q = q.join(CollectionCycle, Payment.cycle_id == CollectionCycle.id).filter(
            CollectionCycle.reference_month == month
        )
    return q.offset(skip).limit(limit).all()


@router.post("/{id}/declare-value", response_model=PaymentOut)
def declare_value(id: int, data: PaymentDeclareValue, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    """Registra o valor devido apurado pelo agente operador (informado no relatório).
    O escritório não calcula este valor — apenas o registra conforme informado pela operadora."""
    payment = db.query(Payment).get(id)
    if not payment:
        raise HTTPException(status_code=404, detail="Pagamento não encontrado")

    old = {"amount_due": str(payment.amount_due), "base_calculo": str(payment.base_calculo)}
    payment.amount_due = data.amount_due
    if data.base_calculo is not None:
        payment.base_calculo = data.base_calculo
    if data.notes:
        payment.notes = data.notes
    db.commit()
    db.refresh(payment)
    log_action(db=db, action="DECLARE_VALUE", entity_type="Payment", entity_id=id,
               old_values=old, new_values={"amount_due": str(data.amount_due)},
               user_id=current_user.id)
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
    # Se ainda não tem relatório, entra em report_pending (adimplente sem relatório)
    payment.status = PaymentStatus.report_pending if not payment.report_received else PaymentStatus.paid
    if data.notes:
        payment.notes = (payment.notes or "") + f"\n{data.notes}"
    db.commit()
    db.refresh(payment)
    log_action(db=db, action="CONFIRM_PAYMENT", entity_type="Payment", entity_id=id,
               old_values={"status": str(old_status)},
               new_values={"status": payment.status, "amount_paid": str(data.amount_paid)},
               user_id=current_user.id)
    return payment


@router.post("/{id}/register-report", response_model=PaymentOut)
def register_report(id: int, data: PaymentRegisterReport, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    """Registra o recebimento do relatório GGR. Pode ser feito mesmo sem upload de arquivo."""
    payment = db.query(Payment).get(id)
    if not payment:
        raise HTTPException(status_code=404, detail="Pagamento não encontrado")

    payment.report_received = True
    payment.report_received_at = datetime.utcnow()
    if data.report_reference_month:
        payment.report_reference_month = data.report_reference_month
    if data.report_notes:
        payment.report_notes = data.report_notes
    # Se já estava pago (amount_paid preenchido), muda para paid completo
    if payment.amount_paid:
        payment.status = PaymentStatus.paid
    db.commit()
    db.refresh(payment)
    log_action(db=db, action="REGISTER_REPORT", entity_type="Payment", entity_id=id,
               new_values={"report_reference_month": str(data.report_reference_month)},
               user_id=current_user.id)
    return payment


@router.post("/{id}/upload-report")
async def upload_report(id: int, file: UploadFile = File(...), db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    """Faz upload do arquivo de relatório GGR."""
    payment = db.query(Payment).get(id)
    if not payment:
        raise HTTPException(status_code=404, detail="Pagamento não encontrado")

    os.makedirs(REPORT_UPLOAD_DIR, exist_ok=True)
    ext = os.path.splitext(file.filename or "relatorio.pdf")[1].lower()
    allowed = (".pdf", ".xlsx", ".xls", ".csv", ".docx", ".doc", ".png", ".jpg", ".jpeg")
    if ext not in allowed:
        raise HTTPException(status_code=400, detail="Formato inválido.")
    filename = f"pay_{id}_{uuid.uuid4().hex}{ext}"
    path = os.path.join(REPORT_UPLOAD_DIR, filename)
    with open(path, "wb") as f:
        shutil.copyfileobj(file.file, f)
    payment.report_file_url = f"/uploads/reports/{filename}"
    payment.report_received = True
    if not payment.report_received_at:
        payment.report_received_at = datetime.utcnow()
    if payment.amount_paid:
        payment.status = PaymentStatus.paid
    db.commit()
    return {"report_file_url": payment.report_file_url}


# --- ENDR Payments ---

@router.get("/endr", response_model=List[ENDRPaymentOut])
def list_endr_payments(
    confederation_id: Optional[int] = None,
    month: Optional[date] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    q = db.query(ENDRPayment)
    if current_user.role == "confederation_viewer":
        q = q.filter(ENDRPayment.confederation_id == current_user.confederation_id)
    if confederation_id:
        q = q.filter(ENDRPayment.confederation_id == confederation_id)
    if month:
        q = q.filter(ENDRPayment.reference_month == month)
    return q.order_by(ENDRPayment.reference_month.desc()).all()


@router.post("/endr", response_model=ENDRPaymentOut)
def create_endr_payment(data: ENDRPaymentCreate, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    payment = ENDRPayment(
        confederation_id=data.confederation_id,
        reference_month=data.reference_month,
        amount_received=data.amount_received,
        received_date=data.received_date,
        notes=data.notes,
        registered_by_id=current_user.id,
    )
    db.add(payment)
    db.flush()
    for op_id in data.operator_ids:
        db.add(ENDRPaymentBetLink(endr_payment_id=payment.id, operator_id=op_id))
    db.commit()
    db.refresh(payment)
    log_action(db=db, action="ENDR_PAYMENT", entity_type="ENDRPayment", entity_id=payment.id,
               new_values={"amount": str(data.amount_received), "operators": data.operator_ids},
               user_id=current_user.id)
    return payment


@router.post("/endr/{id}/upload-report")
async def upload_endr_report(id: int, file: UploadFile = File(...), db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    payment = db.query(ENDRPayment).get(id)
    if not payment:
        raise HTTPException(status_code=404, detail="Pagamento ENDR não encontrado")
    os.makedirs(REPORT_UPLOAD_DIR, exist_ok=True)
    ext = os.path.splitext(file.filename or "relatorio.pdf")[1].lower()
    filename = f"endr_{id}_{uuid.uuid4().hex}{ext}"
    path = os.path.join(REPORT_UPLOAD_DIR, filename)
    with open(path, "wb") as f:
        shutil.copyfileobj(file.file, f)
    payment.report_file_url = f"/uploads/reports/{filename}"
    db.commit()
    return {"report_file_url": payment.report_file_url}


@router.delete("/endr/{id}")
def delete_endr_payment(id: int, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    payment = db.query(ENDRPayment).get(id)
    if not payment:
        raise HTTPException(status_code=404, detail="Pagamento ENDR não encontrado")
    db.delete(payment)
    db.commit()
    return {"ok": True}
