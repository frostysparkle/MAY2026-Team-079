from pydantic import BaseModel, EmailStr, Field
from typing import Optional, List, Dict, Any

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

class BackendTeamUpdateRequest(BaseModel):
    role: Optional[str] = None
    department: Optional[str] = None
    designation: Optional[str] = None

# Workshop models
class WorkshopCreateRequest(BaseModel):
    workshop_id: str
    slot_id: str
    name: str
    venue: str
    capacity: int
    instructions: str
    start_time: str

class WorkshopUpdateRequest(BaseModel):
    name: Optional[str] = None
    venue: Optional[str] = None
    capacity: Optional[int] = None
    instructions: Optional[str] = None
    start_time: Optional[str] = None

class WorkshopAssignVolunteerRequest(BaseModel):
    user_id: str
    role: str = "workshop_volunteer"
    scanning_enabled: bool = True
