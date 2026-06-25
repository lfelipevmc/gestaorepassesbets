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
def list_users(db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    return db.query(User).all()


@router.post("/", response_model=UserOut)
def create_user(data: UserCreate, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    if db.query(User).filter(User.email == data.email).first():
        raise HTTPException(status_code=400, detail="Email já cadastrado")
    user = User(
        email=data.email,
        name=data.name,
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
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(user, k, v)
    db.commit()
    db.refresh(user)
    log_action(db=db, action="UPDATE_USER", entity_type="User", entity_id=id, user_id=current_user.id)
    return user
