"""Authentication and authorization dependencies for FastAPI.

Supports:
1. Cloudflare Access Zero Trust JWT (Cf-Access-Jwt-Assertion)
2. Admin Bearer / X-Admin-Key token for scripts, CI, and backend operations
3. Configurable test/local bypass via settings.disable_auth
"""

from __future__ import annotations

import logging
import time
from typing import Any

from fastapi import HTTPException, Request
import jwt
from jwt import PyJWKClient

from .config import settings

logger = logging.getLogger(__name__)

_jwks_client: PyJWKClient | None = None
_last_jwks_url: str = ""


def _get_jwks_client(certs_url: str) -> PyJWKClient:
    global _jwks_client, _last_jwks_url
    if _jwks_client is None or _last_jwks_url != certs_url:
        _jwks_client = PyJWKClient(certs_url, cache_jwk_set=True, lifespan=3600)
        _last_jwks_url = certs_url
    return _jwks_client


def verify_cloudflare_access_jwt(token: str) -> dict[str, Any]:
    """Verify a Cloudflare Access assertion token against Cloudflare's JWKS."""
    if not settings.cloudflare_access_team_domain or not settings.cloudflare_access_aud:
        raise HTTPException(
            status_code=500,
            detail="Cloudflare Access verification is not configured on the server",
        )

    team_domain = settings.cloudflare_access_team_domain.rstrip("/")
    if not team_domain.startswith("http"):
        team_domain = f"https://{team_domain}"

    certs_url = f"{team_domain}/cdn-cgi/access/certs"
    aud = settings.cloudflare_access_aud

    try:
        jwks_client = _get_jwks_client(certs_url)
        signing_key = jwks_client.get_signing_key_from_jwt(token)
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            audience=aud,
            options={"verify_exp": True},
        )
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Cloudflare Access token has expired") from None
    except jwt.InvalidTokenError as exc:
        logger.warning("Cloudflare Access JWT verification failed: %s", exc)
        raise HTTPException(status_code=403, detail="Invalid Cloudflare Access token") from None
    except Exception as exc:
        logger.error("Failed to fetch or process Cloudflare Access keys: %s", exc)
        raise HTTPException(status_code=502, detail="Failed to verify Cloudflare Access token") from None


def require_admin_auth(request: Request) -> dict[str, Any]:
    """FastAPI dependency to protect admin endpoints.

    Accepts:
    - Cf-Access-Jwt-Assertion header (validated via Cloudflare JWKS)
    - Authorization: Bearer <admin_api_key>
    - X-Admin-Key: <admin_api_key>
    - Bypassed only when settings.disable_auth is True
    """
    if settings.disable_auth:
        return {"sub": "anonymous-dev", "role": "admin"}

    # 1. Check Cloudflare Access JWT
    cf_token = request.headers.get("cf-access-jwt-assertion", "").strip()
    if cf_token:
        claims = verify_cloudflare_access_jwt(cf_token)
        return claims

    # 2. Check Admin Bearer token / X-Admin-Key
    auth_header = request.headers.get("authorization", "").strip()
    x_admin_key = request.headers.get("x-admin-key", "").strip()
    bearer_token = ""
    if auth_header.lower().startswith("bearer "):
        bearer_token = auth_header[7:].strip()

    provided_token = bearer_token or x_admin_key

    if settings.admin_api_key:
        if provided_token and provided_token == settings.admin_api_key:
            return {"sub": "admin-api-key", "role": "admin"}
        if provided_token:
            raise HTTPException(status_code=403, detail="Forbidden: Invalid admin token")

    # If no auth methods configured in dev/testing, allow with warning unless in production
    if not settings.cloudflare_access_aud and not settings.admin_api_key:
        # Auth not configured on this instance
        return {"sub": "unconfigured-instance", "role": "admin"}

    raise HTTPException(status_code=401, detail="Unauthorized: Authentication required")
