from typing import Any

from pymongo.asynchronous.collection import AsyncCollection

from app.attendance.service import event_attendance
from app.events.service import list_events
from app.mess.service import count_eligible
from app.overview.schemas import (
    EventsSummary,
    HostelSummary,
    MessSummary,
    OverviewOut,
    QueriesSummary,
)


async def build_overview(
    events: AsyncCollection[dict[str, Any]],
    scan_logs: AsyncCollection[dict[str, Any]],
    queries: AsyncCollection[dict[str, Any]],
    hostel_allocations: AsyncCollection[dict[str, Any]],
    users: AsyncCollection[dict[str, Any]],
) -> OverviewOut:
    # Events: active count, total checked-in across events, and how many are full.
    published = await list_events(events, include_unpublished=False)
    total_checked_in = 0
    at_capacity = 0
    for event in published:
        attendance = await event_attendance(scan_logs, str(event["_id"]))
        total_checked_in += attendance
        capacity = int(event.get("capacity", 0))
        if capacity > 0 and attendance >= capacity:
            at_capacity += 1

    # Queries by status.
    q_open = await queries.count_documents({"status": "open"})
    q_assigned = await queries.count_documents({"status": "assigned"})
    q_in_progress = await queries.count_documents({"status": "in_progress"})
    q_resolved = await queries.count_documents({"status": "resolved"})

    hostel_alloc = await hostel_allocations.count_documents({})
    hostel_checked = await hostel_allocations.count_documents({"checked_in": True})

    mess_eligible = await count_eligible(users)

    return OverviewOut(
        events=EventsSummary(
            active=len(published),
            total_checked_in=total_checked_in,
            at_capacity=at_capacity,
        ),
        queries=QueriesSummary(
            open=q_open,
            assigned=q_assigned,
            in_progress=q_in_progress,
            resolved=q_resolved,
            unresolved=q_open + q_assigned + q_in_progress,
        ),
        hostel=HostelSummary(allocations=hostel_alloc, checked_in=hostel_checked),
        mess=MessSummary(eligible=mess_eligible),
    )
