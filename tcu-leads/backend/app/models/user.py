from sqlalchemy import Column, Integer, String, Boolean, DateTime
from sqlalchemy.sql import func
import enum
from ..database import Base


class UserRole(str, enum.Enum):
    admin = "admin"
    membro = "membro"


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    email = Column(String(300), unique=True, nullable=False, index=True)
    name = Column(String(300), nullable=False)
    hashed_password = Column(String, nullable=False)
    role = Column(String(20), default="membro")
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.now())
