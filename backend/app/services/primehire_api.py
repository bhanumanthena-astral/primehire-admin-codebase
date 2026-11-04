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


def parse_interview_record(data: Any, candidate_id: str | None = None) -> dict[str, Any] | None:
    """Read single or batched provider envelopes without mixing candidate links."""
    def records(value, inherited_candidate=None, depth=0):
        if depth > 8:
            return []
        if isinstance(value, list):
            return [record for entry in value for record in records(entry, inherited_candidate, depth+1)]
        if not isinstance(value, dict):
            return []
        owner = value.get('candidate_id') or value.get('candidateId') or inherited_candidate
        if candidate_id and owner and str(owner) != candidate_id:
            return []
        nested = []
        for field in ('data', 'interviews', 'candidates', 'results', 'interview', 'candidate', 'result'):
            if isinstance(value.get(field), (dict, list)):
                nested.extend(records(value[field], owner, depth+1))
        if nested:
            return nested
        link = _pick_first(value.get('url'), value.get('link'), value.get('interviewUrl'),
            value.get('interview_url'), value.get('interviewLink'), value.get('interview_link'))
        interview_id = _pick_first(value.get('interviewId'), value.get('interview_id'), value.get('id'))
        if not link and not interview_id:
            return []
        return [{'interviewId': str(interview_id or ''), 'link': str(link or ''),
            'password': _pick_first(value.get('password'), value.get('accessCode'), value.get('access_code')) or None,
            'responseId': _pick_first(value.get('responseId'), value.get('response_id')) or None,
            '_candidate': str(owner) if owner else None}]
    found = records(data)
    exact = [row for row in found if row['_candidate'] == candidate_id] if candidate_id else []
    selected = exact or found
    if len(selected) != 1:
        return None
    return {key: value for key, value in selected[0].items() if key != '_candidate'}


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
    from .assessment_management import provider_connection
    base, headers = provider_connection()
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
            record = parse_interview_record(body, candidate_id)
            if record and record["link"]:
                return record
            raise UpstreamError("Upstream answered without an interview link.")
        if _is_duplicate(resp.status_code, body):
            data = (body or {}).get("data", body or {}) if isinstance(body, dict) else {}
            adopted = parse_interview_record(body, candidate_id)
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
    from .report_normalize import deep_camel
    """GET /interview/:id/status → normalized submission flags."""
    from .assessment_management import provider_connection
    base, headers = provider_connection()
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
            data = deep_camel((resp.json() or {}).get("data", {}))
        except ValueError:
            data = {}
        flags = data.get("interviewStatus", data) if isinstance(data, dict) else {}
        return {
            "started": flags.get('isInterviewStarted') is True,
            "startedAt": flags.get('startedAt'),
            "submitted": bool(flags.get("isInterviewSubmitted", False)),
            "reportAvailable": bool(flags.get("isReportAvailable", False)),
            "submittedAt": flags.get("submittedAt"),
        }
    raise UpstreamError(f"Upstream status unavailable ({last_error}).")


async def get_report_envelope(*, interview_id: str, timeout_s: int = 60) -> dict[str, Any] | None:
    """GET /interview/:id/report → unwrapped data dict or None when not ready."""
    from .assessment_management import provider_connection
    base, headers = provider_connection()
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
