"""Server-to-server PrimeHire assessment call (Slice 2A).

Secrets stay in the backend environment. The callable is injectable so tests
(and the Retry endpoint) can substitute a mock without touching the network.
"""

from __future__ import annotations

from typing import Any, Awaitable, Callable

import httpx

from ..config import settings
from .primehire_service import auth_headers, has_credentials, resolve_base_url


class PrimehireError(Exception):
    """PrimeHire call failed (credentials missing, rejected, or unreachable)."""

    def __init__(self, message: str, *, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


FetchFn = Callable[[str, dict[str, Any]], Awaitable[Any]]


async def _http_fetch(path: str, payload: dict[str, Any]) -> Any:
    if not has_credentials(settings.primehire_access_key, settings.primehire_secret_key):
        raise PrimehireError(
            "PrimeHire credentials are not configured on the server "
            "(PRIMEHIRE_ACCESS_KEY / PRIMEHIRE_SECRET_KEY). Add them and retry."
        )
    base = resolve_base_url(settings.primehire_base_url, "https://api.placement.vils.ai/primehire/api/v1")
    url = f"{base}{path}"
    headers = auth_headers(settings.primehire_access_key, settings.primehire_secret_key)
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(url, json=payload, headers=headers)
    except Exception as exc:  # noqa: BLE001 — network failure becomes failed state
        raise PrimehireError(f"PrimeHire unreachable: {type(exc).__name__}") from exc
    if response.status_code == 401:
        raise PrimehireError(
            "PrimeHire authentication failed (401). Verify PRIMEHIRE_ACCESS_KEY / "
            "PRIMEHIRE_SECRET_KEY in the server environment.",
            status=401,
        )
    if not response.ok:
        detail: str = response.text[:500]
        try:
            body = response.json()
            if isinstance(body, dict):
                detail = str(body.get("message") or body.get("detail") or body)[:500]
        except Exception:  # noqa: BLE001 — fall back to raw text
            pass
        raise PrimehireError(
            f"PrimeHire rejected the request ({response.status_code}): {detail}",
            status=response.status_code,
        )
    try:
        return response.json()
    except Exception:  # noqa: BLE001
        return {"raw": response.text[:2000]}


async def create_assessment_remote(
    payload: dict[str, Any], fetch: FetchFn | None = None
) -> Any:
    """POST /assessment on PrimeHire. Returns the decoded response."""
    do_fetch = fetch or _http_fetch
    return await do_fetch("/assessment", payload)
