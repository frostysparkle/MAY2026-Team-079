from typing import Literal

from pydantic import BaseModel, Field


Role = Literal["participant", "organizer", "staff", "admin", "super_admin"]


class GoogleLoginRequest(BaseModel):
    credential: str = Field(min_length=1)


class AuthenticatedUser(BaseModel):
    id: str
    email: str
    email_verified: bool
    roles: list[Role]
    status: str
    full_name: str | None
    profile_complete: bool


class GoogleLoginResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int
    is_new_user: bool
    user: AuthenticatedUser
