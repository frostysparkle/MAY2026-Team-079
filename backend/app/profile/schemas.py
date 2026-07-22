import base64
import binascii
import re
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.participants.serialization import ParticipantOut


Gender = Literal["male", "female", "other", "prefer_not_to_say"]
Program = Literal["standalone_degree", "dual_degree", "working_professional"]
CourseStage = Literal["foundational", "diploma", "degree", "other"]

# JPG/PNG, <= 750 KB (must match frontend PHOTO limits in constants.ts).
MAX_PHOTO_BYTES = 750 * 1024
_ALLOWED_PHOTO_MIME = {"image/jpeg", "image/png"}
_DATA_URL_RE = re.compile(r"^data:(?P<mime>image/(?:jpeg|png));base64,(?P<data>.+)$")


class CompleteProfileRequest(BaseModel):
    full_name: str = Field(min_length=1, max_length=120)
    age: int = Field(ge=15, le=100)
    gender: Gender
    phone: str
    country: str = Field(min_length=1)
    state: str = Field(min_length=1)
    city: str = Field(min_length=1)
    program: Program
    course_stage: CourseStage
    course_stage_other: str | None = None
    photo_data_url: str

    @field_validator("full_name", "country", "state", "city")
    @classmethod
    def _strip(cls, value: str) -> str:
        return value.strip()

    @field_validator("phone")
    @classmethod
    def _validate_phone(cls, value: str) -> str:
        digits = value.strip()
        if not re.fullmatch(r"\d{10}", digits):
            raise ValueError("Phone number must be exactly 10 digits.")
        return digits

    @field_validator("photo_data_url")
    @classmethod
    def _validate_photo(cls, value: str) -> str:
        match = _DATA_URL_RE.match(value.strip())
        if match is None:
            raise ValueError("Photo must be a base64 JPG or PNG data URL.")
        if match.group("mime") not in _ALLOWED_PHOTO_MIME:
            raise ValueError("Photo must be a JPG or PNG image.")
        try:
            raw = base64.b64decode(match.group("data"), validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ValueError("Photo data is not valid base64.") from exc
        if len(raw) == 0:
            raise ValueError("Photo is empty.")
        if len(raw) > MAX_PHOTO_BYTES:
            raise ValueError("Photo must be 750 KB or smaller.")
        return value


class CompleteProfileResponse(BaseModel):
    participant: ParticipantOut
