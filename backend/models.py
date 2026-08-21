from pydantic import BaseModel, EmailStr, Field
from typing import Optional, List, Dict, Any, Union

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

# Event models matching /event schema
class PrizeMoney(BaseModel):
    position: str
    amount: int

class ScheduleRound(BaseModel):
    round_id: Optional[str] = None
    name: str
    description: Optional[str] = ""
    start_time: str
    end_time: str
    venue: Optional[str] = None  # e.g. "OAT", "Seminar Hall A", "Online - Meet Link"

class RegistrationField(BaseModel):
    field_id: str
    label: str
    type: str  # text | number | email | phone | url | select | checkbox
    required: bool = True

class TeamRule(BaseModel):
    min: int = 1
    max: int = 1
    house: bool = False
    allow_single_registration: bool = True

class EventRegistrationInput(BaseModel):
    team_name: Optional[str] = None
    registration_data: Dict[str, Any] = {}

class EventCreateRequest(BaseModel):
    event_id: str
    event_type: str  # technical | culturals | sports | others
    name: str
    description: str
    poster: Optional[str] = ""
    team: TeamRule
    prize_money: List[PrizeMoney] = []
    registration: Dict[str, str]  # start_time, end_time
    schedule: List[ScheduleRound] = []
    registration_fields: List[RegistrationField] = []

class EventUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    poster: Optional[str] = None
    open: Optional[bool] = None
    team: Optional[TeamRule] = None
    prize_money: Optional[List[PrizeMoney]] = None
    registration: Optional[Dict[str, str]] = None
    schedule: Optional[List[ScheduleRound]] = None
    registration_fields: Optional[List[RegistrationField]] = None

# Backend Teams models
class BackendTeamCreateRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8)
    role: str # super_admin | admin | Other | volunteer
    department: str # technicals | sports | culturals | UpperHouseCouncil
    designation: str
    # Optional because staff accounts predate this field and are created in bulk
    # from a roster of emails. When it is omitted the account still gets a name:
    # see `create_backend_team`, which falls back to the linked participant.
    name: Optional[str] = None

class BackendTeamUpdateRequest(BaseModel):
    role: Optional[str] = None
    department: Optional[str] = None
    designation: Optional[str] = None
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

class WorkshopUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    venue: Optional[str] = None
    capacity: Optional[int] = None
    instructions: Optional[str] = None

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
