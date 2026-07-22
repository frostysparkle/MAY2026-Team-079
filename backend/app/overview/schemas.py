from pydantic import BaseModel


class EventsSummary(BaseModel):
    active: int
    total_checked_in: int
    at_capacity: int


class QueriesSummary(BaseModel):
    open: int
    assigned: int
    in_progress: int
    resolved: int
    unresolved: int


class HostelSummary(BaseModel):
    allocations: int
    checked_in: int


class MessSummary(BaseModel):
    eligible: int


class OverviewOut(BaseModel):
    """Consolidated operational snapshot (FR-9.1)."""

    events: EventsSummary
    queries: QueriesSummary
    hostel: HostelSummary
    mess: MessSummary
