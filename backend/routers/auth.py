"""
Authentication endpoints — registration, participant/staff login, and password
management. Extracted from main.py so all auth-focused routes live in one
file, matching the pattern already used by workshops, mess, events, etc.
"""
import logging

from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timedelta
import re

import log_config
from models import (
    RegisterRequest, LoginRequest, ForgotPasswordRequest,
    ResetPasswordRequest, ChangePasswordRequest
)
from dependencies import get_current_user
from database import participants_collection, backend_teams_collection
from log_redaction import safe_email
from logger import log_audit, log_denied
from security import (
    get_password_hash, verify_password, create_access_token,
    generate_rsa_key_pair, ACCESS_TOKEN_EXPIRE_MINUTES
)
from embedding_service import zero_embedding

router = APIRouter(prefix="/auth", tags=["Auth"])

_log = log_config.get_logger("paradox.auth")


def _log_failed_login(email: str, account_exists: bool, portal: str):
    """
    A failed sign-in attempt.

    This is the gap that mattered most in this file: both login routes answered a
    bad attempt with one 401 and recorded nothing at all. There was no way to
    answer "has someone been trying to get into the Super Admin account", and no
    way to help a volunteer who insisted they were typing the right password — the
    attempts they were making left no evidence they had happened.

    `account_exists` is written to the log but never to the response. The client
    keeps receiving one indistinguishable "Invalid credentials" for both an unknown
    email and a wrong password, because telling them apart is how an attacker
    enumerates valid accounts. In the log the distinction is exactly what is
    needed: a run of `wrong_password` against one real account is an intrusion
    attempt, while a run of `unknown_account` is a misconfigured client or a typo.

    The email is reduced to its local part — the roll number for a participant —
    so the trail identifies who was trying without recording a contactable
    address.
    """
    reason = "wrong_password" if account_exists else "unknown_account"
    log_denied(
        None,
        "LOGIN_FAILED",
        None,
        reason=reason,
        details={"email_local": safe_email(email), "portal": portal, "account_exists": account_exists},
    )


def normalise_email(email: str) -> str:
    """
    The canonical form of an address: stripped and lowercased.

    An email address is identity here. `participant_id` is *derived* from it by
    `generate_participant_id`, which lowercases before matching, and every roster,
    audit row, and QR payload joins on that id. So two addresses differing only in
    case are one person, and the system has to treat them as one.

    It did not. The domain check lowercased, but the duplicate check compared the
    raw string, so `A@ds.study.iitm.ac.in` registered happily alongside
    `a@ds.study.iitm.ac.in` — and both derived the identical `participant_id`, with
    no unique index anywhere to catch it. Every subsequent lookup by that id then
    resolved to whichever document Mongo returned first.

    Applied on the way in *and* on the way out: normalising only at registration
    would lock out every account already stored with mixed case, because the login
    lookups compare exactly.
    """
    return (email or "").strip().lower()


def _email_filter(email: str) -> dict:
    """
    A Mongo filter matching this address whatever case it was stored in.

    An anchored, escaped, case-insensitive regex rather than equality on the
    normalised string: documents written before normalisation may hold any casing, and
    those accounts must keep working. Anchored at both ends so `a@x.com` cannot match
    `xa@x.com`, and escaped because an address legitimately contains `.` and `+`.
    """
    return {"email": {"$regex": f"^{re.escape(normalise_email(email))}$", "$options": "i"}}


def generate_participant_id(email: str) -> str:
    """Extracts participant ID from IITM email. Ex: 23f3001726@ds.study.iitm.ac.in -> DS23F3001726"""
    match = re.match(r'^([^@]+)@([a-z]+)\.study\.iitm\.ac\.in$', email.lower())
    if match:
        roll_no = match.group(1).upper()
        program = match.group(2).upper()
        return f"{program}{roll_no}"
    return email.split('@')[0].upper()


@router.post("/register")
def register(request: RegisterRequest):
    email = normalise_email(request.email)

    # Enforce IITM email domain
    if not re.match(r'^[^@]+@[a-z]+\.study\.iitm\.ac\.in$', email):
        log_denied(
            None,
            "REGISTER_DENIED",
            None,
            reason="non_iitm_email",
            details={"email_local": safe_email(email)},
            audit=False,
        )
        raise HTTPException(status_code=400, detail="Must be an @*.study.iitm.ac.in email")

    # Matched case-insensitively, so an address already stored in mixed case is still
    # recognised as taken. `$options: "i"` rather than a plain equality test because
    # existing documents were written before normalisation and are not all lowercase.
    existing_participant = participants_collection.find_one(_email_filter(email))
    existing_staff = backend_teams_collection.find_one(_email_filter(email))
    if existing_participant or existing_staff:
        # Which collection already holds the address is the useful part: a
        # participant hitting this is somebody who forgot they had signed up,
        # while a *staff* address colliding here is a volunteer unable to create
        # the participant account that several roles require them to have.
        log_denied(
            None,
            "REGISTER_DENIED",
            None,
            reason="email_already_registered",
            details={
                "email_local": safe_email(email),
                "existing_as": "participant" if existing_participant else "staff",
            },
            audit=False,
        )
        raise HTTPException(status_code=400, detail="Email already registered")
    
    participant_id = generate_participant_id(email)
    hashed_password = get_password_hash(request.password)
    
    # Generate unique asymmetric keys for the user
    private_key, public_key = generate_rsa_key_pair()

    new_user = {
        "participant_id": participant_id,
        # Stored normalised, so the collection converges on one canonical form and a
        # unique index on this field is meaningful.
        "email": email,
        "password_hash": hashed_password,
        "profile": {},
        "mess": {
            "registered": False,
            "mess_id": None,
            # Scan markers keyed the same way as the hall's own `menu`
            # (`day_1`, `day_2`, ... -> `breakfast` | `lunch` | `dinner`).
            # Starts empty rather than pre-seeded: which days/slots exist is
            # entirely up to whichever hall this participant is later
            # allocated to, and that hall's own menu can change at any time.
            # `GET /mess/my_mess` derives the display list by merging this
            # against the allotted hall's current menu.
            "scans": {},
            # Set only by `POST /mess/pay` (mock settlement). Independent of
            # `registered`/`mess_id` — paying does not opt a participant into
            # allocation, and allocation does not require having paid.
            "payment": None
        },
        "accommodation": {
            "registered": False,
            "hostel_id": None,
            "room": None,
            # Stamped automatically on the participant's first-ever entry scan;
            # never overwritten after that. See `scan_hostel`.
            "arrival": None,
            # Flips with every entry/exit scan while `departure` is unset.
            "inside": False,
            # Stamped only by a "permanent_exit" scan — signals the participant
            # has left the fest for good and blocks any further entry scan.
            "departure": None,
            # Set only by `POST /hostels/pay` (mock settlement). Independent of
            # `registered`/`hostel_id`, same reasoning as `mess.payment`.
            "payment": None
        },
        "photo": None,
        "qr_secrets": {
            "private_key": private_key,
            "public_key": public_key
        },
        "embedding": {
            "workshop": zero_embedding(),
            "event": zero_embedding()
        },
        "events": [],
        "workshops": [],
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow()
    }
    
    participants_collection.insert_one(new_user)
    # The first event in any participant's history, and until now the only trace
    # of it was the document's own `created_at`. An audit row means the account's
    # creation sits in the same trail as everything the account later does.
    log_audit(
        new_user,
        "REGISTER",
        participant_id,
        {"email_local": safe_email(request.email), "program": participant_id[:2]},
    )
    return {"message": "Registration successful", "participant_id": participant_id}


@router.post("/login")
def login(request: LoginRequest):
    # Participant-only login. Matched case-insensitively, so a student who capitalises
    # their address on a phone keyboard reaches their own account rather than a 401.
    user = participants_collection.find_one(_email_filter(request.email))

    if not user or not verify_password(request.password, user.get("password_hash")):
        _log_failed_login(request.email, account_exists=bool(user), portal="participant")
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    user_id = user.get("participant_id")
    
    participants_collection.update_one(
        {"_id": user["_id"]}, 
        {"$set": {"updated_at": datetime.utcnow()}}
    )

    # Successful sign-ins are recorded as well as failed ones. Without them the
    # failures cannot be read in context: three refusals followed by a success is
    # somebody who mistyped their password, while three refusals and no success is
    # somebody locked out or somebody guessing.
    log_audit(
        user,
        "LOGIN",
        user_id,
        {"portal": "participant", "profile_complete": bool((user.get("profile") or {}).get("full_name"))},
    )
    
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user_id, "type": "participant"}, expires_delta=access_token_expires
    )
    
    profile = user.get("profile", {})
    return {
        "id": user_id,
        "email": user["email"],
        "access_token": access_token,
        "token_type": "participant",
        "full_name": profile.get("full_name"),
        "dob": profile.get("dob"),
        "house": profile.get("house"),
        "gender": profile.get("gender"),
        "phone": profile.get("phone"),
        "country": profile.get("country"),
        "state": profile.get("state"),
        "city": profile.get("city"),
        "address": profile.get("address"),
        "program": profile.get("program"),
        "course_stage": profile.get("course_stage"),
        "photo": user.get("photo"),
        "public_key": user.get("qr_secrets", {}).get("public_key")
    }


@router.post("/admin/login")
def admin_login(request: LoginRequest):
    # Backend staff-only login (Super Admins, Domain Admins, UHC, Event Heads, Volunteers, Guards, Employees)
    user = backend_teams_collection.find_one(_email_filter(request.email))

    if not user or not verify_password(request.password, user.get("password_hash")):
        _log_failed_login(request.email, account_exists=bool(user), portal="staff")
        raise HTTPException(status_code=401, detail="Invalid credentials")

    user_id = user.get("paradox_id")

    backend_teams_collection.update_one(
        {"_id": user["_id"]},
        {"$set": {"updated_at": datetime.utcnow()}}
    )

    # Staff sign-ins carry the role and department, because "which privileged
    # accounts were active during the window this went wrong" is the first
    # question asked of any staff-side incident.
    log_audit(
        user,
        "LOGIN",
        user_id,
        {"portal": "staff", "role": user.get("role"), "department": user.get("department")},
    )

    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user_id, "type": "staff"}, expires_delta=access_token_expires
    )

    return {
        "id": user_id,
        "email": user["email"],
        "access_token": access_token,
        "token_type": "staff",
        "role": user.get("role"),
        "department": user.get("department"),
        "designation": user.get("designation"),
    }


@router.post("/password/forgot")
def forgot_password(request: ForgotPasswordRequest):
    # Logged at WARNING despite returning 200, because this endpoint is a stub
    # that reports success without doing anything: no token is minted, nothing is
    # stored, no mail is sent. Anyone debugging "the reset link never arrived"
    # would otherwise find a successful request and no explanation — the most
    # expensive kind of silence, since the trail actively points away from the
    # cause.
    log_config.log_call(
        _log,
        logging.WARNING,
        "password reset requested against a stub endpoint — no email is sent and no token is issued",
        {
            "email_local": safe_email(request.email),
            "reason": "stub_endpoint",
            "endpoint": "/auth/password/forgot",
        },
    )
    return {
        "message": "If the account exists, a reset link has been sent.",
        "dev_reset_url": "http://localhost:5173/reset-password?token=mock_token_123"
    }


@router.post("/password/reset")
def reset_password(request: ResetPasswordRequest):
    # As above, and worse: this reports a password as changed while changing
    # nothing. A participant who "reset" their password and then cannot sign in is
    # the predictable outcome, and this line is what connects the two.
    log_config.log_call(
        _log,
        logging.WARNING,
        "password reset accepted by a stub endpoint — no password was changed",
        {"reason": "stub_endpoint", "endpoint": "/auth/password/reset"},
    )
    return {"message": "Password reset successfully."}


@router.post("/password/change")
def change_password(request: ChangePasswordRequest, current_user: dict = Depends(get_current_user)):
    is_staff = "paradox_id" in current_user
    user_id_field = "paradox_id" if is_staff else "participant_id"

    if not verify_password(request.current_password, current_user.get("password_hash")):
        log_denied(
            current_user,
            "PASSWORD_CHANGE_DENIED",
            current_user.get(user_id_field),
            reason="wrong_current_password",
            details={"account_type": "staff" if is_staff else "participant"},
        )
        raise HTTPException(status_code=400, detail="Incorrect current password")
    
    hashed_password = get_password_hash(request.new_password)
    
    collection = backend_teams_collection if is_staff else participants_collection
    
    collection.update_one(
        {"_id": current_user["_id"]},
        {"$set": {"password_hash": hashed_password, "updated_at": datetime.utcnow()}}
    )
    
    user_id = current_user[user_id_field]

    # A credential change, recorded. Never the password itself, in either form —
    # the fact and the time are the whole of what an audit trail needs, and are
    # what answers "was this account's password changed before the incident".
    log_audit(
        current_user,
        "PASSWORD_CHANGED",
        user_id,
        {"account_type": "staff" if is_staff else "participant", "token_reissued": True},
    )
    token_type = "staff" if is_staff else "participant"
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user_id, "type": token_type}, expires_delta=access_token_expires
    )
    
    return {
        "message": "Password changed successfully.",
        "access_token": access_token
    }
