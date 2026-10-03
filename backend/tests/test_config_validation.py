"""Fail-fast production config validation (§2.7). Never logs or returns secrets."""

import pytest

from app.config import Settings, validate_settings


def _prod(**overrides):
    base = {
        "env": "production",
        "debug": False,
        "mongodb_uri": "mongodb://mongo:27017",
        "mongodb_database": "primehire",
        "jwt_secret": "x" * 32,
        "allowed_origins": "https://admin.example.com",
        "outbox_encryption_key": "dGVzdC1rZXktdGhhdC1pcy1hdC1sZWFzdC0zMi1jaGFycw==",
        "zeptomail_api_key": "test-zeptomail-key",
        "email_from_address": "noreply@example.com",
        "email_from_name": "PrimeHire Careers",
        "email_dry_run": False,
    }
    base.update(overrides)
    return Settings(**base)


def test_non_production_never_fails():
    validate_settings(Settings(env="local"))
    validate_settings(Settings(env="test"))
    validate_settings(Settings(env="development", debug=True))


def test_production_valid_passes():
    validate_settings(_prod())


def test_production_requires_mongodb_uri():
    with pytest.raises(RuntimeError, match="MONGODB_URI"):
        validate_settings(_prod(mongodb_uri="  "))


def test_production_rejects_weak_jwt():
    for weak in ("", "short", "changeme", "your_jwt_secret", "x" * 31):
        with pytest.raises(RuntimeError, match="JWT_SECRET"):
            validate_settings(_prod(jwt_secret=weak))


def test_production_rejects_wildcard_or_empty_origins():
    with pytest.raises(RuntimeError, match="ALLOWED_ORIGINS"):
        validate_settings(_prod(allowed_origins=""))
    with pytest.raises(RuntimeError, match="ALLOWED_ORIGINS"):
        validate_settings(_prod(allowed_origins="https://a.example.com, *"))


def test_production_rejects_debug():
    with pytest.raises(RuntimeError, match="DEBUG"):
        validate_settings(_prod(debug=True))


def test_error_message_names_variables_not_values():
    secret = "s3cr3t-weak-pw"
    assert len(secret) < 32  # ensure it actually fails the length rule
    with pytest.raises(RuntimeError) as exc:
        validate_settings(_prod(jwt_secret=secret, mongodb_uri=""))
    text = str(exc.value)
    assert "JWT_SECRET" in text and "MONGODB_URI" in text
    assert secret not in text
