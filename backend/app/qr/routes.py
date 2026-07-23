from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, Request, status
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.errors import PyMongoError
from redis.exceptions import RedisError

from app.auth.dependencies import (
    get_current_user,
    get_events_collection,
    get_hostel_allocations_collection,
    get_photos_collection_optional,
    get_qr_secrets_collection,
    get_registrations_collection,
    get_scan_logs_collection,
    get_staff_assignments_collection,
    get_users_collection,
)
from app.auth.scopes import ensure_scope_access
from app.core.errors import ApiError
from app.participants.serialization import resolve_photo_url
from app.qr.crypto import SecretCipher
from app.qr.dependencies import get_secret_cipher, get_verification_state
from app.qr.schemas import (
    ProvisionSecretRequest,
    ProvisionSecretResponse,
    ScanParticipant,
    VerifyScanRequest,
    VerifyScanResponse,
)
from app.qr.service import (
    EventCheckpointUnavailableError,
    EventRegistrationRequiredError,
    ScanRateLimitExceededError,
    StoredQrSecretInvalidError,
    provision_secret,
    verify_scan,
)
from app.qr.verification_state import RedisVerificationState


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
    events: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_events_collection)
    ],
    registrations: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_registrations_collection)
    ],
    secret_cipher: Annotated[SecretCipher, Depends(get_secret_cipher)],
) -> ProvisionSecretResponse:
    try:
        secret = await provision_secret(
            qr_secrets,
            events,
            registrations,
            secret_cipher,
            current_user["_id"],
            body.checkpoint_context,
            body.event_id,
        )
    except EventCheckpointUnavailableError as exc:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="event_not_found",
            message="Event not found.",
        ) from exc
    except EventRegistrationRequiredError as exc:
        raise ApiError(
            status_code=status.HTTP_403_FORBIDDEN,
            code="event_registration_required",
            message=str(exc),
        ) from exc
    except PyMongoError as exc:
        raise ApiError(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            code="database_unavailable",
            message="The database is temporarily unavailable.",
        ) from exc

    return ProvisionSecretResponse(
        participant_id=str(current_user["_id"]),
        checkpoint_context=body.checkpoint_context,
        event_id=body.event_id,
        secret_base32=secret,
    )


@router.post(
    "/scan/verify",
    response_model=VerifyScanResponse,
    summary="Verify a scanned QR against the per-checkpoint secret (organizer+)",
)
async def verify_scan_route(
    body: VerifyScanRequest,
    request: Request,
    actor: Annotated[dict[str, Any], Depends(get_current_user)],
    scanner_device_id: Annotated[
        str,
        Header(
            alias="X-Scanner-Device-ID",
            min_length=8,
            max_length=128,
            pattern=r"^[A-Za-z0-9._:-]+$",
        ),
    ],
    users: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_users_collection)
    ],
    events: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_events_collection)
    ],
    registrations: Annotated[
        AsyncCollection[dict[str, Any]], Depends(get_registrations_collection)
    ],
    assignments: Annotated[
        AsyncCollection[dict[str, Any]],
        Depends(get_staff_assignments_collection),
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
    secret_cipher: Annotated[SecretCipher, Depends(get_secret_cipher)],
    verification_state: Annotated[
        RedisVerificationState, Depends(get_verification_state)
    ],
) -> VerifyScanResponse:
    try:
        await ensure_scope_access(
            actor,
            assignments,
            roles=("organizer", "staff"),
            scope_type=(
                "event" if body.checkpoint_context == "event" else "checkpoint"
            ),
            scope_id=body.event_id or body.checkpoint_context,
        )
        outcome = await verify_scan(
            users,
            events,
            registrations,
            qr_secrets,
            scan_logs,
            secret_cipher,
            verification_state,
            body.participant_id,
            body.current_code,
            body.checkpoint_context,
            actor["_id"],
            scanner_device_id,
            request.client.host if request.client is not None else "unknown",
            hostel_allocations=hostel_allocations,
            event_id=body.event_id,
        )
    except ScanRateLimitExceededError as exc:
        raise ApiError(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            code="scan_rate_limited",
            message="Too many scan attempts. Try again shortly.",
        ) from exc
    except StoredQrSecretInvalidError as exc:
        raise ApiError(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            code="digital_id_unavailable",
            message=str(exc),
        ) from exc
    except RedisError as exc:
        raise ApiError(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            code="verification_state_unavailable",
            message="QR verification state is temporarily unavailable.",
        ) from exc
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
