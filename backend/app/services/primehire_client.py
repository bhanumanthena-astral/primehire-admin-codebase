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
    # NOTE: httpx.Response has no `.ok` (that is `requests`). Use `.is_success`.
    if not response.is_success:
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


async def check_upstream(fetch: FetchFn | None = None) -> int:
    """Live credential check: server-side GET /response/report-not-generated.

    Returns the upstream HTTP status ONLY (200 = keys accepted, 401 =
    rejected). Never returns bodies or keys — callers must only relay the
    status code. Raises PrimehireError when unreachable/misconfigured.
    """
    do_fetch = fetch or _http_get
    try:
        await do_fetch("/response/report-not-generated", {})
    except PrimehireError as exc:
        if exc.status is not None:
            return exc.status
        raise
    return 200


async def _http_get(path: str, _payload: dict[str, Any]) -> Any:
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
            response = await client.get(url, headers=headers)
    except Exception as exc:  # noqa: BLE001
        raise PrimehireError(f"PrimeHire unreachable: {type(exc).__name__}") from exc
    if response.status_code == 401:
        raise PrimehireError("PrimeHire rejected the keys (401).", status=401)
    # NOTE: httpx.Response has no `.ok` (that is `requests`). Use `.is_success`.
    if not response.is_success:
        raise PrimehireError(
            f"PrimeHire returned {response.status_code}.", status=response.status_code
        )
    return {"ok": True}


ReportFetchFn = Callable[[str], Awaitable[Any]]


async def _http_fetch_report(interview_id: str) -> Any:
    """Production GET /interview/{id}/report (server-to-server only)."""
    if not has_credentials(settings.primehire_access_key, settings.primehire_secret_key):
        raise PrimehireError(
            "PrimeHire credentials are not configured on the server "
            "(PRIMEHIRE_ACCESS_KEY / PRIMEHIRE_SECRET_KEY). Add them and retry."
        )
    base = resolve_base_url(settings.primehire_base_url, "https://api.placement.vils.ai/primehire/api/v1")
    url = f"{base}/interview/{interview_id}/report"
    headers = auth_headers(settings.primehire_access_key, settings.primehire_secret_key)
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(url, headers=headers)
    except httpx.TimeoutException as exc:
        raise PrimehireError("PrimeHire request timed out.", status=504) from exc
    except Exception as exc:  # noqa: BLE001 — DNS/refused/reset become 502
        raise PrimehireError(f"PrimeHire unreachable: {type(exc).__name__}", status=502) from exc
    if response.status_code == 401:
        raise PrimehireError("PrimeHire rejected the keys (401).", status=401)
    if response.status_code == 404:
        raise PrimehireError("PrimeHire has no report for this interview (404).", status=404)
    # NOTE: httpx.Response has no `.ok` (that is `requests`). Use `.is_success`.
    if not response.is_success:
        raise PrimehireError(
            f"PrimeHire returned {response.status_code}.", status=response.status_code
        )
    try:
        return response.json()
    except Exception as exc:  # noqa: BLE001 — non-JSON upstream is a 502
        raise PrimehireError("PrimeHire returned a non-JSON report.", status=502) from exc


async def fetch_interview_report(
    interview_id: str, fetch: ReportFetchFn | None = None
) -> Any:
    """GET /interview/{interview_id}/report on PrimeHire.

    Returns the decoded upstream JSON body verbatim (callers relay it to
    the authorized browser client). ``fetch`` is injectable so routes and
    tests can substitute a mock without touching the network. Raises
    PrimehireError with .status in {401, 404, 502, 504, ...}; messages
    never contain key material.
    """
    do_fetch = fetch or _http_fetch_report
    return await do_fetch(interview_id)
