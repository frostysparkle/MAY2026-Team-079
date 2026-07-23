from typing import Literal

from pydantic import BaseModel, Field, model_validator


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
    event_id: str | None = None

    @model_validator(mode="after")
    def _validate_event_scope(self) -> "ProvisionSecretRequest":
        _validate_scope(self.checkpoint_context, self.event_id)
        return self


class ProvisionSecretResponse(BaseModel):
    participant_id: str
    checkpoint_context: CheckpointContext
    event_id: str | None = None
    secret_base32: str


class VerifyScanRequest(BaseModel):
    participant_id: str = Field(min_length=1)
    current_code: str = Field(pattern=r"^\d{6}$")
    checkpoint_context: CheckpointContext
    event_id: str | None = None

    @model_validator(mode="after")
    def _validate_event_scope(self) -> "VerifyScanRequest":
        _validate_scope(self.checkpoint_context, self.event_id)
        return self


def _validate_scope(
    checkpoint_context: CheckpointContext, event_id: str | None
) -> None:
    if checkpoint_context == "event" and not event_id:
        raise ValueError("event_id is required for an event checkpoint.")
    if checkpoint_context != "event" and event_id is not None:
        raise ValueError("event_id is only valid for an event checkpoint.")


class ScanParticipant(BaseModel):
    id: str
    full_name: str | None
    photo_url: str | None


class VerifyScanResponse(BaseModel):
    result: ScanResultCode
    participant: ScanParticipant | None = None
    detail: str | None = None
