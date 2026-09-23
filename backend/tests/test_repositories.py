"""Index creation + repository round-trips against in-memory Mongo."""

from app.db.mongodb import INDEXES, ensure_indexes
from app.models.assessment import AssessmentRepository
from app.models.candidate import CandidateRepository
from app.models.report import ReportRepository, to_document as report_doc


async def test_ensure_indexes_covers_all_collections(db):
    created = await ensure_indexes(db)
    assert set(created) == {"assessments", "candidates", "reports", "templates"}
    for coll, specs in INDEXES.items():
        assert len(created[coll]) == len(specs), coll


async def test_assessment_round_trip(db):
    repo = AssessmentRepository(db)
    stored = await repo.create(
        {"jobId": "JOB-1", "jobTitle": "Backend Dev", "roundType": "TECHNICAL", "questions": []}
    )
    assert stored["id"]
    assert stored["jobId"] == "JOB-1"
    assert "_id" not in stored
    assert await repo.get_by_job_id("JOB-1") is not None
    assert await repo.get_by_job_id("NOPE") is None


async def test_candidate_strips_password_and_row_loading(db):
    repo = CandidateRepository(db)
    stored = await repo.create(
        {
            "candidateKey": "CAND-1",
            "assessmentId": "JOB-1",
            "name": "A",
            "email": "a@x.com",
            "password": "SUPERSECRET",
            "rowLoading": True,
            "primehire": {"interviewId": "int-mock"},
        }
    )
    assert "password" not in stored
    assert "rowLoading" not in stored
    raw = await db["candidates"].find_one({})
    assert "password" not in raw


async def test_candidate_lookup_by_interview_id(db):
    repo = CandidateRepository(db)
    await repo.create(
        {
            "candidateKey": "CAND-9",
            "assessmentId": "JOB-1",
            "name": "B",
            "email": "b@x.com",
            "primehire": {"interviewId": "interview-123"},
        }
    )
    found = await repo.get_by_interview_id("interview-123")
    assert found and found["candidateKey"] == "CAND-9"


async def test_report_upsert_preserves_raw_verbatim(db):
    repo = ReportRepository(db)
    raw = {
        "interview_details": {"job_id": "JOB-1"},
        "faceapi_violations": {"tab_switching": 2},
        "report": {"overall_score": 77, "future_field_xyz": [1, 2, 3]},
        "question_wise_result": [{"id": "q1", "video_url": "https://cdn/x.webm"}],
    }
    stored = await repo.upsert_by_interview_id(report_doc(interview_id="iv-1", raw=raw))
    assert stored["raw"] == raw  # unknown fields preserved, nothing flattened
    assert stored["upstreamHash"]
    # Second upsert replaces (one report per interview), hash stable for same raw.
    stored2 = await repo.upsert_by_interview_id(report_doc(interview_id="iv-1", raw=raw))
    assert stored2["upstreamHash"] == stored["upstreamHash"]
    assert (await repo.get_by_interview_id("iv-1"))["id"] == stored2["id"]
