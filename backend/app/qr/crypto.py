from cryptography.fernet import Fernet, InvalidToken


class SecretEncryptionConfigurationError(RuntimeError):
    pass


class SecretDecryptionError(RuntimeError):
    pass


class SecretCipher:
    """Authenticated encryption for TOTP secrets stored in MongoDB."""

    def __init__(self, key: str | None) -> None:
        if key is None:
            raise SecretEncryptionConfigurationError(
                "QR_SECRET_ENCRYPTION_KEY is not configured."
            )
        try:
            self._fernet = Fernet(key)
        except (TypeError, ValueError) as exc:
            raise SecretEncryptionConfigurationError(
                "QR_SECRET_ENCRYPTION_KEY must be a valid Fernet key."
            ) from exc

    def encrypt(self, secret_base32: str) -> str:
        return self._fernet.encrypt(secret_base32.encode("ascii")).decode("ascii")

    def decrypt(self, ciphertext: str) -> str:
        try:
            plaintext = self._fernet.decrypt(ciphertext.encode("ascii"))
        except (InvalidToken, UnicodeEncodeError) as exc:
            raise SecretDecryptionError(
                "The stored QR secret cannot be decrypted."
            ) from exc
        try:
            return plaintext.decode("ascii")
        except UnicodeDecodeError as exc:
            raise SecretDecryptionError(
                "The stored QR secret cannot be decrypted."
            ) from exc
