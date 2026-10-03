"""Authentication endpoints: login, MFA, token rotation, logout, password management."""

from __future__ import annotations

from datetime import timedelta
import logging
from typing import Any

from fastapi import APIRouter, Cookie, Depends, Header, HTTPException, Request, Response, status

from ..config import settings
from ..security.deps import CurrentUser, get_current_user, require_super_admin, get_db
from ..models.organization import OrganizationRepository, DEFAULT_ORG_ID
from ..models.user import (
    UserRepository,
    SessionRepository,
    LoginAttemptRepository,
    InvitationRepository,
    to_public_user,
    utcnow,
)
from ..schemas.user import (
    LoginRequest,
    TokenResponse,
    MfaRequiredResponse,
    MfaVerifyRequest,
    MfaRecoveryRequest,
    MfaEnrollResponse,
    MfaConfirmRequest,
    MfaConfirmResponse,
    ChangePasswordRequest,
    ResetPasswordRequest,
    ResetPasswordConfirm,
    ViewAsRequest,
    SessionPublic,
    UserPublic,
)
from ..security.deps import CurrentUser, get_current_user, require_super_admin
from ..security.mfa import (
    generate_totp_secret,
    get_totp_uri,
    verify_totp_code,
    encrypt_mfa_secret,
    decrypt_mfa_secret,
    generate_recovery_codes,
    hash_recovery_code,
    verify_recovery_code,
)
from ..security.passwords import hash_password, verify_password, validate_password_policy
from ..security.rate_limit import limiter
from ..security.tokens import (
    create_access_token,
    create_mfa_token,
    decode_mfa_token,
    generate_opaque_token,
    hash_token,
    ACCESS_TOKEN_LIFETIME,
    REFRESH_TOKEN_LIFETIME,
    MFA_TOKEN_LIFETIME,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])

REFRESH_COOKIE_NAME = "primehire_refresh_token"


def _set_refresh_cookie(response: Response, refresh_token: str) -> None:
    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=refresh_token,
        httponly=True,
        secure=settings.is_production,
        samesite="lax",
        max_age=int(REFRESH_TOKEN_LIFETIME.total_seconds()),
        path="/api/auth",
    )


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(
        key=REFRESH_COOKIE_NAME,
        path="/api/auth",
        httponly=True,
        secure=settings.is_production,
        samesite="lax",
    )


@router.post("/login", response_model=TokenResponse | MfaRequiredResponse)
async def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: Any = Depends(get_db),
) -> Any:
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    client_ip = request.client.host if request.client else "unknown"
    rate_key = f"login:{client_ip}:{payload.email.strip().lower()}"
    limit_res = limiter.check(rate_key, max_requests=10, window_seconds=15 * 60)
    if not limit_res.allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed attempts. Please try again later.",
            headers={"Retry-After": str(limit_res.retry_after)},
        )

    user_repo = UserRepository(db)
    attempt_repo = LoginAttemptRepository(db)
    session_repo = SessionRepository(db)

    # Check lockout
    is_locked, retry_after = await attempt_repo.is_locked(rate_key)
    if is_locked:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Account locked due to consecutive failed attempts. Retry after {retry_after}s.",
            headers={"Retry-After": str(retry_after)},
        )

    user = await user_repo.get_by_email(payload.email, org_id=payload.orgId)
    # Timing-safe validation: generic error message
    if not user or not user.get("isActive", True):
        await attempt_repo.record_failure(rate_key)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    stored_hash = user.get("passwordHash", "")
    if not stored_hash or not verify_password(payload.password, stored_hash):
        await attempt_repo.record_failure(rate_key)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    # Success: reset attempts
    await attempt_repo.reset(rate_key)
    limiter.reset(rate_key)

    # Update lastLoginAt
    await user_repo.update(user["userId"], {"lastLoginAt": utcnow()})

    # Check MFA
    mfa_cfg = user.get("mfa") or {}
    if mfa_cfg.get("enabled"):
        mfa_tok = create_mfa_token(user_id=user["userId"], org_id=user["orgId"])
        return MfaRequiredResponse(
            mfaRequired=True,
            mfaToken=mfa_tok,
            expiresIn=int(MFA_TOKEN_LIFETIME.total_seconds()),
        )

    # Issue session & tokens
    refresh_token = generate_opaque_token()
    refresh_hash = hash_token(refresh_token)
    device_info = request.headers.get("user-agent", "")
    expires_at = utcnow() + REFRESH_TOKEN_LIFETIME

    session = await session_repo.create_session(
        user_id=user["userId"],
        org_id=user["orgId"],
        refresh_token_hash=refresh_hash,
        device_info=device_info,
        expires_at=expires_at,
    )

    access_token = create_access_token(
        user_id=user["userId"],
        org_id=user["orgId"],
        role=user["role"],
        session_id=session["sessionId"],
    )

    _set_refresh_cookie(response, refresh_token)
    return TokenResponse(
        accessToken=access_token,
        refreshToken=refresh_token,
        tokenType="bearer",
        expiresIn=int(ACCESS_TOKEN_LIFETIME.total_seconds()),
        user=UserPublic(**to_public_user(user)),
    )


@router.post("/mfa/verify", response_model=TokenResponse)
async def verify_mfa(
    payload: MfaVerifyRequest,
    request: Request,
    response: Response,
    db: Any = Depends(get_db),
) -> TokenResponse:
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    try:
        decoded = decode_mfa_token(payload.mfaToken)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired MFA token",
        )

    user_id = decoded["sub"]
    user_repo = UserRepository(db)
    session_repo = SessionRepository(db)

    user = await user_repo.get_by_id(user_id)
    if not user or not user.get("isActive", True):
        raise HTTPException(status_code=401, detail="User not found or inactive")

    mfa_cfg = user.get("mfa") or {}
    encrypted_secret = mfa_cfg.get("secretEncrypted")
    if not encrypted_secret:
        raise HTTPException(status_code=400, detail="MFA not properly configured")

    secret = decrypt_mfa_secret(encrypted_secret)
    if not verify_totp_code(secret, payload.code):
        # Also check recovery codes
        hashed_recovery = mfa_cfg.get("recoveryCodesHashed") or []
        matched_hash = verify_recovery_code(payload.code, hashed_recovery)
        if not matched_hash:
            raise HTTPException(status_code=401, detail="Invalid MFA code")
        # Consume recovery code
        remaining_hashes = [h for h in hashed_recovery if h != matched_hash]
        await user_repo.update(user_id, {"mfa.recoveryCodesHashed": remaining_hashes})

    # Issue session & tokens
    refresh_token = generate_opaque_token()
    refresh_hash = hash_token(refresh_token)
    device_info = request.headers.get("user-agent", "")
    expires_at = utcnow() + REFRESH_TOKEN_LIFETIME

    session = await session_repo.create_session(
        user_id=user["userId"],
        org_id=user["orgId"],
        refresh_token_hash=refresh_hash,
        device_info=device_info,
        expires_at=expires_at,
    )

    access_token = create_access_token(
        user_id=user["userId"],
        org_id=user["orgId"],
        role=user["role"],
        session_id=session["sessionId"],
    )

    _set_refresh_cookie(response, refresh_token)
    return TokenResponse(
        accessToken=access_token,
        refreshToken=refresh_token,
        tokenType="bearer",
        expiresIn=int(ACCESS_TOKEN_LIFETIME.total_seconds()),
        user=UserPublic(**to_public_user(user)),
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh_tokens(
    request: Request,
    response: Response,
    db: Any = Depends(get_db),
    primehire_refresh_token: str | None = Cookie(None),
) -> TokenResponse:
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    raw_token = primehire_refresh_token or request.headers.get("X-Refresh-Token")
    if not raw_token:
        raise HTTPException(status_code=401, detail="Refresh token required")

    incoming_hash = hash_token(raw_token)
    session = await db["sessions"].find_one({
        "refreshTokenHash": incoming_hash,
        "revokedAt": None,
    })
    if not session:
        _clear_refresh_cookie(response)
        raise HTTPException(status_code=401, detail="Invalid or revoked refresh token")

    exp = session.get("expiresAt")
    if exp:
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=utcnow().tzinfo)
        if utcnow() > exp:
            _clear_refresh_cookie(response)
            raise HTTPException(status_code=401, detail="Refresh token expired")

    user_repo = UserRepository(db)
    user = await user_repo.get_by_id(session["userId"])
    if not user or not user.get("isActive", True):
        _clear_refresh_cookie(response)
        raise HTTPException(status_code=401, detail="User account disabled")

    # Rotate refresh token
    new_refresh_token = generate_opaque_token()
    new_hash = hash_token(new_refresh_token)
    new_expires = utcnow() + REFRESH_TOKEN_LIFETIME

    await db["sessions"].update_one(
        {"sessionId": session["sessionId"]},
        {
            "$set": {
                "refreshTokenHash": new_hash,
                "expiresAt": new_expires,
                "updatedAt": utcnow(),
            }
        },
    )

    access_token = create_access_token(
        user_id=user["userId"],
        org_id=user["orgId"],
        role=user["role"],
        session_id=session["sessionId"],
    )

    _set_refresh_cookie(response, new_refresh_token)
    return TokenResponse(
        accessToken=access_token,
        refreshToken=new_refresh_token,
        tokenType="bearer",
        expiresIn=int(ACCESS_TOKEN_LIFETIME.total_seconds()),
        user=UserPublic(**to_public_user(user)),
    )


@router.post("/logout")
async def logout(
    response: Response,
    current_user: CurrentUser = Depends(get_current_user),
    db: Any = Depends(get_db),
) -> dict[str, bool]:
    if db is not None and current_user.session_id:
        repo = SessionRepository(db)
        await repo.revoke_session(current_user.session_id)
    _clear_refresh_cookie(response)
    return {"ok": True}


@router.post("/logout-all")
async def logout_all(
    response: Response,
    current_user: CurrentUser = Depends(get_current_user),
    db: Any = Depends(get_db),
) -> dict[str, int]:
    count = 0
    if db is not None:
        repo = SessionRepository(db)
        count = await repo.revoke_all_for_user(current_user.user_id)
    _clear_refresh_cookie(response)
    return {"revokedSessions": count}


@router.get("/me", response_model=UserPublic)
async def get_me(
    current_user: CurrentUser = Depends(get_current_user),
    db: Any = Depends(get_db),
) -> UserPublic:
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    user_repo = UserRepository(db)
    user = await user_repo.get_by_id(current_user.user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return UserPublic(**to_public_user(user))


@router.post("/change-password")
async def change_password(
    payload: ChangePasswordRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: Any = Depends(get_db),
) -> dict[str, bool]:
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    user_repo = UserRepository(db)
    user = await user_repo.get_by_id(current_user.user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if not verify_password(payload.oldPassword, user.get("passwordHash", "")):
        raise HTTPException(status_code=400, detail="Current password is incorrect")

    try:
        new_hash = hash_password(payload.newPassword)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    await user_repo.update(current_user.user_id, {"passwordHash": new_hash})
    # Revoke other sessions
    session_repo = SessionRepository(db)
    await db["sessions"].update_many(
        {"userId": current_user.user_id, "sessionId": {"$ne": current_user.session_id}},
        {"$set": {"revokedAt": utcnow()}},
    )
    return {"ok": True}


@router.post("/mfa/enroll", response_model=MfaEnrollResponse)
async def enroll_mfa(
    current_user: CurrentUser = Depends(get_current_user),
    db: Any = Depends(get_db),
) -> MfaEnrollResponse:
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    user_repo = UserRepository(db)
    user = await user_repo.get_by_id(current_user.user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    secret = generate_totp_secret()
    uri = get_totp_uri(secret, email=user["email"])
    return MfaEnrollResponse(secret=secret, qrUri=uri)


@router.post("/mfa/confirm", response_model=MfaConfirmResponse)
async def confirm_mfa(
    payload: MfaConfirmRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: Any = Depends(get_db),
) -> MfaConfirmResponse:
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    if not verify_totp_code(payload.secret, payload.code):
        raise HTTPException(status_code=400, detail="Invalid verification code")

    encrypted_secret = encrypt_mfa_secret(payload.secret)
    recovery_codes = generate_recovery_codes(8)
    recovery_hashes = [hash_recovery_code(c) for c in recovery_codes]

    user_repo = UserRepository(db)
    await user_repo.update(
        current_user.user_id,
        {
            "mfa": {
                "enabled": True,
                "secretEncrypted": encrypted_secret,
                "recoveryCodesHashed": recovery_hashes,
            }
        },
    )
    return MfaConfirmResponse(recoveryCodes=recovery_codes)


@router.post("/reset-password-request")
async def reset_password_request(
    payload: ResetPasswordRequest,
    db: Any = Depends(get_db),
) -> dict[str, str]:
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    user_repo = UserRepository(db)
    inv_repo = InvitationRepository(db)
    user = await user_repo.get_by_email(payload.email, org_id=payload.orgId)

    token = generate_opaque_token()
    if user:
        await inv_repo.create_invitation(
            user_id=user["userId"],
            org_id=user["orgId"],
            token_hash=hash_token(token),
            kind="password_reset",
            created_by="system",
            expires_at=utcnow() + timedelta(hours=2),
        )

    # Return resetUrl (simulated email delivery in Phase 1)
    return {
        "message": "If the account exists, a reset link has been issued.",
        "resetUrl": f"/reset-password?token={token}" if user else "",
    }


@router.post("/reset-password")
async def reset_password(
    payload: ResetPasswordConfirm,
    db: Any = Depends(get_db),
) -> dict[str, bool]:
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    inv_repo = InvitationRepository(db)
    inv = await inv_repo.get_valid(hash_token(payload.token), kind="password_reset")
    if not inv:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")

    try:
        new_hash = hash_password(payload.newPassword)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    user_repo = UserRepository(db)
    await user_repo.update(inv["userId"], {"passwordHash": new_hash})
    await inv_repo.mark_used(hash_token(payload.token))

    # Revoke all existing sessions for this user
    session_repo = SessionRepository(db)
    await session_repo.revoke_all_for_user(inv["userId"])
    return {"ok": True}


@router.post("/view-as")
async def view_as(
    payload: ViewAsRequest,
    super_admin: CurrentUser = Depends(require_super_admin),
    db: Any = Depends(get_db),
) -> dict[str, Any]:
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    user_repo = UserRepository(db)
    target = await user_repo.get_by_id(payload.targetUserId)
    if not target:
        raise HTTPException(status_code=404, detail="Target user not found")

    # Time-limited 30-minute impersonation token
    impersonation_token = create_access_token(
        user_id=super_admin.user_id,
        org_id=target["orgId"],
        role=target["role"],
        session_id=super_admin.session_id,
        impersonating=target["userId"],
        expires_delta=timedelta(minutes=30),
    )

    logger.info(
        "SuperAdmin %s impersonating user %s (%s). Reason: %s",
        super_admin.user_id,
        target["userId"],
        target["email"],
        payload.reason,
    )

    return {
        "accessToken": impersonation_token,
        "tokenType": "bearer",
        "expiresIn": 30 * 60,
        "impersonating": to_public_user(target),
    }


@router.get("/sessions", response_model=list[SessionPublic])
async def list_sessions(
    current_user: CurrentUser = Depends(get_current_user),
    db: Any = Depends(get_db),
) -> list[SessionPublic]:
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    session_repo = SessionRepository(db)
    docs = await session_repo.list_for_user(current_user.user_id)
    out = []
    for d in docs:
        out.append(
            SessionPublic(
                sessionId=d["sessionId"],
                createdAt=d["createdAt"],
                expiresAt=d["expiresAt"],
                deviceInfo=d.get("deviceInfo", ""),
                isCurrent=(d["sessionId"] == current_user.session_id),
            )
        )
    return out


@router.delete("/sessions/{session_id}")
async def revoke_session_by_id(
    session_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Any = Depends(get_db),
) -> dict[str, bool]:
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    session = await db["sessions"].find_one({"sessionId": session_id})
    if not session or session.get("userId") != current_user.user_id:
        raise HTTPException(status_code=404, detail="Session not found")

    session_repo = SessionRepository(db)
    await session_repo.revoke_session(session_id)
    return {"ok": True}
