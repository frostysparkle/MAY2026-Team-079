from typing import Annotated, Any

from fastapi import APIRouter, Depends, status
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.errors import PyMongoError

from app.auth.dependencies import get_contacts_collection, get_current_user
from app.auth.roles import require_role
from app.contacts.schemas import (
    ContactListResponse,
    ContactOut,
    CreateContactRequest,
    UpdateContactRequest,
    serialize_contact,
)
from app.contacts.service import (
    ContactNotFoundError,
    create_contact,
    delete_contact,
    list_contacts,
    update_contact,
)
from app.core.errors import ApiError


router = APIRouter(prefix="/contacts", tags=["contacts"])


def _db_error() -> ApiError:
    return ApiError(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        code="database_unavailable",
        message="The database is temporarily unavailable.",
    )


def _not_found() -> ApiError:
    return ApiError(
        status_code=status.HTTP_404_NOT_FOUND,
        code="contact_not_found",
        message="Contact not found.",
    )


@router.get(
    "",
    response_model=ContactListResponse,
    summary="Contact directory / emergency contacts (FR-6.4, FR-6.5)",
)
async def list_contacts_route(
    _user: Annotated[dict[str, Any], Depends(get_current_user)],
    contacts: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_contacts_collection)
    ],
    emergency_only: bool = False,
) -> ContactListResponse:
    try:
        docs = await list_contacts(contacts, emergency_only=emergency_only)
    except PyMongoError as exc:
        raise _db_error() from exc
    return ContactListResponse(contacts=[serialize_contact(d) for d in docs])


@router.post(
    "",
    response_model=ContactOut,
    status_code=status.HTTP_201_CREATED,
    summary="Add a contact (admin+)",
)
async def create_contact_route(
    body: CreateContactRequest,
    _actor: Annotated[dict[str, Any], Depends(require_role("admin"))],
    contacts: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_contacts_collection)
    ],
) -> ContactOut:
    try:
        doc = await create_contact(contacts, body)
    except PyMongoError as exc:
        raise _db_error() from exc
    return serialize_contact(doc)


@router.patch(
    "/{contact_id}",
    response_model=ContactOut,
    summary="Edit a contact (admin+)",
)
async def update_contact_route(
    contact_id: str,
    body: UpdateContactRequest,
    _actor: Annotated[dict[str, Any], Depends(require_role("admin"))],
    contacts: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_contacts_collection)
    ],
) -> ContactOut:
    changes = body.changes()
    if not changes:
        raise ApiError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="no_changes",
            message="No fields to update.",
        )
    try:
        doc = await update_contact(contacts, contact_id, changes)
    except ContactNotFoundError as exc:
        raise _not_found() from exc
    except PyMongoError as exc:
        raise _db_error() from exc
    return serialize_contact(doc)


@router.delete(
    "/{contact_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove a contact (admin+)",
)
async def delete_contact_route(
    contact_id: str,
    _actor: Annotated[dict[str, Any], Depends(require_role("admin"))],
    contacts: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_contacts_collection)
    ],
) -> None:
    try:
        await delete_contact(contacts, contact_id)
    except ContactNotFoundError as exc:
        raise _not_found() from exc
    except PyMongoError as exc:
        raise _db_error() from exc
