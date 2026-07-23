from typing import TYPE_CHECKING, Literal

from pydantic import BaseModel, Field, field_validator


Role = Literal["participant", "organizer", "staff", "admin", "super_admin"]

if TYPE_CHECKING:
    from app.participants.serialization import ParticipantOut


def _normalize_email(value: str) -> str:
    email = value.strip().casefold()
    if "@" not in email or email.startswith("@") or email.endswith("@"):
        raise ValueError("A valid email address is required.")
    return email


class RegisterRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=8, max_length=128)
    full_name: str | None = Field(default=None, max_length=120)

    @field_validator("email")
    @classmethod
    def _validate_email(cls, value: str) -> str:
        return _normalize_email(value)

    @field_validator("full_name")
    @classmethod
    def _clean_full_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=128)

    @field_validator("email")
    @classmethod
    def _validate_email(cls, value: str) -> str:
        return _normalize_email(value)


class AuthResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int
    is_new_user: bool
    user: "ParticipantOut"
