"""FastAPI dependencies for authentication, authorization, and tenant isolation."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
import jwt

from ..config import settings
from ..db.mongodb import get_database
from .roles import Role, get_permissions_for_role
from .tokens import decode_access_token

security_bearer = HTTPBearer(auto_error=False)


def get_db() -> Any:
    """Return database connection or None if not configured."""
    if not settings.has_mongo:
        return None
    try:
        return get_database(settings.mongodb_uri, settings.mongodb_database)
    except Exception:
        return None


@dataclass(frozen=True)
class CurrentUser:
    """Authenticated user context attached to request."""
    user_id: str
    org_id: str
    role: str
    permissions: frozenset[str]
    session_id: str
    impersonating: str | None = None

    @property
    def is_super_admin(self) -> bool:
        return self.role == Role.SUPER_ADMIN.value


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(security_bearer),
    db: Any = Depends(get_db),
) -> CurrentUser:
    """Extract and validate the JWT Bearer token, returning the CurrentUser context."""
    if not credentials or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        payload = decode_access_token(credentials.credentials)
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.PyJWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user_id = payload.get("sub")
    org_id = payload.get("orgId")
    role = payload.get("role")
    session_id = payload.get("sessionId")
    impersonating = payload.get("impersonating")

    if not user_id or not org_id or not role:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token payload is incomplete",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # If DB is reachable, verify user is not disabled and session is not revoked
    if db is not None:
        try:
            # Check user status if record exists
            user = await db["users"].find_one({"userId": user_id})
            if user is not None and not user.get("isActive", True):
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="User account is inactive or disabled",
                    headers={"WWW-Authenticate": "Bearer"},
                )

            # Check session if session record exists
            if session_id:
                session = await db["sessions"].find_one({"sessionId": session_id})
                if session and session.get("revokedAt") is not None:
                    raise HTTPException(
                        status_code=status.HTTP_401_UNAUTHORIZED,
                        detail="Session has been revoked",
                        headers={"WWW-Authenticate": "Bearer"},
                    )
        except HTTPException:
            raise
        except Exception:
            pass

    perms = get_permissions_for_role(role)
    return CurrentUser(
        user_id=user_id,
        org_id=org_id,
        role=role,
        permissions=perms,
        session_id=session_id or "",
        impersonating=impersonating,
    )


def require_permission(permission: str) -> Callable[..., Any]:
    """Dependency factory checking that the user possesses a specific permission."""

    async def _dependency(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if current_user.is_super_admin:
            return current_user
        if permission not in current_user.permissions:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Forbidden: missing '{permission}' permission",
            )
        return current_user

    return _dependency


def require_super_admin(
    current_user: CurrentUser = Depends(get_current_user),
) -> CurrentUser:
    """Dependency verifying the caller is a super_admin."""
    if not current_user.is_super_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: super_admin privilege required",
        )
    return current_user


def sanitize_filter(filter_dict: dict[str, Any]) -> dict[str, Any]:
    """Prevent NoSQL injection by rejecting keys starting with $ or containing dots."""
    clean: dict[str, Any] = {}
    for k, v in filter_dict.items():
        if k.startswith("$") or "." in k:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid query parameter key '{k}'",
            )
        clean[k] = v
    return clean
