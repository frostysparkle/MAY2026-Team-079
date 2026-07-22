from typing import Annotated, Any

from fastapi import APIRouter, Depends, status
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.errors import PyMongoError

from app.auth.dependencies import (
    get_current_user,
    get_hostel_allocations_collection,
    get_photos_collection_optional,
    get_qr_secrets_collection,
    get_scan_logs_collection,
    get_users_collection,
)
from app.auth.roles import require_role
from app.core.errors import ApiError
from app.participants.serialization import resolve_photo_url
from app.qr.schemas import (
    ProvisionSecretRequest,
    ProvisionSecretResponse,
    ScanParticipant,
    VerifyScanRequest,
    VerifyScanResponse,
)
from app.qr.service import provision_secret, verify_scan


router = APIRouter(tags=["qr"])


@router.post(
    "/qr/provision",
    response_model=ProvisionSecretResponse,
    summary="Issue (or rotate) the per-checkpoint TOTP secret, returned once",
)
async def provision_secret_route(
    body: ProvisionSecretRequest,
    current_user: Annotated[dict[str, Any], Depends(get_current_user)],
    qr_secrets: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_qr_secrets_collection)
    ],
) -> ProvisionSecretResponse:
    try:
        secret = await provision_secret(
            qr_secrets, current_user["_id"], body.checkpoint_context
        )
    except PyMongoError as exc:
        raise ApiError(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            code="database_unavailable",
            message="The database is temporarily unavailable.",
        ) from exc

    return ProvisionSecretResponse(
        participant_id=str(current_user["_id"]),
        checkpoint_context=body.checkpoint_context,
        secret_base32=secret,
    )


@router.post(
    "/scan/verify",
    response_model=VerifyScanResponse,
    summary="Verify a scanned QR against the per-checkpoint secret (organizer+)",
)
async def verify_scan_route(
    body: VerifyScanRequest,
    actor: Annotated[dict[str, Any], Depends(require_role("organizer"))],
    users: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_users_collection)
    ],
    qr_secrets: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_qr_secrets_collection)
    ],
    scan_logs: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_scan_logs_collection)
    ],
    hostel_allocations: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_hostel_allocations_collection)
    ],
    photos: Annotated[
        AsyncCollection[dict[str, Any]] | None,
        Depends(get_photos_collection_optional),
    ],
) -> VerifyScanResponse:
    try:
        outcome = await verify_scan(
            users,
            qr_secrets,
            scan_logs,
            body.participant_id,
            body.current_code,
            body.checkpoint_context,
            actor["_id"],
            hostel_allocations=hostel_allocations,
        )
    except PyMongoError as exc:
        raise ApiError(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            code="database_unavailable",
            message="The database is temporarily unavailable.",
        ) from exc

    participant = None
    if outcome.result == "valid" and outcome.user is not None:
        user = outcome.user
        photo_url = await resolve_photo_url(photos, user["_id"])
        participant = ScanParticipant(
            id=str(user["_id"]),
            full_name=(user.get("profile") or {}).get("full_name"),
            photo_url=photo_url,
        )

    return VerifyScanResponse(
        result=outcome.result, participant=participant, detail=outcome.detail
    )
