from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


Meal = Literal["breakfast", "lunch", "snacks", "dinner"]

_TIME_RE = r"^([01]\d|2[0-3]):[0-5]\d$"


class MessMenuItemOut(BaseModel):
    id: str
    location: str
    meal: Meal
    items: str
    start_time: str
    end_time: str


class MessMenuListResponse(BaseModel):
    items: list[MessMenuItemOut]


class CreateMessMenuRequest(BaseModel):
    location: str = Field(min_length=1, max_length=120)
    meal: Meal
    items: str = Field(min_length=1, max_length=2000)
    start_time: str = Field(pattern=_TIME_RE)
    end_time: str = Field(pattern=_TIME_RE)

    @field_validator("location", "items")
    @classmethod
    def _strip(cls, value: str) -> str:
        return value.strip()


class UpdateMessMenuRequest(BaseModel):
    location: str | None = Field(default=None, min_length=1, max_length=120)
    meal: Meal | None = None
    items: str | None = Field(default=None, min_length=1, max_length=2000)
    start_time: str | None = Field(default=None, pattern=_TIME_RE)
    end_time: str | None = Field(default=None, pattern=_TIME_RE)

    def changes(self) -> dict[str, Any]:
        return self.model_dump(exclude_unset=True, exclude_none=True)


class MessPassOut(BaseModel):
    """The caller's own mess pass (FR-4.2)."""

    participant_id: str
    eligible: bool


class SetMessEligibilityRequest(BaseModel):
    eligible: bool


class MessEligibilityItem(BaseModel):
    id: str
    full_name: str | None
    email: str
    eligible: bool


class MessEligibilityListResponse(BaseModel):
    participants: list[MessEligibilityItem]


class MessStatsOut(BaseModel):
    """Opt-in count for meal planning (FR-4.4)."""

    eligible_count: int


def serialize_menu_item(doc: dict[str, Any]) -> MessMenuItemOut:
    return MessMenuItemOut(
        id=str(doc["_id"]),
        location=doc.get("location", ""),
        meal=doc.get("meal", "lunch"),
        items=doc.get("items", ""),
        start_time=doc.get("start_time", ""),
        end_time=doc.get("end_time", ""),
    )
