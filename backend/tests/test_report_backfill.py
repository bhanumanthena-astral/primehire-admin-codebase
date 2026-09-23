"""Report backfill tests: normalization variants + service behavior (mocked fetch)."""

import pytest

from app.services.report_backfill import backfill_interview_report
from app.services.report_normalize import (
    ReportValidationError,
    deep_camel,
    extract_candidate_uuid,
    extract_scores,
    extract_video_refs,
    validate_report_data,
)

TECHNICAL_RAW = {
    "interview_details": {"job_id": "JOB-1", "candidate_id": "11111111-2222-3333-4444-555555555555",
                          "round_type": "TECHNICAL", "submitted_at": "2026-01-01"},
    "faceapi_violations": {"tab_switching": 1},
    "report": {
        "overall_result": {
            "technical_analysis": {"overall_score": 82, "custom_future_metric": 7},
            "communication_analysis": {"overall_score": 70, "fluency": 75, "grammar": 65,
                                       "pronunciation": 60, "vocabulary": 55},
            "interview_analysis": {"confidence_score": 68},
        },
        "question_wise_result": [
            {"id": "q1", "question": "Q?", "max_score": 20, "obtained_score": 18,
             "weightage": 100, "is_result_generated": True, "message": None,
             "video_url": "https://cdn/x.webm",
             "result": {"transcript": "hello world", "relevancy": "High"}},
        ],
    },
}

BASIC_RAW = {
    "interview_details": {"job_id": "JOB-2", "candidate_id": "22222222-2222-3333-4444-555555555555",
                          "round_type": "BASIC"},
    "report": {"overall_score": 74, "communication_analysis": {"overall_score": 71},
               "question_wise_result": []},
}

HR_RAW = {
    "interviewDetails": {"jobId": "JOB-3", "candidateId": "33333333-3333-3333-3333-333333333333",
                         "roundType": "HR"},
    "report": {"overallResult": {
        "personalityInsights": {"trait": "calm"},
        "communicationAnalysis": {"overallScore": 66},
        "interviewAnalysis": {"confidenceScore": 60},
        "hrCompetencyAnalysis": {"leadership": 8},
        "vilsCompetencyAnalysis": {"ownership": 9}},
        "questionWiseResult": []},
}


async def _seed_candidate(db, interview_id="iv-1", status="GENERATED"):
    await db["candidates"].insert_one(
        {"candidateKey": "CAND-1", "assessmentId": "JOB-1",
         "primehire": {"interviewId": interview_id, "responseId": None, "candidateUUID": None},
         "syncState": {"reportStatus": status}, "isMock": False}
    )


def _fetch_ok(raw):
    async def _f(interview_id):
        return 200, {"status": "SUCCESS", "data": raw}

    return _f


# 1/4. technical + snake_case
def test_technical_normalization_and_scores():
    n = deep_camel(TECHNICAL_RAW)
    assert n["interviewDetails"]["roundType"] == "TECHNICAL"
    assert n["report"]["overallResult"]["technicalAnalysis"]["customFutureMetric"] == 7  # 6. unknown kept
    s = extract_scores(n)
    assert (s["technical"], s["communication"], s["confidence"]) == (82, 70, 68)
    assert (s["fluency"], s["grammar"], s["pronunciation"], s["vocabulary"]) == (75, 65, 60, 55)


# 2. basic shape (top-level overallScore, no confidence)
def test_basic_shape():
    s = extract_scores(deep_camel(BASIC_RAW))
    assert s["technical"] == 74 and s["communication"] == 71 and s["confidence"] is None  # 8. nulls


# 3/5. HR camelCase passes through, HR-only blocks preserved, tech null
def test_hr_shape():
    n = deep_camel(HR_RAW)
    assert n["report"]["overallResult"]["hrCompetencyAnalysis"] == {"leadership": 8}
    assert n["report"]["overallResult"]["personalityInsights"] == {"trait": "calm"}
    s = extract_scores(n)
    assert s["technical"] is None and s["communication"] == 66 and s["confidence"] == 60


# 7. missing optionals OK
def test_missing_optionals_ok():
    validate_report_data({"interview_details": {}, "report": {}})
    validate_report_data({"report": {"question_wise_result": []}})


# 9. video extraction (metadata only)
def test_video_extraction():
    refs = extract_video_refs(deep_camel(TECHNICAL_RAW), "2026-01-02T00:00:00+00:00")
    assert refs == [{"questionId": "q1", "videoUrl": "https://cdn/x.webm",
                     "fetchedAt": "2026-01-02T00:00:00+00:00"}]
    assert extract_video_refs(deep_camel(BASIC_RAW), "t") == []


# 10. UUID extraction rules
def test_uuid_extraction():
    assert extract_candidate_uuid(TECHNICAL_RAW) == "11111111-2222-3333-4444-555555555555"
    assert extract_candidate_uuid(HR_RAW) == "33333333-3333-3333-3333-333333333333"
    assert extract_candidate_uuid({"interview_details": {"candidate_id": "c3a7db8e-0f2c-473d-82ba-x"}}) is None
    assert extract_candidate_uuid({"interview_details": {}}) is None
    assert extract_candidate_uuid({}) is None


# 11/12/13. store + responseId null + duplicate upsert + hash change
async def test_backfill_store_idempotent_and_update(db):
    await _seed_candidate(db)
    r1 = await backfill_interview_report(db, "iv-1", fetch=_fetch_ok(TECHNICAL_RAW))
    assert r1["outcome"] == "stored" and r1["stored"] is True
    stored = await db["reports"].find_one({})
    assert stored["responseId"] is None  # 11. never invented
    assert stored["candidateId"] is not None and stored["assessmentId"] == "JOB-1"
    assert stored["status"] == "GENERATED" and stored["source"] == "primehire"
    assert stored["raw"]["report"]["overall_result"]["technical_analysis"]["custom_future_metric"] == 7
    assert stored["normalizedScores"]["technical"] == 82
    assert len(stored["videoRefs"]) == 1
    assert stored["error"] is None and stored["upstreamHash"]
    # UUID recovered onto candidate (was null)
    cand = await db["candidates"].find_one({})
    assert cand["primehire"]["candidateUUID"] == "11111111-2222-3333-4444-555555555555"

    r2 = await backfill_interview_report(db, "iv-1", fetch=_fetch_ok(TECHNICAL_RAW))
    assert r2["outcome"] == "unchanged" and r2["changed"] is False  # 12. same hash
    assert await db["reports"].count_documents({}) == 1

    changed = dict(TECHNICAL_RAW)
    changed = {**changed, "report": {**changed["report"], "overall_result": {
        **changed["report"]["overall_result"],
        "technical_analysis": {"overall_score": 90}}}}
    r3 = await backfill_interview_report(db, "iv-1", fetch=_fetch_ok(changed))
    assert r3["outcome"] == "stored" and r3["changed"] is True  # 13. hash change updates
    assert await db["reports"].count_documents({}) == 1
    assert (await db["reports"].find_one({}))["normalizedScores"]["technical"] == 90


# 14. malformed upstream rejected, nothing stored
@pytest.mark.parametrize("bad", [
    None, [], "str", {},
    {"report": {"question_wise_result": {}}},  # not a list
    {"report": {"question_wise_result": [{"obtained_score": "high"}]}},  # non-numeric
    {"report": {"question_wise_result": [{"video_url": 123}]}},  # non-string URL
])
async def test_malformed_upstream(db, bad):
    await _seed_candidate(db)
    res = await backfill_interview_report(db, "iv-1", fetch=_fetch_ok(bad))
    assert res["outcome"] == "invalid_upstream" and res["stored"] is False
    assert await db["reports"].count_documents({}) == 0


# 15. 404 / not-ready / network failure -> no doc
async def test_not_ready_paths(db):
    await _seed_candidate(db)

    async def _404(iid):
        return 404, {"status": "ERROR", "message": "not ready"}

    async def _boom(iid):
        raise ConnectionError("down")

    assert (await backfill_interview_report(db, "iv-1", fetch=_404))["outcome"] == "not_ready"
    assert (await backfill_interview_report(db, "iv-1", fetch=_boom))["outcome"] == "fetch_failed"
    assert await db["reports"].count_documents({}) == 0


# Envelope preservation: rawResponse keeps the complete upstream envelope
async def test_envelope_preserved_verbatim(db):
    await _seed_candidate(db)
    envelope = {"status": "SUCCESS", "message": "done", "data": TECHNICAL_RAW,
                "extra_top_level": {"future": True}}

    async def _f(iid):
        return 200, envelope

    res = await backfill_interview_report(db, "iv-1", fetch=_f)
    assert res["outcome"] == "stored"
    stored = await db["reports"].find_one({})
    assert stored["rawResponse"] == envelope  # complete envelope, extras kept
    assert stored["raw"] == TECHNICAL_RAW  # unwrapped data payload
    assert stored["normalized"]["report"]["overallResult"]["technicalAnalysis"]["overallScore"] == 82


async def test_envelope_backfilled_onto_legacy_doc(db):
    await _seed_candidate(db)
    # Legacy doc without rawResponse (pre-patch shape)
    from app.models.report import to_document as _doc

    legacy = _doc(interview_id="iv-1", raw=TECHNICAL_RAW, candidate_id="c", assessment_id="JOB-1")
    legacy.pop("rawResponse", None)
    await db["reports"].insert_one(legacy)

    res = await backfill_interview_report(db, "iv-1", fetch=_fetch_ok(TECHNICAL_RAW))
    assert res["outcome"] == "stored" and res["envelopeBackfilled"] is True
    stored = await db["reports"].find_one({})
    assert stored["rawResponse"] == {"status": "SUCCESS", "data": TECHNICAL_RAW}
    assert stored["raw"] == TECHNICAL_RAW
    assert await db["reports"].count_documents({}) == 1


async def test_skips_non_generated_candidate(db):
    await _seed_candidate(db, status="GENERATING")
    res = await backfill_interview_report(db, "iv-1", fetch=_fetch_ok(TECHNICAL_RAW))
    assert res["outcome"] == "not_generated" and res["stored"] is False


async def test_candidate_not_found(db):
    res = await backfill_interview_report(db, "nope", fetch=_fetch_ok(TECHNICAL_RAW))
    assert res["outcome"] == "candidate_not_found" and res["stored"] is False


# 16. MongoDB failure surfaces (no silent partial state)
async def test_mongo_failure(db):
    class Broken:
        def __getattr__(self, _):
            raise ConnectionError("mongo down")

    await _seed_candidate(db)
    with pytest.raises(Exception):
        await backfill_interview_report(Broken(), "iv-1", fetch=_fetch_ok(TECHNICAL_RAW))
