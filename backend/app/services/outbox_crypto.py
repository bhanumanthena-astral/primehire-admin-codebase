"""Fernet helpers for outbox bodies (invite passwords live here, briefly)."""

from __future__ import annotations

from cryptography.fernet import Fernet, InvalidToken

from ..config import settings


class OutboxCryptoError(Exception):
    """Key missing/invalid. Message names the variable, never the value."""


def _fernet() -> Fernet:
    key = (settings.outbox_encryption_key or "").strip()
    if not key:
        raise OutboxCryptoError("OUTBOX_ENCRYPTION_KEY is not configured.")
    try:
        return Fernet(key.encode())
    except (ValueError, TypeError) as exc:
        raise OutboxCryptoError("OUTBOX_ENCRYPTION_KEY is invalid.") from exc


def encrypt_body(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt_body(token: str) -> str:
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken as exc:
        raise OutboxCryptoError("Outbox body cannot be decrypted.") from exc
