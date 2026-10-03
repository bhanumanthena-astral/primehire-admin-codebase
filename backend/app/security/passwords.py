"""Argon2id password hashing, verification, and policy enforcement."""

from __future__ import annotations

import re
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError, InvalidHashError

# Argon2id password hasher with secure defaults
_ph = PasswordHasher(
    time_cost=2,
    memory_cost=19456,  # 19 MiB
    parallelism=1,
    hash_len=32,
    salt_len=16,
)

MIN_PASSWORD_LENGTH = 12

# Common and weak passwords list to reject (§2.3 of DECISIONS.md)
COMMON_PASSWORDS = frozenset({
    "123456789012", "password1234", "password12345", "admin1234567",
    "administrator", "qwertyuiop12", "welcome12345", "changeme1234",
    "letmein12345", "primehire123", "primehireadmin", "superadmin123",
    "supersecret1", "correcthorsebatterystaple", "iloveyou1234",
    "trustnoone12", "dragon123456", "football1234", "monkey123456",
    "shadow123456", "master123456", "computer1234", "sunshine1234",
    "princess1234", "starwars1234", "charlie12345", "donald123456",
})


class PasswordPolicyError(ValueError):
    """Raised when a password fails policy checks."""


def validate_password_policy(password: str) -> None:
    """Validate that password meets length and complexity policy."""
    if not password or len(password) < MIN_PASSWORD_LENGTH:
        raise PasswordPolicyError(
            f"Password must be at least {MIN_PASSWORD_LENGTH} characters long"
        )
    if password.lower() in COMMON_PASSWORDS:
        raise PasswordPolicyError("Password is too common; please choose a stronger password")


def hash_password(password: str) -> str:
    """Hash password using Argon2id after validating policy."""
    validate_password_policy(password)
    return _ph.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    """Verify password against Argon2id hash. Returns False on mismatch/invalid format."""
    try:
        return _ph.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def needs_rehash(password_hash: str) -> bool:
    """Check if hash parameters are outdated and need rehashing."""
    try:
        return _ph.check_needs_rehash(password_hash)
    except Exception:
        return True
