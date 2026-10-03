"""Tests for user model, sessions, login attempts, invitations, and MFA."""

from datetime import datetime, timedelta, timezone
import pytest
import mongomock_motor

from app.models.user import (
    UserRepository,
    SessionRepository,
    LoginAttemptRepository,
    InvitationRepository,
    to_public_user,
)
from app.security.mfa import (
    generate_totp_secret,
    verify_totp_code,
    encrypt_mfa_secret,
    decrypt_mfa_secret,
    generate_recovery_codes,
    verify_recovery_code,
    hash_recovery_code,
)
from app.security.tokens import hash_token
from app.config import settings


@pytest.fixture(autouse=True)
def setup_jwt_secret(monkeypatch):
    monkeypatch.setattr(settings, "jwt_secret", "test-secret-at-least-32-chars-long-abc-123")


@pytest.fixture()
def db():
    return mongomock_motor.AsyncMongoMockClient()["test_users_db"]


async def test_user_repository_crud(db):
    repo = UserRepository(db)
    user = await repo.create({
        "email": "  Test@example.com ",
        "name": "Test User",
        "role": "admin",
        "orgId": "org-1",
        "passwordHash": "$argon2id$mockhash",
        "mfa": {"enabled": False},
    })

    assert user["userId"]
    assert user["email"] == "test@example.com"
    assert user["isActive"] is True

    # Lookup by id
    by_id = await repo.get_by_id(user["userId"])
    assert by_id and by_id["email"] == "test@example.com"

    # Lookup by email
    by_email = await repo.get_by_email("TEST@EXAMPLE.COM")
    assert by_email and by_email["userId"] == user["userId"]

    # Public user strips passwordHash and mfa secrets
    pub = to_public_user(by_id)
    assert "passwordHash" not in pub
    assert "_id" not in pub
    assert pub["mfaEnabled"] is False

    # Update
    updated = await repo.update(user["userId"], {"name": "New Name"})
    assert updated["name"] == "New Name"

    # Org-scoped listing
    users = await repo.list_by_org("org-1")
    assert len(users) == 1
    assert users[0]["name"] == "New Name"

    # Delete
    deleted = await repo.delete(user["userId"])
    assert deleted is True
    assert await repo.get_by_id(user["userId"]) is None


async def test_session_repository(db):
    repo = SessionRepository(db)
    now = datetime.now(timezone.utc)
    expires = now + timedelta(days=7)

    sess = await repo.create_session(
        user_id="u-1",
        org_id="o-1",
        refresh_token_hash="hash-123",
        device_info="Mozilla/5.0",
        expires_at=expires,
    )
    assert sess["sessionId"]
    assert sess["revokedAt"] is None

    # Retrieve
    found = await repo.get_session(sess["sessionId"])
    assert found and found["userId"] == "u-1"

    # Revoke single
    assert await repo.revoke_session(sess["sessionId"]) is True
    revoked = await repo.get_session(sess["sessionId"])
    assert revoked["revokedAt"] is not None

    # Revoke all for user
    await repo.create_session(
        user_id="u-2",
        org_id="o-1",
        refresh_token_hash="hash-2",
        expires_at=expires,
    )
    await repo.create_session(
        user_id="u-2",
        org_id="o-1",
        refresh_token_hash="hash-3",
        expires_at=expires,
    )
    count = await repo.revoke_all_for_user("u-2")
    assert count == 2


async def test_login_attempts_and_lockout(db):
    repo = LoginAttemptRepository(db)
    key = "login:org-1:fail@test.com"

    # Not locked initially
    locked, _ = await repo.is_locked(key)
    assert not locked

    # 4 failures: not locked
    for i in range(4):
        attempts, lock_secs = await repo.record_failure(key)
        assert attempts == i + 1
        assert lock_secs == 0

    # 5th failure: locked for 15 minutes
    attempts, lock_secs = await repo.record_failure(key)
    assert attempts == 5
    assert lock_secs == 15 * 60

    locked, retry_after = await repo.is_locked(key)
    assert locked is True
    assert retry_after > 0

    # Reset
    await repo.reset(key)
    locked, _ = await repo.is_locked(key)
    assert not locked


async def test_invitations(db):
    repo = InvitationRepository(db)
    now = datetime.now(timezone.utc)
    tok_hash = hash_token("secret-invite-token")

    inv = await repo.create_invitation(
        user_id="u-invite",
        org_id="o-1",
        token_hash=tok_hash,
        kind="invite",
        created_by="admin-1",
        expires_at=now + timedelta(hours=24),
    )
    assert inv["usedAt"] is None

    # Fetch valid
    valid = await repo.get_valid(tok_hash, "invite")
    assert valid and valid["userId"] == "u-invite"

    # Wrong kind returns None
    assert await repo.get_valid(tok_hash, "password_reset") is None

    # Mark used
    assert await repo.mark_used(tok_hash) is True
    assert await repo.get_valid(tok_hash, "invite") is None


def test_mfa_totp_and_encryption():
    secret = generate_totp_secret()
    assert len(secret) >= 16

    # Encrypt and decrypt
    encrypted = encrypt_mfa_secret(secret)
    assert encrypted != secret
    decrypted = decrypt_mfa_secret(encrypted)
    assert decrypted == secret

    # Recovery codes
    codes = generate_recovery_codes(8)
    assert len(codes) == 8
    hashed_codes = [hash_recovery_code(c) for c in codes]

    # Verify matching code
    matched = verify_recovery_code(codes[0], hashed_codes)
    assert matched == hashed_codes[0]

    # Verify invalid code
    assert verify_recovery_code("BAD-CODE", hashed_codes) is None
