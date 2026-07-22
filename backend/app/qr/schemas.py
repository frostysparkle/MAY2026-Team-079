from typing import Literal

from pydantic import BaseModel, Field


CheckpointContext = Literal["event", "mess", "hostel", "workshop"]

ScanResultCode = Literal[
    "valid",
    "expired",
    "unknown_participant",
    "duplicate",
    "wrong_checkpoint",
    "not_eligible",
    "payment_pending",
]


class ProvisionSecretRequest(BaseModel):
    checkpoint_context: CheckpointContext


class ProvisionSecretResponse(BaseModel):
    participant_id: str
    checkpoint_context: CheckpointContext
    secret_base32: str


class VerifyScanRequest(BaseModel):
    participant_id: str = Field(min_length=1)
    current_code: str = Field(pattern=r"^\d{6}$")
    checkpoint_context: CheckpointContext
    # For event checkpoints, the organizer app may attribute the scan to a
    # specific event so attendance can be counted per event (Epic 3).
    event_id: str | None = None


class ScanParticipant(BaseModel):
    id: str
    full_name: str | None
    photo_url: str | None


class VerifyScanResponse(BaseModel):
    result: ScanResultCode
    participant: ScanParticipant | None = None
    detail: str | None = None
