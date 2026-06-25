from pydantic import BaseModel
from typing import Optional, List, Any


class ReportSummary(BaseModel):
    total_operators: int
    paid: int
    report_pending: int
    overdue: int
    partial: int
    compliance_rate: float
    total_received_brl: float


class ComplianceReport(BaseModel):
    cycle_id: int
    confederation: dict
    reference_month: str
    generated_at: str
    summary: ReportSummary
    compliant: List[Any]
    report_pending_list: List[Any]
    non_compliant: List[Any]
    partial: List[Any]
