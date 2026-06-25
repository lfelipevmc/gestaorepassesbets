from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, date
from ..models.collection import CycleStatus, EventType, EventChannel


class CycleCreate(BaseModel):
    confederation_id: int
    reference_month: date


class EventCreate(BaseModel):
    operator_id: int
    event_type: EventType
    channel: EventChannel
    notes: Optional[str] = None


class EventOut(BaseModel):
    id: int
    cycle_id: int
    operator_id: int
    event_type: EventType
    channel: EventChannel
    notes: Optional[str]
    performed_by_id: Optional[int]
    performed_at: datetime

    class Config:
        from_attributes = True


class CycleOut(BaseModel):
    id: int
    confederation_id: int
    reference_month: date
    status: CycleStatus
    created_at: datetime

    class Config:
        from_attributes = True
