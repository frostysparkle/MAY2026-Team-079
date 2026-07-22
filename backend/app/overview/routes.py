from typing import Annotated, Any

from fastapi import APIRouter, Depends, status
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.errors import PyMongoError

from app.auth.dependencies import (
    get_events_collection,
    get_hostel_allocations_collection,
    get_queries_collection,
    get_scan_logs_collection,
    get_users_collection,
)
from app.auth.roles import require_role
from app.core.errors import ApiError
from app.overview.schemas import OverviewOut
from app.overview.service import build_overview


router = APIRouter(prefix="/admin", tags=["overview"])


@router.get(
    "/overview",
    response_model=OverviewOut,
    summary="Consolidated operational dashboard (admin+, FR-9.1)",
)
async def overview_route(
    _actor: Annotated[dict[str, Any], Depends(require_role("admin"))],
    events: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_events_collection)
    ],
    scan_logs: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_scan_logs_collection)
    ],
    queries: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_queries_collection)
    ],
    hostel_allocations: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_hostel_allocations_collection)
    ],
    users: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_users_collection)
    ],
) -> OverviewOut:
    try:
        return await build_overview(events, scan_logs, queries, hostel_allocations, users)
    except PyMongoError as exc:
        raise ApiError(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            code="database_unavailable",
            message="The database is temporarily unavailable.",
        ) from exc
