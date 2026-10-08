"""QA #12: every datetime the backend returns must be timezone-aware UTC.

Regression: PyMongo/Motor return naive UTC datetimes on read, so a raw
``.isoformat()`` emitted suffix-less strings like
``2026-10-07T12:39:05.464000`` which browsers parse as *local* time (IST
shift of +5:30). ``to_public`` must attach UTC to naive values so the output
always carries ``+00:00`` (or ``Z``-equivalent offset).
"""

from datetime import datetime, timezone

from app.models import assessment as asm_models
from app.models import candidate as cand_models
from app.models import report as report_models
from app.models import template as template_models


def _naive():
    return datetime(2026, 10, 7, 12, 39, 5, 464000)  # no tzinfo, as pymongo returns


def _aware():
    return datetime(2026, 10, 7, 12, 39, 5, 464000, tzinfo=timezone.utc)


def _assert_utc_iso(value):
    assert isinstance(value, str), f"expected str, got {value!r}"
    assert value.endswith("+00:00"), f"missing UTC offset: {value!r}"


def test_candidate_to_public_naive_and_aware():
    for stamp in (_naive(), _aware()):
        out = cand_models.to_public({"createdAt": stamp, "updatedAt": stamp, "deletedAt": stamp})
        for key in ("createdAt", "updatedAt", "deletedAt"):
            _assert_utc_iso(out[key])
    # None / missing stay untouched (legacy docs).
    out = cand_models.to_public({})
    assert out.get("createdAt") is None and out.get("deletedAt") is None


def test_assessment_to_public_includes_nested_sync_state():
    stamp = _naive()
    out = asm_models.to_public({
        "createdAt": stamp, "updatedAt": stamp, "deactivatedAt": stamp,
        "startDate": stamp, "endDate": stamp,
        "syncState": {"state": "failed", "attemptedAt": stamp,
                      "syncedAt": stamp, "failedAt": stamp},
    })
    for key in ("createdAt", "updatedAt", "deactivatedAt", "startDate", "endDate"):
        _assert_utc_iso(out[key])
    for key in ("attemptedAt", "syncedAt", "failedAt"):
        _assert_utc_iso(out["syncState"][key])


def test_report_and_template_to_public():
    for stamp in (_naive(), _aware()):
        out = report_models.to_public(
            {"fetchedAt": stamp, "createdAt": stamp, "updatedAt": stamp})
        for key in ("fetchedAt", "createdAt", "updatedAt"):
            _assert_utc_iso(out[key])
        tout = template_models.to_public({"createdAt": stamp, "updatedAt": stamp})
        for key in ("createdAt", "updatedAt"):
            _assert_utc_iso(tout[key])


def test_candidate_create_roundtrip_is_tz_aware():
    """End-to-end through the service layer on mongomock (mirrors QA payload)."""
    import asyncio

    import mongomock_motor

    from app.services.candidate_service import CandidateService

    async def _flow():
        db = mongomock_motor.AsyncMongoMockClient()["t"]
        svc = CandidateService(db)
        created = await svc.create({
            "assessmentId": "JOB-1",
            "name": "QA Twelve",
            "email": "qa12@example.com",
            "startTime": "2026-10-07T12:36:00.000Z",
            "endTime": "2026-10-07T14:30:00.000Z",
        })
        for key in ("createdAt", "updatedAt"):
            _assert_utc_iso(created[key])
        # Stored window strings pass through verbatim (client-supplied Z kept).
        assert created["startTime"] == "2026-10-07T12:36:00.000Z"
        assert created["endTime"] == "2026-10-07T14:30:00.000Z"

    asyncio.get_event_loop().run_until_complete(_flow())
