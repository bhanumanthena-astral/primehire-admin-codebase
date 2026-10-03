"""Tests for Argon2id password hashing and password policy."""

import pytest
from app.security.passwords import (
    hash_password,
    verify_password,
    validate_password_policy,
    PasswordPolicyError,
    MIN_PASSWORD_LENGTH,
)


def test_hash_and_verify_success():
    pwd = "ValidSecurePassword123!"
    h = hash_password(pwd)
    assert h.startswith("$argon2id$")
    assert verify_password(pwd, h) is True
    assert verify_password("WrongPassword123!", h) is False


def test_password_too_short():
    with pytest.raises(PasswordPolicyError, match=f"at least {MIN_PASSWORD_LENGTH}"):
        validate_password_policy("short")


def test_common_password_rejected():
    with pytest.raises(PasswordPolicyError, match="too common"):
        validate_password_policy("password1234")


def test_invalid_hash_string():
    assert verify_password("ValidSecurePassword123!", "invalid_hash_string") is False
