from typing import Annotated, Any

from fastapi import APIRouter, Depends, status
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.errors import PyMongoError

from app.auth.dependencies import get_current_user, get_queries_collection
from app.auth.roles import require_role
from app.core.errors import ApiError
from app.queries.schemas import (
    QueryListResponse,
    QueryOut,
    RaiseQueryRequest,
    UpdateQueryRequest,
    serialize_query,
)
from app.queries.service import (
    QueryNotFoundError,
    list_all_queries,
    list_my_queries,
    raise_query,
    update_query,
)


router = APIRouter(prefix="/queries", tags=["queries"])


def _db_error() -> ApiError:
    return ApiError(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        code="database_unavailable",
        message="The database is temporarily unavailable.",
    )


@router.post(
    "",
    response_model=QueryOut,
    status_code=status.HTTP_201_CREATED,
    summary="Raise a support query (FR-6.1)",
)
async def raise_query_route(
    body: RaiseQueryRequest,
    current_user: Annotated[dict[str, Any], Depends(get_current_user)],
    queries: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_queries_collection)
    ],
) -> QueryOut:
    try:
        doc = await raise_query(queries, current_user["_id"], body)
    except PyMongoError as exc:
        raise _db_error() from exc
    return serialize_query(doc)


@router.get(
    "",
    response_model=QueryListResponse,
    summary="List my queries (FR-6.2)",
)
async def list_my_queries_route(
    current_user: Annotated[dict[str, Any], Depends(get_current_user)],
    queries: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_queries_collection)
    ],
) -> QueryListResponse:
    try:
        docs = await list_my_queries(queries, current_user["_id"])
    except PyMongoError as exc:
        raise _db_error() from exc
    return QueryListResponse(queries=[serialize_query(d) for d in docs])


@router.get(
    "/manage",
    response_model=QueryListResponse,
    summary="List all queries for triage (admin+, FR-6.3)",
)
async def list_all_queries_route(
    _actor: Annotated[dict[str, Any], Depends(require_role("admin"))],
    queries: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_queries_collection)
    ],
    status_filter: str | None = None,
) -> QueryListResponse:
    try:
        docs = await list_all_queries(queries, status_filter)
    except PyMongoError as exc:
        raise _db_error() from exc
    return QueryListResponse(queries=[serialize_query(d) for d in docs])


@router.patch(
    "/{query_id}",
    response_model=QueryOut,
    summary="Update a query's status/team (admin+, FR-6.3)",
)
async def update_query_route(
    query_id: str,
    body: UpdateQueryRequest,
    _actor: Annotated[dict[str, Any], Depends(require_role("admin"))],
    queries: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_queries_collection)
    ],
) -> QueryOut:
    if not body.has_changes():
        raise ApiError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="no_changes",
            message="Provide a status and/or an assigned team.",
        )
    try:
        doc = await update_query(queries, query_id, body)
    except QueryNotFoundError as exc:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="query_not_found",
            message="Query not found.",
        ) from exc
    except PyMongoError as exc:
        raise _db_error() from exc
    return serialize_query(doc)
