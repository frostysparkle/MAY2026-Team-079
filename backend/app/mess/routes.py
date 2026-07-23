from typing import Annotated, Any

from bson import ObjectId
from fastapi import APIRouter, Depends, status
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.errors import PyMongoError

from app.auth.dependencies import (
    get_current_user,
    get_mess_menu_collection,
    get_users_collection,
)
from app.auth.roles import require_role
from app.auth.scopes import require_fixed_scope
from app.core.errors import ApiError
from app.mess.schemas import (
    CreateMessMenuRequest,
    MessEligibilityItem,
    MessEligibilityListResponse,
    MessMenuItemOut,
    MessMenuListResponse,
    MessPassOut,
    MessStatsOut,
    SetMessEligibilityRequest,
    UpdateMessMenuRequest,
    serialize_menu_item,
)
from app.mess.service import (
    MessMenuConflictError,
    MessMenuNotFoundError,
    ParticipantNotFoundError,
    count_eligible,
    create_menu_item,
    delete_menu_item,
    is_mess_eligible,
    list_eligibility,
    list_menu,
    set_mess_eligibility,
    update_menu_item,
)


router = APIRouter(prefix="/mess", tags=["mess"])


def _db_error() -> ApiError:
    return ApiError(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        code="database_unavailable",
        message="The database is temporarily unavailable.",
    )


def _menu_not_found() -> ApiError:
    return ApiError(
        status_code=status.HTTP_404_NOT_FOUND,
        code="menu_item_not_found",
        message="Menu item not found.",
    )


# ---------------------------------------------------------------- menu ---


@router.get("/menu", response_model=MessMenuListResponse, summary="View mess menu (FR-4.1)")
async def list_menu_route(
    _user: Annotated[dict[str, Any], Depends(get_current_user)],
    menu: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_mess_menu_collection)
    ],
) -> MessMenuListResponse:
    try:
        docs = await list_menu(menu)
    except PyMongoError as exc:
        raise _db_error() from exc
    return MessMenuListResponse(items=[serialize_menu_item(d) for d in docs])


@router.post(
    "/menu",
    response_model=MessMenuItemOut,
    status_code=status.HTTP_201_CREATED,
    summary="Add a menu entry (organizer+)",
)
async def create_menu_route(
    body: CreateMessMenuRequest,
    _actor: Annotated[
        dict[str, Any],
        Depends(require_fixed_scope("checkpoint", "mess", "organizer")),
    ],
    menu: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_mess_menu_collection)
    ],
) -> MessMenuItemOut:
    try:
        doc = await create_menu_item(menu, body)
    except MessMenuConflictError as exc:
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="menu_conflict",
            message=str(exc),
        ) from exc
    except PyMongoError as exc:
        raise _db_error() from exc
    return serialize_menu_item(doc)


@router.patch(
    "/menu/{item_id}",
    response_model=MessMenuItemOut,
    summary="Update a menu entry (organizer+)",
)
async def update_menu_route(
    item_id: str,
    body: UpdateMessMenuRequest,
    _actor: Annotated[
        dict[str, Any],
        Depends(require_fixed_scope("checkpoint", "mess", "organizer")),
    ],
    menu: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_mess_menu_collection)
    ],
) -> MessMenuItemOut:
    changes = body.changes()
    if not changes:
        raise ApiError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="no_changes",
            message="No fields to update.",
        )
    try:
        doc = await update_menu_item(menu, item_id, changes)
    except MessMenuNotFoundError as exc:
        raise _menu_not_found() from exc
    except MessMenuConflictError as exc:
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT, code="menu_conflict", message=str(exc)
        ) from exc
    except PyMongoError as exc:
        raise _db_error() from exc
    return serialize_menu_item(doc)


@router.delete(
    "/menu/{item_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove a menu entry (organizer+)",
)
async def delete_menu_route(
    item_id: str,
    _actor: Annotated[
        dict[str, Any],
        Depends(require_fixed_scope("checkpoint", "mess", "organizer")),
    ],
    menu: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_mess_menu_collection)
    ],
) -> None:
    try:
        await delete_menu_item(menu, item_id)
    except MessMenuNotFoundError as exc:
        raise _menu_not_found() from exc
    except PyMongoError as exc:
        raise _db_error() from exc


# --------------------------------------------------------- mess pass ---


@router.get("/pass", response_model=MessPassOut, summary="My mess pass (FR-4.2)")
async def my_mess_pass_route(
    current_user: Annotated[dict[str, Any], Depends(get_current_user)],
) -> MessPassOut:
    return MessPassOut(
        participant_id=str(current_user["_id"]),
        eligible=is_mess_eligible(current_user),
    )


@router.get(
    "/eligibility",
    response_model=MessEligibilityListResponse,
    summary="List participants' mess eligibility (admin+)",
)
async def list_eligibility_route(
    _actor: Annotated[dict[str, Any], Depends(require_role("admin"))],
    users: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_users_collection)
    ],
) -> MessEligibilityListResponse:
    try:
        docs = await list_eligibility(users)
    except PyMongoError as exc:
        raise _db_error() from exc
    return MessEligibilityListResponse(
        participants=[
            MessEligibilityItem(
                id=str(d["_id"]),
                full_name=(d.get("profile") or {}).get("full_name"),
                email=d["email"],
                eligible=is_mess_eligible(d),
            )
            for d in docs
        ]
    )


@router.patch(
    "/eligibility/{participant_id}",
    response_model=MessEligibilityItem,
    summary="Grant/revoke a participant's mess pass (admin+)",
)
async def set_eligibility_route(
    participant_id: str,
    body: SetMessEligibilityRequest,
    _actor: Annotated[dict[str, Any], Depends(require_role("admin"))],
    users: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_users_collection)
    ],
) -> MessEligibilityItem:
    try:
        await set_mess_eligibility(users, participant_id, body.eligible)
        doc = await users.find_one({"_id": ObjectId(participant_id)})
    except ParticipantNotFoundError as exc:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="participant_not_found",
            message="Participant not found.",
        ) from exc
    except PyMongoError as exc:
        raise _db_error() from exc
    assert doc is not None
    return MessEligibilityItem(
        id=str(doc["_id"]),
        full_name=(doc.get("profile") or {}).get("full_name"),
        email=doc["email"],
        eligible=is_mess_eligible(doc),
    )


@router.get("/stats", response_model=MessStatsOut, summary="Mess opt-in count (organizer+, FR-4.4)")
async def mess_stats_route(
    _actor: Annotated[
        dict[str, Any],
        Depends(require_fixed_scope("checkpoint", "mess", "organizer")),
    ],
    users: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_users_collection)
    ],
) -> MessStatsOut:
    try:
        return MessStatsOut(eligible_count=await count_eligible(users))
    except PyMongoError as exc:
        raise _db_error() from exc
