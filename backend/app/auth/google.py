import asyncio
from dataclasses import dataclass
from typing import Any

from google.auth.exceptions import GoogleAuthError, TransportError
from google.auth.transport import requests
from google.oauth2 import id_token


class GoogleIdentityError(ValueError):
    pass


class GoogleAccountNotAllowedError(GoogleIdentityError):
    pass


class GoogleIdentityUnavailableError(RuntimeError):
    pass


class GoogleIdentityConfigurationError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class GoogleIdentity:
    subject: str
    email: str
    hosted_domain: str
    name: str | None


def validate_google_claims(
    claims: dict[str, Any], allowed_domains: tuple[str, ...]
) -> GoogleIdentity:
    subject = claims.get("sub")
    email = claims.get("email")
    hosted_domain = claims.get("hd")

    if not isinstance(subject, str) or not subject:
        raise GoogleIdentityError("Google did not provide an account identifier.")
    if claims.get("email_verified") is not True:
        raise GoogleAccountNotAllowedError(
            "The Google account email is not verified."
        )
    if not isinstance(email, str) or "@" not in email:
        raise GoogleIdentityError("Google did not provide a valid email address.")
    if not isinstance(hosted_domain, str):
        raise GoogleAccountNotAllowedError(
            "The account is not managed by an allowed IITM domain."
        )

    normalized_email = email.strip().casefold()
    email_domain = normalized_email.rsplit("@", 1)[1]
    normalized_hosted_domain = hosted_domain.strip().casefold()
    normalized_allowed_domains = {domain.casefold() for domain in allowed_domains}

    if (
        email_domain not in normalized_allowed_domains
        or normalized_hosted_domain not in normalized_allowed_domains
    ):
        raise GoogleAccountNotAllowedError("Use an allowed IITM Google account.")

    name = claims.get("name")
    normalized_name = name.strip() if isinstance(name, str) and name.strip() else None
    return GoogleIdentity(
        subject=subject,
        email=normalized_email,
        hosted_domain=normalized_hosted_domain,
        name=normalized_name,
    )


class GoogleTokenVerifier:
    def __init__(self, client_id: str | None, allowed_domains: tuple[str, ...]) -> None:
        self._client_id = client_id
        self._allowed_domains = allowed_domains
        self._request = requests.Request()

    async def verify(self, credential: str) -> GoogleIdentity:
        if self._client_id is None:
            raise GoogleIdentityConfigurationError("GOOGLE_CLIENT_ID is not configured.")

        try:
            claims = await asyncio.to_thread(
                id_token.verify_oauth2_token,
                credential,
                self._request,
                self._client_id,
            )
        except TransportError as exc:
            raise GoogleIdentityUnavailableError(
                "Google identity verification is temporarily unavailable."
            ) from exc
        except (ValueError, GoogleAuthError) as exc:
            raise GoogleIdentityError("The Google credential is invalid or expired.") from exc

        return validate_google_claims(claims, self._allowed_domains)
