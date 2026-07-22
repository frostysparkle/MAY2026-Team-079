from typing import Literal

from pydantic import BaseModel


CrowdStatus = Literal["available", "filling_fast", "full"]


class EventAttendanceOut(BaseModel):
    event_id: str
    capacity: int
    attendance: int
    remaining: int
    at_capacity: bool


class EventCrowdOut(BaseModel):
    event_id: str
    status: CrowdStatus


class DashboardEventOut(BaseModel):
    event_id: str
    title: str
    venue: str
    capacity: int
    attendance: int
    remaining: int
    at_capacity: bool
    status: CrowdStatus


class AttendanceDashboardResponse(BaseModel):
    events: list[DashboardEventOut]


def crowd_status(attendance: int, capacity: int) -> CrowdStatus:
    if capacity <= 0:
        return "available"
    ratio = attendance / capacity
    if ratio >= 1.0:
        return "full"
    if ratio >= 0.7:
        return "filling_fast"
    return "available"
