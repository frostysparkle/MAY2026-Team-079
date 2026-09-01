"""
Keeping secrets and personal data out of the log files.

The log trail is written to disk, rotated, and read by whoever is debugging at
2am. That makes it a second copy of anything put into it, without any of the
protections the database has. So this module is the one place that decides what
may be written down, and `log_config` applies it to every record automatically
rather than trusting each call site to remember.

Three tools, for three different problems:

  * `redact` — for structured payloads. Anything keyed as a credential is
    replaced wholesale.
  * `fingerprint` — for values that must be *correlated* but never *stored*: a
    QR ciphertext, a bearer token. Two lines carrying the same fingerprint came
    from the same value, which is enough to spot a device replaying one QR or a
    single stolen token being reused, without the log holding the thing itself.
  * `safe_email` / `safe_str` — for personal data. An email is reduced to its
    local part, which for this fest's `@*.study.iitm.ac.in` addresses is the
    roll number: enough to identify a student to staff who already have their
    record, without writing a contactable address into a log file.

Dependency-free on purpose, for the same reason as `log_context`.
"""
import hashlib
from typing import Any, Dict, Iterable, Mapping, Optional

# Values under these keys are never written to a log, at any nesting depth.
# Matched case-insensitively, and by substring, so `password`, `password_hash`,
# `new_password`, and `hashed_password` are all caught by the one entry.
#
# `data` is here because that is the field name `ScanQRRequest` uses for the
# RSA-OAEP ciphertext, and `embedding` because a 2048-float vector is not a
# secret but would drown every other field in the line.
SENSITIVE_KEY_PARTS = (
    "password",
    "secret",
    "token",
    "authorization",
    "private_key",
    "public_key",
    "qr_secrets",
    "credential",
    "api_key",
    "apikey",
    "embedding",
)

# Keys whose value is replaced by a fingerprint rather than dropped, because the
# *sameness* of the value across two lines is itself the diagnostic.
FINGERPRINTED_KEY_PARTS = (
    "data",
    "ciphertext",
)

REDACTED = "[redacted]"

# How deep `redact` will walk before giving up. Log payloads in this codebase
# are shallow; the limit only exists so a cyclic or pathological structure
# cannot hang a log call.
_MAX_DEPTH = 6


def _is_sensitive(key: str) -> bool:
    lowered = key.lower()
    return any(part in lowered for part in SENSITIVE_KEY_PARTS)


def _is_fingerprinted(key: str) -> bool:
    lowered = key.lower()
    return any(part == lowered or lowered.endswith(f"_{part}") for part in FINGERPRINTED_KEY_PARTS)


def fingerprint(value: Any, length: int = 12) -> Optional[str]:
    """
    A stable, short, one-way label for a value that must not be logged.

    Same input always yields the same label, so occurrences can be correlated
    across lines and across days; the original cannot be recovered from it.
    Prefixed with `sha256:` so nobody later mistakes it for the value itself.
    """
    if value is None:
        return None
    if not isinstance(value, (str, bytes)):
        value = str(value)
    if isinstance(value, str):
        value = value.encode("utf-8", "replace")
    return "sha256:" + hashlib.sha256(value).hexdigest()[:length]


def safe_email(email: Optional[str]) -> Optional[str]:
    """
    `23f3001726@ds.study.iitm.ac.in` -> `23f3001726`.

    Deliberately the same transformation `logger.email_local_part` already
    applies for audit display names, so a log line and an audit row name a
    person the same way. Reimplemented here rather than imported, because
    `logger` imports `database` and this module must stay import-cycle-proof.
    """
    if not email or not isinstance(email, str):
        return None
    if "@" not in email:
        # Not an address. Could be an id passed into an email-shaped field —
        # `verify_qr` accepts either — so it is safe to keep as-is.
        return email.strip() or None
    local = email.split("@", 1)[0].strip()
    return local or None


def truncate(value: Any, limit: int = 300) -> Any:
    """
    Cap a long string so one field cannot swamp a log file.

    The tail is replaced with the number of characters dropped, so a truncated
    value is never mistaken for a short one.
    """
    if not isinstance(value, str) or len(value) <= limit:
        return value
    return f"{value[:limit]}…(+{len(value) - limit} chars)"


def redact(value: Any, _depth: int = 0) -> Any:
    """
    A copy of `value` safe to write to a log file.

    Walks mappings and sequences, replacing credential-keyed values with
    `[redacted]`, replacing ciphertext-keyed values with a fingerprint, and
    truncating long strings. Non-serialisable leaves (ObjectId, datetime) are
    left alone — the JSON formatter stringifies those, and turning them into
    strings here would make the console output uglier for no gain.

    Never raises. A logging helper that can throw is a logging helper that will
    eventually take down the request it was supposed to be describing, so the
    fallback is a description of the failure rather than an exception.
    """
    try:
        if _depth > _MAX_DEPTH:
            return "[truncated: too deep]"

        # Already reduced to a one-way label by a call site — `fingerprint` was
        # applied deliberately because correlating the value matters. Redacting it
        # again would replace a useful, already-safe label with `[redacted]` and
        # throw away the very thing it was computed for. Checked before the key
        # rules, since these live under exactly the key names those rules catch.
        if isinstance(value, str) and value.startswith("sha256:"):
            return value

        if isinstance(value, Mapping):
            cleaned: Dict[str, Any] = {}
            for key, item in value.items():
                name = str(key)
                if isinstance(item, str) and item.startswith("sha256:"):
                    cleaned[name] = item
                elif _is_sensitive(name):
                    cleaned[name] = REDACTED
                elif _is_fingerprinted(name):
                    cleaned[name] = fingerprint(item)
                else:
                    cleaned[name] = redact(item, _depth + 1)
            return cleaned

        if isinstance(value, (list, tuple, set, frozenset)):
            return [redact(item, _depth + 1) for item in value]

        return truncate(value)
    except Exception as exc:  # pragma: no cover - defensive
        return f"[unredactable: {type(exc).__name__}]"


def redact_headers(headers: Iterable) -> Dict[str, str]:
    """
    Request headers with `Authorization` and `Cookie` reduced to fingerprints.

    The fingerprint is kept rather than dropped so a token being reused from two
    different IPs is still visible in the trail.
    """
    cleaned: Dict[str, str] = {}
    try:
        items = headers.items() if hasattr(headers, "items") else headers
        for key, value in items:
            name = str(key).lower()
            if name in ("authorization", "cookie", "set-cookie", "x-api-key"):
                cleaned[name] = fingerprint(value) or REDACTED
            else:
                cleaned[name] = truncate(str(value), 200)
    except Exception as exc:  # pragma: no cover - defensive
        return {"[unredactable]": type(exc).__name__}
    return cleaned
