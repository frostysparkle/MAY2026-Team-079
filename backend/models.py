from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator
from typing import Optional, List, Dict, Any, Union, Literal
from datetime import datetime, timezone

# Auth models
class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8)

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class ForgotPasswordRequest(BaseModel):
    email: EmailStr

class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str = Field(..., min_length=8)

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(..., min_length=8)

# Profile models matching participants document profile schema
class EmergencyContact(BaseModel):
    name: str
    relation: str  # father | mother | elder_sibling | guardian
    phone: str

class ProfileCompleteRequest(BaseModel):
    full_name: str
    dob: str
    house: str     # 12 houses of IITM BS Degree Programme
    gender: str    # male | female | other
    phone: str
    mess_preference: Optional[str] = "South Indian" # South Indian | North Indian | Jain
    country: str
    state: str
    city: str
    address: str
    emergency_contact: Optional[EmergencyContact] = None
    program: str   # DS | ES | AE | MS
    course_stage: str # foundational | diploma | degree
    photo: Optional[str] = None # Base64 encoded string
    event_preferences: Optional[str] = None # free text: what sort of events/workshops the participant prefers

# QR Scanning
class ScanQRRequest(BaseModel):
    participant_id: str
    data: str
    timestamp: str

# Event models — restructured schema (no backward compatibility with the
# previous shape). See docs/events_detailed_documentation.md for the full
# document layout and role/permission model.

# The four event categories. `id_generator.EventIDGenerator` derives an event's
# id prefix from this value, so it is validated as a closed set here rather
# than left as a free string that generator would silently mis-prefix.
EVENT_TYPES = ("technical", "culturals", "sports", "others")

# The only roles an `event_team` entry may hold. `member` and `volunteer` are
# both plain team members for authorization purposes (team-scoped actions like
# scanning); only `event_head` may allocate teams, post announcements, or
# manage the team itself.
EVENT_TEAM_ROLES = ("event_head", "member", "volunteer")

# The only priorities an announcement may be published at.
ANNOUNCEMENT_PRIORITIES = ("low", "mid", "high")


def parse_instant_utc(value: str, field: str) -> datetime:
    """A permissive ISO 8601 parse, accepting a trailing 'Z', normalised to
    naive UTC for comparison — matching how every other timestamp in this
    codebase is stored and compared (`datetime.utcnow()`)."""
    text = value.strip()
    if text.endswith(("Z", "z")):
        text = f"{text[:-1]}+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        raise ValueError(f"{field} must be an ISO 8601 datetime, e.g. 2026-06-13T10:00:00Z")
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


class PrizeMoney(BaseModel):
    position: str = Field(..., min_length=1)
    amount: int = Field(..., ge=0)


class ScheduleRound(BaseModel):
    round_id: Optional[str] = None  # assigned by the backend, never accepted from a client
    name: str = Field(..., min_length=1)
    description: Optional[str] = ""
    start_time: str
    end_time: str
    venue: Optional[str] = None  # e.g. "OAT", "Seminar Hall A", "Online - Meet Link"

    @model_validator(mode="after")
    def _end_after_start(self):
        start = parse_instant_utc(self.start_time, "start_time")
        end = parse_instant_utc(self.end_time, "end_time")
        if end <= start:
            raise ValueError("end_time must be after start_time")
        return self


class RegistrationField(BaseModel):
    field_id: str = Field(..., min_length=1)
    label: str = Field(..., min_length=1)
    type: str  # text | number | email | phone | url | select | checkbox
    required: bool = True

    @field_validator("type")
    @classmethod
    def _valid_type(cls, v):
        allowed = {"text", "number", "email", "phone", "url", "select", "checkbox"}
        if v not in allowed:
            raise ValueError(f"type must be one of {sorted(allowed)}")
        return v


class TeamRule(BaseModel):
    min: int = Field(1, ge=1)
    max: int = Field(1, ge=1)
    house_vs_house_event: bool = False
    allow_single_registration: bool = True

    @model_validator(mode="after")
    def _min_le_max(self):
        if self.min > self.max:
            raise ValueError("team.min must not be greater than team.max")
        return self


class RegistrationWindow(BaseModel):
    """
    When an event accepts registrations, and the manual kill-switch beside it.

    `allowed` is a Super Admin override, independent of the time window: the
    effective open/closed state an API response reports is
    ``allowed AND now within [start_time, end_time]`` (see
    ``events._registration_open``). Neither bound is optional — an event with
    no window has no reliable answer to "is registration open", which is the
    ambiguity that used to be papered over by a bare ``open: bool``.
    """
    start_time: str
    end_time: str
    allowed: bool = True

    @model_validator(mode="after")
    def _end_after_start(self):
        start = parse_instant_utc(self.start_time, "start_time")
        end = parse_instant_utc(self.end_time, "end_time")
        if end <= start:
            raise ValueError("end_time must be after start_time")
        return self


class RegistrationWindowUpdate(BaseModel):
    """Same as `RegistrationWindow`, but every field optional so `PUT
    /events/{id}` can flip just `allowed` without having to resend the window."""
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    allowed: Optional[bool] = None

    @model_validator(mode="after")
    def _end_after_start(self):
        if self.start_time is not None and self.end_time is not None:
            start = parse_instant_utc(self.start_time, "start_time")
            end = parse_instant_utc(self.end_time, "end_time")
            if end <= start:
                raise ValueError("end_time must be after start_time")
        return self


class EventRegistrationInput(BaseModel):
    team_name: Optional[str] = None
    registration_data: Dict[str, Any] = {}


class EventCreateRequest(BaseModel):
    # event_id is assigned by the backend (id_generator.EventIDGenerator) and
    # is never accepted from a client.
    event_type: Literal["technical", "culturals", "sports", "others"]
    name: str = Field(..., min_length=1)
    description: str = Field(..., min_length=1)
    poster: Optional[str] = ""
    team: TeamRule
    prize_money: List[PrizeMoney] = []
    registration: RegistrationWindow
    schedule: List[ScheduleRound] = []
    registration_fields: List[RegistrationField] = []


class EventUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    poster: Optional[str] = None
    team: Optional[TeamRule] = None
    prize_money: Optional[List[PrizeMoney]] = None
    registration: Optional[RegistrationWindowUpdate] = None
    schedule: Optional[List[ScheduleRound]] = None
    registration_fields: Optional[List[RegistrationField]] = None


class EventTeamAssignRequest(BaseModel):
    user_id: str = Field(..., min_length=1)
    role: Literal["event_head", "member", "volunteer"]


class EventTeamRoleUpdateRequest(BaseModel):
    role: Literal["event_head", "member", "volunteer"]


class AnnouncementCreateRequest(BaseModel):
    message: str = Field(..., min_length=1)
    priority: Literal["low", "mid", "high"] = "mid"

# Backend Teams models
#
# Closed vocabularies for `role` and `department`, matching the pattern
# already used for EVENT_TYPES / EVENT_TEAM_ROLES: a module-level tuple plus a
# `Literal[...]` annotation on the field, rather than a Python `Enum` class.
#
# `department` values are deliberately lowercase and singular ("technical",
# not "technicals") so they line up exactly with `EventCreateRequest.event_type`
# ("technical" | "culturals" | "sports" | "others") — this is what lets
# `events.py` compare a staff member's department straight against an event's
# type without a translation table. "uhc" replaces the old "UpperHouseCouncil".
BACKEND_TEAM_ROLES = ("super_admin", "admin", "other", "volunteer")
BACKEND_TEAM_DEPARTMENTS = ("technical", "sports", "culturals", "uhc", "hostels", "mess", "workshops")

class BackendTeamCreateRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8)
    role: Literal["super_admin", "admin", "other", "volunteer"]
    department: Literal["technical", "sports", "culturals", "uhc", "hostels", "mess", "workshops"]
    designation: str = Field(..., min_length=1)
    # Optional because staff accounts predate this field and are created in bulk
    # from a roster of emails. When it is omitted the account still gets a name:
    # see `create_backend_team`, which falls back to the linked participant.
    name: Optional[str] = None

class BackendTeamUpdateRequest(BaseModel):
    """
    `role` and `department` are deliberately absent: both drive the
    `paradox_id` prefix assigned at creation and are treated as immutable —
    changing either means deleting the account and creating a new one, not
    patching this one. See `create_backend_team` / `update_backend_team`.
    """
    designation: Optional[str] = Field(None, min_length=1)
    name: Optional[str] = None

# Workshop models
class WorkshopCreateRequest(BaseModel):
    workshop_id: str
    slot_id: str
    name: str
    description: str
    venue: str
    capacity: int
    instructions: str
    # ISO 8601 UTC datetime string, e.g. "2026-06-12T10:00:00".
    # Drives the scanning and change windows enforced by
    # POST /workshops/{id}/attendance and PATCH /workshops/{id}/participants/{pid}.
    # Optional so workshops created before this field was introduced keep working;
    # those workshops simply have no time-window guard (all scans pass through).
    start_time: Optional[str] = None

class WorkshopUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    venue: Optional[str] = None
    capacity: Optional[int] = None
    instructions: Optional[str] = None
    # Updatable post-creation so a corrected schedule can be pushed before
    # the window guard would otherwise lock out all scanners.
    start_time: Optional[str] = None

class WorkshopAssignVolunteerRequest(BaseModel):
    user_id: str
    role: str = "workshop_volunteer"
    attendance: bool = True

class WorkshopParticipantUpdateRequest(BaseModel):
    """
    An authorised correction to one participant's record *for one workshop*.

    Both fields are optional so a caller sends only what changes; an empty body is
    rejected by the route rather than silently doing nothing.

    Deliberately scoped to the two fields the workshop owns on
    ``participants.workshops[]`` — whether they turned up, and whether the seat was
    booked ahead or taken at the door. Identity fields (name, email, phone, house,
    academic record) are *not* editable here: they belong to the participant, they
    are read by every other screen in the fest, and a workshop volunteer is not who
    should be rewriting them.
    """
    attended: Optional[bool] = None
    booking_type: Optional[str] = None  # pre-registered | on-spot

# Embeddings models — mirror the OpenAI embeddings API request shape, so any
# openai-library client can call POST /embeddings as a drop-in.
class EmbeddingRequest(BaseModel):
    input: Union[str, List[str]]
    model: Optional[str] = None
    encoding_format: Optional[str] = None  # "float" | "base64"
    dimensions: Optional[int] = None
    user: Optional[str] = None

# Query models (Epic 6 — raise a query, track it, assign it, answer it)
class QueryCreateRequest(BaseModel):
    category: str                      # hostel | mess | event | workshop | general
    subject: str = Field(..., min_length=1)
    body: str = Field(..., min_length=1)
    # The block, hall, event, or workshop the query is about. This is what routes
    # it to a team: a `hostel` query naming a block reaches that block's
    # `hostel_team` and nobody else. Omitted for `general`, which reaches the
    # Super Admins.
    target_id: Optional[str] = None

class QueryUpdateRequest(BaseModel):
    status: Optional[str] = None       # open | assigned | resolved
    # Free text naming the team that owns it, e.g. "Ganga Block desk". The
    # routing itself is derived from category + target_id, so this is a label for
    # the humans reading the thread, not an access control.
    assigned_team: Optional[str] = None
    assigned_to: Optional[str] = None  # paradox_id of the staff member who owns it

class QueryReplyRequest(BaseModel):
    body: str = Field(..., min_length=1)

# Admin edit of another participant's record (Story 7.3). Every field optional:
# the route only $sets the ones a request actually carries, so a form that edits
# one field cannot blank the rest.
class ParticipantAdminUpdateRequest(BaseModel):
    full_name: Optional[str] = None
    house: Optional[str] = None
    gender: Optional[str] = None
    phone: Optional[str] = None
    mess_preference: Optional[str] = None
    country: Optional[str] = None
    state: Optional[str] = None
    city: Optional[str] = None
    address: Optional[str] = None
    program: Optional[str] = None
    course_stage: Optional[str] = None
    emergency_contact: Optional[EmergencyContact] = None
