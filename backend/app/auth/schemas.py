from typing import TYPE_CHECKING, Literal

from pydantic import BaseModel, Field


Role = Literal["participant", "organizer", "staff", "admin", "super_admin"]

if TYPE_CHECKING:
    from app.participants.serialization import ParticipantOut


class GoogleLoginRequest(BaseModel):
    credential: str = Field(min_length=1)


class GoogleLoginResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int
    is_new_user: bool
    user: "ParticipantOut"
