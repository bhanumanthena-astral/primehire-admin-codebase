"""Upstream PrimeHire interview calls (Slice C).

- Timeouts + retries with backoff/jitter on every call; metadata-only logs.
- NEVER fabricates links/credentials: upstream failure raises and the
  application keeps a visible failed state with a retry action.
- "Duplicate candidate" responses are adopted (reuse the existing
  interview) instead of rotating IDs blindly; anything else surfaces.
"""

from __future__ import annotations

import logging
import random
from typing import Any

import httpx

from ..config import settings
from .primehire_service import auth_headers, resolve_base_url

logger = logging.getLogger(__name__)

DEFAULT_BASE = "https://api.placement.vils.ai/primehire/api/v1"


class UpstreamError(Exception):
    """Upstream call failed (safe message, no PII)."""


class UpstreamDuplicate(Exception):
    """Upstream reports the candidate already has an interview.

    Carries `interview` (adopted interview record) when the response
    identifies one, else None (caller surfaces a clear error).
    """

    def __init__(self, message: str, interview: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.interview = interview


def _base_and_headers() -> tuple[str, dict[str, str]]:
    base = resolve_base_url(settings.primehire_base_url, DEFAULT_BASE)
    if not settings.has_primehire_credentials:
        raise UpstreamError("Upstream PrimeHire credentials are not configured.")
    return base, auth_headers(settings.primehire_access_key, settings.primehire_secret_key)


def _pick_first(*values: Any) -> Any:
    for v in values:
        if v:
            return v
    return None


def parse_interview_record(data: dict[str, Any]) -> dict[str, Any] | None:
    """Tolerant single-interview parser (mirrors the browser extractor)."""
    if not isinstance(data, dict):
        return None
    for key in ("interview", "candidate", "result"):
        inner = data.get(key)
        if isinstance(inner, dict) and (_pick_first(inner.get("id"), inner.get("interviewId"),
                                                    inner.get("url"), inner.get("link"))):
            data = inner
            break
    interview_id = _pick_first(data.get("id"), data.get("interviewId"), data.get("interview_id"))
    link = _pick_first(data.get("url"), data.get("link"), data.get("interviewUrl"),
                       data.get("interview_url"))
    if not interview_id and not link:
        return None
    return {
        "interviewId": str(interview_id or ""),
        "link": str(link or ""),
        "password": _pick_first(data.get("password"), data.get("accessCode"),
                                data.get("access_code")) or None,
        "responseId": _pick_first(data.get("responseId"), data.get("response_id")) or None,
    }


def _is_duplicate(status: int, body: Any) -> bool:
    text = ""
    if isinstance(body, dict):
        text = " ".join(str(v) for v in (body.get("message"), body.get("error"), body.get("detail")) if v)
    return status == 409 or "already" in text.lower() and "interview" in text.lower()


async def create_interview(
    *,
    job_id: str,
    round_type: str,
    candidate_id: str,
    start_time: str,
    end_time: str,
    timeout_s: int = 30,
) -> dict[str, Any]:
    """POST /interview. Returns parsed record or raises (never fabricates)."""
    base, headers = _base_and_headers()
    payload = {"job_id": job_id, "round_type": round_type,
               "candidates": [{"candidate_id": candidate_id,
                               "start_time": start_time, "end_time": end_time}]}
    last_error = "create failed"
    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=timeout_s) as client:
                resp = await client.post(f"{base}/interview", json=payload, headers=headers)
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            last_error = type(exc).__name__
            logger.warning("Upstream POST /interview attempt %d failed: %s", attempt + 1, last_error)
            await _sleep(attempt)
            continue
        try:
            body = resp.json()
        except ValueError:
            body = None
        logger.info("Upstream POST /interview attempt %d status=%s", attempt + 1, resp.status_code)
        if 200 <= resp.status_code < 300:
            record = parse_interview_record((body or {}).get("data", body or {}))
            if record and (record["interviewId"] or record["link"]):
                return record
            raise UpstreamError("Upstream answered without an interview link.")
        if _is_duplicate(resp.status_code, body):
            data = (body or {}).get("data", body or {}) if isinstance(body, dict) else {}
            adopted = parse_interview_record(data if isinstance(data, dict) else {})
            raise UpstreamDuplicate("Upstream reports an existing interview for this candidate.",
                                    adopted)
        if resp.status_code in (401, 403):
            raise UpstreamError("Upstream rejected the API credentials.")
        if 400 <= resp.status_code < 500:
            raise UpstreamError(f"Upstream refused the interview request ({resp.status_code}).")
        last_error = f"http_{resp.status_code}"
        await _sleep(attempt)
    raise UpstreamError(f"Upstream unavailable ({last_error}).")


async def get_interview_status(*, interview_id: str, timeout_s: int = 30) -> dict[str, Any]:
    """GET /interview/:id/status → normalized submission flags."""
    base, headers = _base_and_headers()
    last_error = "status failed"
    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=timeout_s) as client:
                resp = await client.get(f"{base}/interview/{interview_id}/status", headers=headers)
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            last_error = type(exc).__name__
            await _sleep(attempt)
            continue
        if resp.status_code != 200:
            last_error = f"http_{resp.status_code}"
            if 400 <= resp.status_code < 500:
                raise UpstreamError(f"Upstream status check refused ({resp.status_code}).")
            await _sleep(attempt)
            continue
        try:
            data = (resp.json() or {}).get("data", {})
        except ValueError:
            data = {}
        flags = data.get("interviewStatus", data) if isinstance(data, dict) else {}
        return {
            "submitted": bool(flags.get("isInterviewSubmitted", False)),
            "reportAvailable": bool(flags.get("isReportAvailable", False)),
            "submittedAt": flags.get("submittedAt"),
        }
    raise UpstreamError(f"Upstream status unavailable ({last_error}).")


async def get_report_envelope(*, interview_id: str, timeout_s: int = 60) -> dict[str, Any] | None:
    """GET /interview/:id/report → unwrapped data dict or None when not ready."""
    base, headers = _base_and_headers()
    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=timeout_s) as client:
                resp = await client.get(f"{base}/interview/{interview_id}/report", headers=headers)
        except (httpx.TimeoutException, httpx.TransportError):
            await _sleep(attempt)
            continue
        if resp.status_code != 200:
            if 400 <= resp.status_code < 500:
                return None
            await _sleep(attempt)
            continue
        try:
            body = resp.json()
        except ValueError:
            return None
        data = body.get("data", body) if isinstance(body, dict) else None
        return data if isinstance(data, dict) and data else None
    return None


async def _sleep(attempt: int) -> None:
    import asyncio

    await asyncio.sleep(min(30, 2 ** attempt) + random.uniform(0, 1))
