from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from ..models.document import DocumentType


class DocumentOut(BaseModel):
    id: int
    operator_id: Optional[int]
    confederation_id: Optional[int]
    cycle_id: Optional[int]
    payment_id: Optional[int]
    title: str
    document_type: DocumentType
    file_name: str
    file_size: Optional[int]
    description: Optional[str]
    uploaded_by_id: int
    created_at: datetime

    class Config:
        from_attributes = True
