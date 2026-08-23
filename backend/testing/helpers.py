"""
Shared test utilities: real tokens, real QR payloads, and controlled clocks.

Nothing here fakes application behaviour. Tokens are minted by the application's
own ``security.create_access_token``, and QR payloads are encrypted with the same
RSA-OAEP/SHA-256 scheme ``security.decrypt_qr_data`` decrypts, so a scan test
exercises the genuine cryptographic path rather than a stub.
"""
import base64
import json
from datetime import datetime, timedelta

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

from security import ACCESS_TOKEN_EXPIRE_MINUTES, create_access_token


# ---------------------------------------------------------------------------
# Tokens
# ---------------------------------------------------------------------------

def token_for(user_doc: dict, expires_minutes: int = None) -> str:
    """
    A real JWT for this document.

    The staff/participant decision is made the same way the application makes it
    (`auth.change_password`, `logger.actor_identity`): the presence of
    ``paradox_id`` on the document, not a flag the test passes in. That means a
    fixture cannot accidentally mint a participant token for a staff record.
    """
    if "paradox_id" in user_doc:
        subject, token_type = user_doc["paradox_id"], "staff"
    else:
        subject, token_type = user_doc["participant_id"], "participant"
    minutes = ACCESS_TOKEN_EXPIRE_MINUTES if expires_minutes is None else expires_minutes
    return create_access_token(
        data={"sub": subject, "type": token_type},
        expires_delta=timedelta(minutes=minutes),
    )


def bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def auth_headers(user_doc: dict, expires_minutes: int = None) -> dict:
    return bearer(token_for(user_doc, expires_minutes=expires_minutes))


def raw_token(subject, token_type: str, expires_minutes: int = 60) -> str:
    """A token with arbitrary claims, for the auth-dependency negative tests."""
    data = {"type": token_type}
    if subject is not None:
        data["sub"] = subject
    return create_access_token(data=data, expires_delta=timedelta(minutes=expires_minutes))


# ---------------------------------------------------------------------------
# QR payloads
# ---------------------------------------------------------------------------

def encrypt_for(public_key_pem: str, payload: dict) -> str:
    """The client side of `security.decrypt_qr_data` — genuine RSA-OAEP/SHA-256."""
    public_key = serialization.load_pem_public_key(public_key_pem.encode("utf-8"))
    ciphertext = public_key.encrypt(
        json.dumps(payload).encode("utf-8"),
        padding.OAEP(
            mgf=padding.MGF1(algorithm=hashes.SHA256()),
            algorithm=hashes.SHA256(),
            label=None,
        ),
    )
    return base64.b64encode(ciphertext).decode("utf-8")


def make_qr(
    participant,
    public_key_pem: str = None,
    payload: dict = None,
    age_seconds: float = 0.0,
    timestamp: str = None,
) -> dict:
    """
    A ``ScanQRRequest`` body for this participant.

    ``age_seconds`` backdates the timestamp, which is how the 60-second expiry in
    ``dependencies.verify_qr`` is tested without touching any clock: the guard
    compares ``utcnow() - qr_timestamp`` against 60 seconds, so a genuinely old
    timestamp is genuinely expired.

    ``participant`` may be the participant document or a bare id string; when it
    is a document the public key is taken from it.
    """
    if isinstance(participant, dict):
        identifier = participant["participant_id"]
        public_key_pem = public_key_pem or participant["qr_secrets"]["public_key"]
    else:
        identifier = participant

    if timestamp is None:
        moment = datetime.utcnow() - timedelta(seconds=age_seconds)
        timestamp = moment.isoformat() + "Z"

    body = payload if payload is not None else {"participant_id": identifier}
    return {
        "participant_id": identifier,
        "data": encrypt_for(public_key_pem, body),
        "timestamp": timestamp,
    }


def corrupt_qr(participant, timestamp: str = None) -> dict:
    """A well-formed request whose ciphertext cannot be decrypted."""
    identifier = participant["participant_id"] if isinstance(participant, dict) else participant
    return {
        "participant_id": identifier,
        "data": base64.b64encode(b"not-a-valid-ciphertext").decode("utf-8"),
        "timestamp": timestamp or (datetime.utcnow().isoformat() + "Z"),
    }


# ---------------------------------------------------------------------------
# Time
#
# The default approach across this suite is relative timestamps: a fixture builds
# times as `utcnow() ± delta`, so a window is genuinely open or genuinely shut and
# no clock is patched.
#
# `fake_datetime` exists for the handful of assertions that need an *exact*
# instant — a scan window's boundary minute, a day-bucket rollover at midnight.
# It subclasses `datetime` so `fromisoformat`, `min`, and arithmetic all keep
# working when a module's `datetime` name is swapped for it.
#
# Caution: `isinstance(real_datetime, fake_datetime(...))` is False, so it must
# not be used on modules that type-check datetimes — `routers.mess`
# (`_assert_mess_scan_window`), `routers.events` (`_serialise_announcement`), and
# `routers.audit` (`_iso_utc`) all do. Those are covered with relative times.
# ---------------------------------------------------------------------------

def fake_datetime(now: datetime):
    class _FrozenDateTime(datetime):
        @classmethod
        def utcnow(cls):
            return now

    return _FrozenDateTime


def freeze(monkeypatch, module, now: datetime):
    """Pin ``module.datetime.utcnow()`` to ``now`` for the duration of a test."""
    monkeypatch.setattr(module, "datetime", fake_datetime(now))
    return now


def iso(moment: datetime) -> str:
    """The ``...Z`` form the application's own request bodies use."""
    return moment.isoformat() + "Z"


def minutes_from_now(delta_minutes: float) -> datetime:
    return datetime.utcnow() + timedelta(minutes=delta_minutes)


def iso_from_now(delta_minutes: float) -> str:
    return iso(minutes_from_now(delta_minutes))
