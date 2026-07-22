from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


ContactCategory = Literal["hostel", "mess", "event", "security", "general"]


class ContactOut(BaseModel):
    id: str
    name: str
    role: str
    category: ContactCategory
    phone: str
    email: str | None
    is_emergency: bool


class CreateContactRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    role: str = Field(min_length=1, max_length=120)
    category: ContactCategory
    phone: str = Field(min_length=3, max_length=20)
    email: str | None = None
    is_emergency: bool = False

    @field_validator("name", "role", "phone")
    @classmethod
    def _strip(cls, value: str) -> str:
        return value.strip()


class UpdateContactRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    role: str | None = Field(default=None, min_length=1, max_length=120)
    category: ContactCategory | None = None
    phone: str | None = Field(default=None, min_length=3, max_length=20)
    email: str | None = None
    is_emergency: bool | None = None

    def changes(self) -> dict[str, Any]:
        return {k: v for k, v in self.model_dump(exclude_unset=True).items()}


class ContactListResponse(BaseModel):
    contacts: list[ContactOut]


def serialize_contact(doc: dict[str, Any]) -> ContactOut:
    return ContactOut(
        id=str(doc["_id"]),
        name=doc.get("name", ""),
        role=doc.get("role", ""),
        category=doc.get("category", "general"),
        phone=doc.get("phone", ""),
        email=doc.get("email"),
        is_emergency=bool(doc.get("is_emergency")),
    )
