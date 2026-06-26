from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from ..database import get_db
from ..models.user import User
from ..schemas.user import UserCreate, UserOut, UserUpdate
from ..core.auth import get_current_user, require_admin, get_password_hash
from ..services.audit_service import log_action

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("/", response_model=List[UserOut])
def list_users(
    include_inactive: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Por padrão retorna somente usuários ativos (para seletores em todo o sistema).
    A página de gestão de usuários (admin) passa include_inactive=true para ver os desativados."""
    q = db.query(User)
    if not include_inactive:
        q = q.filter(User.is_active == True)
    return q.order_by(User.name).all()


@router.post("/", response_model=UserOut)
def create_user(data: UserCreate, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    if db.query(User).filter(User.email == data.email).first():
        raise HTTPException(status_code=400, detail="Email já cadastrado")
    user = User(
        email=data.email,
        name=data.name,
        phone=data.phone,
        hashed_password=get_password_hash(data.password),
        role=data.role,
        confederation_id=data.confederation_id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    log_action(db=db, action="CREATE_USER", entity_type="User", entity_id=user.id, user_id=current_user.id)
    return user


@router.patch("/{id}", response_model=UserOut)
def update_user(id: int, data: UserUpdate, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    user = db.query(User).get(id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    payload = data.model_dump(exclude_unset=True)
    new_password = payload.pop("password", None)
    if new_password:
        user.hashed_password = get_password_hash(new_password)
    for k, v in payload.items():
        setattr(user, k, v)
    db.commit()
    db.refresh(user)
    log_action(db=db, action="UPDATE_USER", entity_type="User", entity_id=id, user_id=current_user.id)
    return user


@router.delete("/{id}")
def delete_user(id: int, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    user = db.query(User).get(id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    if user.id == current_user.id:
        raise HTTPException(status_code=400, detail="Você não pode desativar o próprio usuário")
    # Preserva o histórico de auditoria: desativa em vez de apagar
    user.is_active = False
    db.commit()
    log_action(db=db, action="DEACTIVATE_USER", entity_type="User", entity_id=id, user_id=current_user.id)
    return {"ok": True, "deactivated": True}
