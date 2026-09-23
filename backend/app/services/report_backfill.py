"""Single-report backfill: PrimeHire GET -> validate -> normalize -> upsert.

Read-only toward PrimeHire (never generate-report, never mutate).
Fetch is injectable for tests; production path uses httpx.
"""

from __future__ import annotations

from typing import Any, Awaitable, Callable

from ..models.candidate import CandidateRepository
from ..models.report import ReportRepository, to_document, upstream_hash
from .report_normalize import (
    ReportValidationError,
    deep_camel,
    extract_candidate_uuid,
    extract_scores,
    extract_video_refs,
    utcnow_iso,
    validate_report_data,
)

FetchFn = Callable[[str], Awaitable[tuple[int, Any]]]


class UpstreamNotReady(Exception):
    """PrimeHire has no retrievable report for this interview (404/empty)."""


async def _httpx_fetch(base_url: str, headers: dict[str, str], interview_id: str) -> tuple[int, Any]:
    import httpx

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.get(f"{base_url.rstrip('/')}/interview/{interview_id}/report", headers=headers)
        try:
            body = resp.json()
        except Exception:  # noqa: BLE001
            body = None
        return resp.status_code, body


def _unwrap_data(body: Any) -> Any:
    """Accept {status,message,data} envelope or an already-unwrapped object."""
    if isinstance(body, dict) and "data" in body and isinstance(body, dict):
        return body.get("data")
    return body


async def backfill_interview_report(
    db: Any,
    interview_id: str,
    *,
    base_url: str = "",
    headers: dict[str, str] | None = None,
    fetch: FetchFn | None = None,
) -> dict[str, Any]:
    """Backfill ONE report. Returns a summary (never raises on not-ready)."""
    cand_repo = CandidateRepository(db)
    rep_repo = ReportRepository(db)

    candidate = await cand_repo.get_raw_by_interview_id(interview_id)
    if candidate is None:
        return {"interviewId": interview_id, "outcome": "candidate_not_found", "stored": False}
    if (candidate.get("syncState") or {}).get("reportStatus") != "GENERATED":
        return {"interviewId": interview_id, "outcome": "not_generated", "stored": False}

    do_fetch = fetch or (lambda iid: _httpx_fetch(base_url, headers or {}, iid))
    try:
        status_code, body = await do_fetch(interview_id)
    except Exception as exc:  # noqa: BLE001 — network failure is not-ready, not fatal
        return {"interviewId": interview_id, "outcome": "fetch_failed", "stored": False,
                "detail": type(exc).__name__}
    if status_code != 200 or body is None:
        return {"interviewId": interview_id, "outcome": "not_ready",
                "stored": False, "httpStatus": status_code}

    data = _unwrap_data(body)
    try:
        validate_report_data(data)
    except ReportValidationError as exc:
        return {"interviewId": interview_id, "outcome": "invalid_upstream",
                "stored": False, "detail": str(exc)[:200]}

    new_hash = upstream_hash(data)
    existing = await rep_repo.get_by_interview_id(interview_id)
    if (
        existing
        and existing.get("upstreamHash") == new_hash
        and existing.get("rawResponse") is not None
    ):
        return {"interviewId": interview_id, "outcome": "unchanged", "stored": True,
                "reportId": existing.get("id"), "upstreamHash": new_hash, "changed": False}
    envelope_backfill = bool(existing) and existing.get("rawResponse") is None

    fetched_at = utcnow_iso()
    normalized = deep_camel(data) if isinstance(data, dict) else {}
    stored = await rep_repo.upsert_by_interview_id(
        to_document(
            interview_id=interview_id,
            raw=data,  # exact upstream data payload, verbatim
            raw_response=body,  # complete upstream envelope, verbatim
            candidate_id=str(candidate["_id"]),
            assessment_id=candidate.get("assessmentId"),
            response_id=(candidate.get("primehire") or {}).get("responseId"),
            status="GENERATED",
            normalized=normalized,
            normalized_scores=extract_scores(normalized),
            video_refs=extract_video_refs(normalized, fetched_at),
        )
    )

    uuid_recovered = False
    genuine_uuid = extract_candidate_uuid(data if isinstance(data, dict) else {})
    if genuine_uuid:
        uuid_recovered = await cand_repo.set_uuid_if_absent(candidate["_id"], genuine_uuid)

    return {"interviewId": interview_id, "outcome": "stored", "stored": True,
            "reportId": stored.get("id"), "upstreamHash": new_hash,
            "changed": existing is not None and not envelope_backfill,
            "envelopeBackfilled": envelope_backfill,
            "uuidRecovered": uuid_recovered}
