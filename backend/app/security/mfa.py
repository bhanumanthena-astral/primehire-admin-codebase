"""Multi-factor authentication (TOTP + recovery codes) and secret encryption."""

from __future__ import annotations

import base64
import hashlib
import secrets
from typing import Sequence

from cryptography.fernet import Fernet
import pyotp

from ..config import settings


def _get_fernet() -> Fernet:
    """Derive Fernet cipher from settings.jwt_secret."""
    secret = (settings.jwt_secret or "insecure-default-dev-secret-do-not-use-in-prod").encode("utf-8")
    # Derive a 32-byte urlsafe-base64 key via SHA-256
    derived = hashlib.sha256(secret).digest()
    key = base64.urlsafe_b64encode(derived)
    return Fernet(key)


def encrypt_mfa_secret(secret: str) -> str:
    """Encrypt a TOTP base32 secret before persisting in MongoDB."""
    return _get_fernet().encrypt(secret.encode("utf-8")).decode("utf-8")


def decrypt_mfa_secret(encrypted: str) -> str:
    """Decrypt an encrypted TOTP base32 secret."""
    return _get_fernet().decrypt(encrypted.encode("utf-8")).decode("utf-8")


def generate_totp_secret() -> str:
    """Generate a new random base32 TOTP secret."""
    return pyotp.random_base32()


def get_totp_uri(secret: str, email: str, issuer_name: str = "PrimeHire") -> str:
    """Generate the otpauth:// URI for authenticator apps (QR code generation)."""
    return pyotp.totp.TOTP(secret).provisioning_uri(name=email, issuer_name=issuer_name)


def verify_totp_code(secret: str, code: str) -> bool:
    """Verify a 6-digit TOTP code against the secret (1-step window tolerance)."""
    if not code or not code.strip():
        return False
    totp = pyotp.totp.TOTP(secret)
    return bool(totp.verify(code.strip(), valid_window=1))


def generate_recovery_codes(count: int = 8) -> list[str]:
    """Generate user-facing recovery codes (format: xxxx-xxxx)."""
    codes = []
    for _ in range(count):
        part1 = secrets.token_hex(2)
        part2 = secrets.token_hex(2)
        codes.append(f"{part1}-{part2}".upper())
    return codes


def hash_recovery_code(code: str) -> str:
    """Hash a recovery code for storage."""
    clean = code.strip().replace("-", "").upper()
    return hashlib.sha256(clean.encode("utf-8")).hexdigest()


def verify_recovery_code(code: str, hashed_codes: Sequence[str]) -> str | None:
    """Verify code against list of hashes. Returns matching hash if valid, else None."""
    target_hash = hash_recovery_code(code)
    for stored in hashed_codes:
        if secrets.compare_digest(stored, target_hash):
            return stored
    return None
