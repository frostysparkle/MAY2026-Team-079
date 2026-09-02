from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator
from typing import Optional, List, Dict, Any, Union, Literal
from datetime import datetime, timezone

from phone import validate_phone

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

    @field_validator("phone")
    @classmethod
    def _valid_phone(cls, v):
        return validate_phone(v)

# Closed vocabularies for every profile field the client can choose from a
# fixed list, validated here rather than left as free strings. Centralised in
# one place (instead of, say, `mess.py` defining its own mess vocabulary) so
# `ProfileCompleteRequest`, `ParticipantAdminUpdateRequest`, and anything else
# that reads or writes these fields can never disagree about what is valid.

# The twelve official IITM BS houses, stored bare (no "House" suffix).
HOUSES = (
    "Bandipur", "Corbett", "Gir", "Kanha", "Kaziranga", "Nallamala",
    "Namdapha", "Nilgiri", "Pichavaram", "Saranda", "Sundarbans", "Wayanad",
)

#: The profile dropdown labels each house as "Bandipur House" because that is
#: how students know them. The wire value and the stored value are the bare
#: name. Accept the labelled form here so a first-time complete-profile submit
#: that sends the option text (or an older client that used the label as the
#: value) is stored canonically instead of 422ing with a list of bare names
#: that do not appear in the dropdown.
_HOUSE_LABEL_SUFFIX = " House"


def canonical_house(value: str) -> str:
    if value in HOUSES:
        return value
    if value.endswith(_HOUSE_LABEL_SUFFIX):
        bare = value[: -len(_HOUSE_LABEL_SUFFIX)]
        if bare in HOUSES:
            return bare
    raise ValueError(f"house must be one of {sorted(HOUSES)}")

# Strict binary — no "other" bucket.
GENDERS = ("male", "female")

PROGRAMS = ("DS", "MS", "AE", "ES")

COURSE_STAGES = ("foundational", "diploma", "degree")

# Mess type vocabulary — the same closed set a mess hall's own `type` is
# validated against (see `routers.mess`). Combined as "{cuisine}__{diet}" for
# every hall that serves a specific regional menu, plus a standalone "jain"
# for a hall that serves neither regional variant. Defined here rather than in
# `routers/mess.py` so a participant's `mess_preference` and a hall's `type`
# are provably the same set, not two lists that happen to agree today.
MESS_CUISINES = ("north_indian", "south_indian")
MESS_DIETS = ("veg", "non_veg")
MESS_PREFERENCE_TYPES = {
    f"{cuisine}__{diet}" for cuisine in MESS_CUISINES for diet in MESS_DIETS
} | {"jain"}

# The only methods a mock payment may be labelled with. Purely cosmetic on the
# receipt — see `MockPaymentRequest`.
PAYMENT_METHODS = ("upi", "card", "netbanking")


class ProfileCompleteRequest(BaseModel):
    full_name: str
    dob: str
    house: str     # one of HOUSES, bare (no "House" suffix)
    gender: str    # male | female
    phone: str
    # None means "not yet chosen" — a participant who has not decided whether
    # they are taking mess at all. Validated against MESS_PREFERENCE_TYPES
    # when set; see `_valid_mess_preference`.
    mess_preference: Optional[str] = None
    country: str
    state: str
    city: str
    address: str
    emergency_contact: Optional[EmergencyContact] = None
    program: str   # DS | MS | AE | ES
    course_stage: str # foundational | diploma | degree
    photo: Optional[str] = None # Base64 encoded string
    event_preferences: Optional[str] = None # free text: what sort of events/workshops the participant prefers

    @field_validator("house")
    @classmethod
    def _valid_house(cls, v):
        return canonical_house(v)

    @field_validator("gender")
    @classmethod
    def _valid_gender(cls, v):
        if v not in GENDERS:
            raise ValueError(f"gender must be one of {sorted(GENDERS)}")
        return v

    @field_validator("program")
    @classmethod
    def _valid_program(cls, v):
        if v not in PROGRAMS:
            raise ValueError(f"program must be one of {sorted(PROGRAMS)}")
        return v

    @field_validator("course_stage")
    @classmethod
    def _valid_course_stage(cls, v):
        if v not in COURSE_STAGES:
            raise ValueError(f"course_stage must be one of {sorted(COURSE_STAGES)}")
        return v

    @field_validator("mess_preference")
    @classmethod
    def _valid_mess_preference(cls, v):
        if v is not None and v not in MESS_PREFERENCE_TYPES:
            raise ValueError(f"mess_preference must be one of {sorted(MESS_PREFERENCE_TYPES)}")
        return v

    @field_validator("phone")
    @classmethod
    def _valid_phone(cls, v):
        return validate_phone(v)


class MockPaymentRequest(BaseModel):
    """
    A mock payment attempt for the mess or hostel fee (`POST /mess/pay`,
    `POST /hostels/pay`).

    The amount is never accepted from the client — each route charges its own
    fixed fee, so a participant cannot pay an arbitrary amount — so this model
    carries only the payment method, which exists purely to label the mock
    receipt the same way `StayPaymentPage`'s frontend mock does.
    """
    method: Optional[str] = "upi"

    @field_validator("method")
    @classmethod
    def _valid_method(cls, v):
        if v is not None and v not in PAYMENT_METHODS:
            raise ValueError(f"method must be one of {sorted(PAYMENT_METHODS)}")
        return v

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

# The roles a *participant* holds inside their own competing team. Distinct from
# EVENT_TEAM_ROLES above, which is about the staff running the event.
# `register_for_event` writes "leader" to whoever creates a team and "member" to
# everyone else, solo registrants included — so those two values are the whole
# vocabulary, and `PUT /events/{id}/participant_teams/{id}` is held to it.
PARTICIPANT_TEAM_ROLES = ("leader", "member")

# The only priorities an announcement may be published at.
ANNOUNCEMENT_PRIORITIES = ("low", "mid", "high")

# The ceiling on `?limit=` for every paged staff-facing list: the participant
# roster, the issues queue, the queries queue and the audit trail.
#
# `limit` used to be a bare `int` on all four, which is unvalidated in both
# directions and wrong at both ends. `limit=0` does not mean "no rows" to Mongo,
# it means *no limit*, so a client computing a page size that reached zero was
# handed the entire collection — the exact opposite of what it asked for, and on
# the roster that is every participant's name, address and phone number in one
# response. A large positive value did the same thing without needing the quirk.
# Bounded here rather than per-route so the four cannot drift apart.
PAGE_LIMIT_MAX = 500


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
    """
    How a participant registers for an event: solo, creating a new team, or
    joining one that already exists. Exactly one of these three — never a
    team_name *and* a team_id together, since that would be asking to both
    create and join in the same request.

    - Leave both fields unset to register solo.
    - Set `team_name` to create a new team and become its leader. The
      backend assigns that team's `team_id` — the same way `event_id` and
      `round_id` are assigned, via `id_generator.EventIDGenerator` — and
      returns it in the response. Share that id with teammates so they can
      join; the raw `team_name` text is never itself used as the id.
    - Set `team_id` to the id returned when the team was created, to join
      that existing team as a member.

    Whether solo registration or team registration is required/allowed for a
    given event is governed by that event's `team.max` and
    `team.allow_single_registration` — enforced in the route, not here, since
    it depends on the event being registered for.
    """
    team_name: Optional[str] = None
    team_id: Optional[str] = None
    registration_data: Dict[str, Any] = {}

    @model_validator(mode="after")
    def _create_xor_join(self):
        if self.team_name and self.team_id:
            raise ValueError("Provide team_name to create a team or team_id to join one, not both")
        return self


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

# Workshop slot models
#
# A slot (D1S1, D2S2, ...) is a Super Admin-managed time block that workshops
# are scheduled against — created independently of any workshop, and
# referenced by `slot_id` from `WorkshopCreateRequest`. Restructured schema,
# no backward compatibility with the old free-form `slot_id` string that used
# to carry no stored time of its own.
#
# The id format is deliberately validated as a closed pattern (`D<day>S<shift>`)
# rather than left as free text: it is what makes "same slot => same time
# block" a guarantee the workshop-registration slot-clash check can rely on,
# instead of an admin-entered convention nothing enforces.
SLOT_ID_PATTERN = r"^D\d+S\d+$"

class WorkshopSlotCreateRequest(BaseModel):
    slot_id: str = Field(..., pattern=SLOT_ID_PATTERN)
    start_time: str
    end_time: str

    @model_validator(mode="after")
    def _end_after_start(self):
        start = parse_instant_utc(self.start_time, "start_time")
        end = parse_instant_utc(self.end_time, "end_time")
        if end <= start:
            raise ValueError("end_time must be after start_time")
        return self

class WorkshopSlotUpdateRequest(BaseModel):
    """
    Every field optional so a caller can push just one of the two — the route
    merges whatever is given onto the stored document before re-validating
    end > start, the same pattern `events.py` uses for `RegistrationWindowUpdate`.
    """
    start_time: Optional[str] = None
    end_time: Optional[str] = None

    @model_validator(mode="after")
    def _end_after_start(self):
        if self.start_time is not None and self.end_time is not None:
            start = parse_instant_utc(self.start_time, "start_time")
            end = parse_instant_utc(self.end_time, "end_time")
            if end <= start:
                raise ValueError("end_time must be after start_time")
        return self


# Workshop models — restructured schema, no backward compatibility with the
# previous shape. A workshop's `start_time` is no longer supplied directly by
# the client: it is derived from the `workshop_slots` document its `slot_id`
# names, and kept in sync with that slot (see routers/workshop_slots.py).
#
# `registration_open` is a stored, mutable flag rather than something computed
# fresh on every read (unlike `events.RegistrationWindow.allowed`): the system
# auto-closes it once, the first time it is enforced/read after
# `registration_end` has passed, and an admin can explicitly set it back to
# `True` afterwards and have that override stick. See
# `routers.workshops._sync_registration_state`.
class WorkshopCreateRequest(BaseModel):
    # workshop_id is always assigned by the backend (SequentialIDGenerator) and
    # is never accepted from a client.
    slot_id: str = Field(..., pattern=SLOT_ID_PATTERN)
    name: str = Field(..., min_length=1)
    description: str = Field(..., min_length=1)
    venue: str = Field(..., min_length=1)
    capacity: int = Field(..., gt=0)
    instructions: str = Field(..., min_length=1)
    registration_start: str
    registration_end: str
    registration_open: bool = True

    @model_validator(mode="after")
    def _end_after_start(self):
        start = parse_instant_utc(self.registration_start, "registration_start")
        end = parse_instant_utc(self.registration_end, "registration_end")
        if end <= start:
            raise ValueError("registration_end must be after registration_start")
        return self

class WorkshopUpdateRequest(BaseModel):
    """
    Every field optional so a caller updates only what it names. `slot_id` is
    deliberately absent: a workshop's slot is fixed at creation because
    participants' bookings reference it (same rule as before this restructure).
    `start_time` is likewise absent as a direct field — it only ever changes
    via a cascaded slot edit (`PUT /workshop-slots/{slot_id}`), never directly.
    """
    name: Optional[str] = None
    description: Optional[str] = None
    venue: Optional[str] = None
    capacity: Optional[int] = Field(None, gt=0)
    instructions: Optional[str] = None
    registration_start: Optional[str] = None
    registration_end: Optional[str] = None
    registration_open: Optional[bool] = None

    @model_validator(mode="after")
    def _end_after_start(self):
        if self.registration_start is not None and self.registration_end is not None:
            start = parse_instant_utc(self.registration_start, "registration_start")
            end = parse_instant_utc(self.registration_end, "registration_end")
            if end <= start:
                raise ValueError("registration_end must be after registration_start")
        return self

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

class QueryTeamAssignRequest(BaseModel):
    """Adds an existing backend_teams member to the flat query resolution
    team roster (see routers/queries.py)."""
    user_id: str = Field(..., min_length=1)

# Admin edit of another participant's record (Story 7.3). Every field optional:
# the route only $sets the ones a request actually carries, so a form that edits
# one field cannot blank the rest. Validated against the same closed
# vocabularies as `ProfileCompleteRequest` — an admin should not be able to
# write a value a participant themselves could never submit — but only when a
# field is actually present, since every field here is optional.
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

    @field_validator("house")
    @classmethod
    def _valid_house(cls, v):
        if v is None:
            return v
        return canonical_house(v)

    @field_validator("gender")
    @classmethod
    def _valid_gender(cls, v):
        if v is not None and v not in GENDERS:
            raise ValueError(f"gender must be one of {sorted(GENDERS)}")
        return v

    @field_validator("program")
    @classmethod
    def _valid_program(cls, v):
        if v is not None and v not in PROGRAMS:
            raise ValueError(f"program must be one of {sorted(PROGRAMS)}")
        return v

    @field_validator("course_stage")
    @classmethod
    def _valid_course_stage(cls, v):
        if v is not None and v not in COURSE_STAGES:
            raise ValueError(f"course_stage must be one of {sorted(COURSE_STAGES)}")
        return v

    @field_validator("mess_preference")
    @classmethod
    def _valid_mess_preference(cls, v):
        if v is not None and v not in MESS_PREFERENCE_TYPES:
            raise ValueError(f"mess_preference must be one of {sorted(MESS_PREFERENCE_TYPES)}")
        return v

    @field_validator("phone")
    @classmethod
    def _valid_phone(cls, v):
        if v is None:
            return v
        return validate_phone(v)
