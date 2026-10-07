"""Part A import-matching tests: normalized email, compound assessment key,
tester stamping, and the browser-export helpers (rehearsed on mongomock)."""

import json
import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS))

import import_browser_data as tool
from app.services import migration_service as mig


def _asm(job="JOB-X", rnd="TECHNICAL", title="T"):
    return {"jobId": job, "jobTitle": title, "jobDescription": "d",
            "language": "ENGLISH", "roundType": rnd,
            "questions": [{"id": "q1", "text": "Q?", "type": "SPEAK_TO_ANSWER",
                           "maxDuration": 60, "referenceAnswer": "r",
                           "maxScore": 100, "weightage": 100}]}


def _cand(key="CAND-1", job="JOB-X", email="a@x.com"):
    return {"id": key, "assessmentId": job, "name": "A", "email": email,
            "startTime": "2026-01-01T00:00:00Z", "endTime": "2026-01-05T00:00:00Z",
            "status": "ACTIVE"}


async def test_normalized_email_matches_case_variants(db):
    # No-linkage candidates import as mock; identical content under a
    # case-variant email must match (valid==0, no conflict), not double-add.
    await mig.run_import(db, {"assessments": [_asm()], "candidates": [_cand(email="Ada@X.com")],
                              "templates": []})
    report = await mig.dry_run(db, {"assessments": [], "candidates": [_cand(key="CAND-OTHER", email=" ada@x.com ")],
                                    "templates": []})
    assert report["candidates"]["mock"] == 1
    assert report["candidates"]["valid"] == 0
    assert report["candidates"]["conflicts"] == 0
    stored = await db["candidates"].find_one({})
    assert stored["email"] == "ada@x.com"  # normalized at import


async def test_same_job_different_round_is_new(db):
    await mig.run_import(db, {"assessments": [_asm(rnd="TECHNICAL")], "candidates": [], "templates": []})
    report = await mig.dry_run(db, {"assessments": [_asm(rnd="HR")] , "candidates": [], "templates": []})
    assert report["assessments"]["valid"] == 1
    same = await mig.dry_run(db, {"assessments": [_asm(rnd="TECHNICAL")], "candidates": [], "templates": []})
    assert same["assessments"]["duplicates"] == 1


async def test_tester_stamp_on_insert_only(db):
    res = await mig.run_import(db, {"assessments": [_asm()], "candidates": [_cand()],
                                    "templates": []}, tester="priya")
    assert res["assessments"]["inserted"] == 1
    stored_asm = await db["assessments"].find_one({})
    assert stored_asm["importedBy"] == "priya"
    assert stored_asm["origin"] == "local-import"
    stored_cand = await db["candidates"].find_one({})
    assert stored_cand["importedBy"] == "priya"
    # Re-import without tester stamps nothing new and inserts nothing.
    res2 = await mig.run_import(db, {"assessments": [_asm()], "candidates": [_cand()], "templates": []})
    assert res2["assessments"]["existing"] == 1
    assert (await db["assessments"].find_one({}))["importedBy"] == "priya"


def test_parse_raw_oneliner(tmp_path):
    payload = {"a": json.dumps([_asm()]), "c": json.dumps([_cand()])}
    p = tmp_path / "tester1.json"
    p.write_text(json.dumps(payload))
    tester, parsed = tool.parse_export_file(p)
    assert tester == "tester1"
    assert len(parsed["assessments"]) == 1 and len(parsed["candidates"]) == 1


def test_cross_tester_conflict_detection():
    recs = [("assessment", "ana", _asm(title="T1")), ("assessment", "ben", _asm(title="T2")),
            ("assessment", "ana", _asm(job="JOB-Y", title="Same")),
            ("candidate", "ana", _cand()),
            ("candidate", "ben", dict(_cand(key="CAND-2"), name="Different Name"))]
    conflicts = tool.detect_cross_tester(recs)
    kinds = {(c["kind"], c["key"]) for c in conflicts}
    assert ("assessment", "JOB-X||TECHNICAL") in kinds
    assert ("candidate", "JOB-X||a@x.com") in kinds
    assert len(conflicts) == 2


async def test_unmapped_reported_not_guessed(db):
    await db["assessments"].insert_one({"jobId": "JOB-X", "roundType": "TECHNICAL"})
    unmapped = await tool.find_unmapped(
        db, [_cand(job="JOB-X"), _cand(key="C2", job="JOB-GHOST", email="g@x.com")], set())
    assert len(unmapped) == 1 and unmapped[0]["assessmentId"] == "JOB-GHOST"
