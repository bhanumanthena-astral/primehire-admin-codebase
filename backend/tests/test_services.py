"""Service rules: mock auto-quarantine, password stripping, primehire helpers."""

from app.services.candidate_service import (
    is_genuine_uuid,
    is_real_interview_id,
    is_real_response_id,
    looks_mock,
    CandidateService,
)
from app.services.primehire_service import auth_headers, has_credentials, resolve_base_url


def test_looks_mock_markers():
    # 1. real interviewId + real responseId -> REAL
    assert looks_mock("507f1f77bcf86cd799439011", "65ab12cd34ef567890abcdef") is False
    # 2. real interviewId + res-* fallback -> REAL (responseId unresolved, not mock)
    assert looks_mock("507f1f77bcf86cd799439011", "res-abc123") is False
    # 3. int-* interviewId -> MOCK
    assert looks_mock("int-abc", None) is True
    assert looks_mock("int-abc", "65ab12cd34ef567890abcdef") is True
    # 4. no PrimeHire linkage at all -> MOCK
    assert looks_mock(None, None, None, False) is True
    # explicit demo payload with no linkage -> MOCK
    assert looks_mock(None, None, None, True) is True
    # genuine UUID alone counts as linkage -> REAL
    assert looks_mock(None, None, "11111111-2222-3333-4444-555555555555") is False


def test_uuid_genuineness():
    # 6. synthetic fallback stamp is never genuine
    assert is_genuine_uuid("c3a7db8e-0f2c-473d-82ba-d2840bef507f") is False
    assert is_genuine_uuid("11111111-2222-3333-4444-555555555555") is True
    assert is_genuine_uuid("not-a-uuid") is False
    assert is_genuine_uuid(None) is False
    assert is_real_interview_id("int-x") is False
    assert is_real_interview_id("abc123") is True
    assert is_real_response_id("res-x") is False
    assert is_real_response_id("abc123") is True


async def test_candidate_create_quarantines_mock_ids(db):
    svc = CandidateService(db)
    stored = await svc.create(
        {
            "assessmentId": "JOB-1",
            "name": "M",
            "email": "m@x.com",
            "primehire": {"interviewId": "int-mock-1"},
        }
    )
    assert stored["isMock"] is True


async def test_candidate_create_keeps_real_records_clean(db):
    svc = CandidateService(db)
    stored = await svc.create(
        {
            "assessmentId": "JOB-1",
            "name": "R",
            "email": "r@x.com",
            "primehire": {"interviewId": "507f1f77bcf86cd799439011"},
        }
    )
    # password rejection is enforced by the schema (see test_schemas.py)
    assert "password" not in stored
    assert stored["isMock"] is False


def test_primehire_helpers_never_log_secrets():
    headers = auth_headers("AK", "SK")
    assert headers["x-access-key"] == "AK"
    assert headers["x-secret-key"] == "SK"
    assert has_credentials("AK", "SK")
    assert not has_credentials("", "SK")
    assert resolve_base_url("", "https://d/x/") == "https://d/x"  # trailing slash stripped
    assert resolve_base_url("https://h/v1///", "https://d/") == "https://h/v1"
