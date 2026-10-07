"""One-time browser-localStorage import tool (Part A).

Reads tester export files, DRY-RUNs by default, writes only with --apply.
Rehearse on primehire_dev: set BACKEND_ENV_FILE=.env.dev (see
backend/.env.dev.example). Writes to primehire_admin require --confirm-prod
AND print an Atlas-snapshot reminder; default is dry-run.

Tester file formats accepted:
  1. {"tester": "name", "assessments": [...], "candidates": [...], "templates": [...]}
  2. Raw Console one-liner: {"a": "<assessments JSON string>", "c": "<candidates JSON string>"}
     (file name minus extension is used as the tester name).

Matching: assessments on jobId + roundType, candidates on assessmentId +
normalized email (see migration_service). Cross-tester duplicates (same key,
different content under different testers) and unmapped candidates
(assessmentId matches no assessment in DB or payload) are REPORTED and
SKIPPED on --apply — never guessed.

Usage (from backend/, backend\\.venv):
    .\\.venv\\Scripts\\python -m scripts.import_browser_data exports\\*.json
    .\\.venv\\Scripts\\python -m scripts.import_browser_data exports\\*.json --apply
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import settings  # noqa: E402
from app.db.mongodb import get_database  # noqa: E402
from app.services import migration_service as mig  # noqa: E402


def parse_export_file(path: Path) -> tuple[str, dict[str, Any]]:
    """Return (tester, payload). Never raises on shape; raises on bad JSON."""
    raw = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(raw, dict) and ("assessments" in raw or "candidates" in raw or "templates" in raw):
        tester = str(raw.get("tester") or path.stem)
        return tester, {
            "assessments": raw.get("assessments") or [],
            "candidates": raw.get("candidates") or [],
            "templates": raw.get("templates") or [],
        }
    if isinstance(raw, dict) and ("a" in raw or "c" in raw):
        assessments = json.loads(raw["a"]) if raw.get("a") else []
        candidates = json.loads(raw["c"]) if raw.get("c") else []
        return path.stem, {
            "assessments": assessments or [],
            "candidates": candidates or [],
            "templates": [],
        }
    raise ValueError(f"{path}: unrecognized export format (need assessments/candidates keys or a/c one-liner)")


def _asm_key(a: Any) -> str | None:
    if not isinstance(a, dict):
        return None
    job = a.get("jobId") or a.get("job_id")
    rnd = a.get("roundType") or a.get("round_type") or ""
    return f"{job}||{rnd}" if job else None


def _cand_key(c: Any) -> str | None:
    if not isinstance(c, dict):
        return None
    aid = c.get("assessmentId")
    email = mig._norm_email(c.get("email"))
    return f"{aid}||{email}" if aid and email else None


def detect_cross_tester(records: list[tuple[str, str, Any]]) -> list[dict[str, Any]]:
    """Same match-key under different testers with different content.

    `records` = [(kind, tester, raw)]. Returns conflict entries; identical
    content across testers is fine (idempotent, attributed to the first).
    """
    seen: dict[str, tuple[str, str]] = {}
    conflicts: list[dict[str, Any]] = []
    for kind, tester, raw in records:
        key = _asm_key(raw) if kind == "assessment" else _cand_key(raw)
        if not key:
            continue
        canon = mig.canonical(raw if isinstance(raw, dict) else {"v": raw})
        map_key = f"{kind}:{key}"
        if map_key in seen:
            prev_tester, prev_canon = seen[map_key]
            if prev_tester != tester and prev_canon != canon:
                conflicts.append({
                    "kind": kind, "key": key,
                    "testers": sorted({prev_tester, tester}),
                    "reason": "Same identifier exported by two testers with different content",
                })
        else:
            seen[map_key] = (tester, canon)
    return conflicts


async def find_unmapped(db: Any, candidates: list[Any], payload_asm_keys: set[str]) -> list[dict[str, Any]]:
    """Candidates whose assessmentId matches no assessment (DB or payload)."""
    if not candidates:
        return []
    db_ids: set[str] = set()
    cursor = db["assessments"].find({"deletedAt": None}, {"jobId": 1})
    async for doc in cursor:
        if doc.get("jobId"):
            db_ids.add(str(doc["jobId"]))
    # Legacy docs without the field also count (missing == not deleted).
    cursor = db["assessments"].find({"deletedAt": {"$exists": False}}, {"jobId": 1})
    async for doc in cursor:
        if doc.get("jobId"):
            db_ids.add(str(doc["jobId"]))
    known = db_ids | {k.split("||")[0] for k in payload_asm_keys}
    unmapped = []
    for c in candidates:
        if not isinstance(c, dict):
            continue
        aid = c.get("assessmentId")
        if aid and str(aid) not in known:
            unmapped.append({
                "candidateKey": c.get("id"),
                "email": c.get("email"),
                "assessmentId": aid,
            })
    return unmapped


async def dry_run_all(db: Any, files: list[Path]) -> dict[str, Any]:
    """Per-tester dry runs + merged cross-tester + unmapped analysis."""
    per_tester: dict[str, Any] = {}
    merged_payload: dict[str, list] = {"assessments": [], "candidates": [], "templates": []}
    tagged: list[tuple[str, str, Any]] = []
    for path in files:
        tester, payload = parse_export_file(path)
        summary = await mig.dry_run(db, payload, tester=tester)
        per_tester[tester] = {"file": str(path), "summary": summary}
        for kind in ("assessments", "candidates", "templates"):
            for raw in payload.get(kind) or []:
                tagged.append((kind.rstrip("s"), tester, raw))
                merged_payload[kind].append(raw)
    payload_asm_keys = {k for k, t, r in tagged if k == "assessment" and (_asm_key(r) or "")}
    payload_asm_keys = {k for k in payload_asm_keys if k}
    unmapped = await find_unmapped(db, merged_payload["candidates"], payload_asm_keys)
    return {
        "perTester": per_tester,
        "crossTesterConflicts": detect_cross_tester(tagged),
        "unmappedCandidates": unmapped,
        "totals": {k: len(v) for k, v in merged_payload.items()},
    }


async def apply_all(db: Any, files: list[Path]) -> dict[str, Any]:
    """Idempotent write path. Skips cross-tester conflicts + unmapped."""
    report = await dry_run_all(db, files)
    conflict_keys = {(c["kind"], c["key"]) for c in report["crossTesterConflicts"]}
    unmapped_ids = {(u.get("candidateKey"), u.get("email")) for u in report["unmappedCandidates"]}
    applied: dict[str, Any] = {"testers": {}, "skippedConflicts": 0, "skippedUnmapped": 0}
    for path in files:
        tester, payload = parse_export_file(path)
        clean: dict[str, list] = {"assessments": [], "candidates": [], "templates": []}
        for raw in payload.get("assessments") or []:
            k = _asm_key(raw)
            if k and ("assessment", k) in conflict_keys:
                applied["skippedConflicts"] += 1
                continue
            clean["assessments"].append(raw)
        for raw in payload.get("candidates") or []:
            k = _cand_key(raw)
            if k and ("candidate", k) in conflict_keys:
                applied["skippedConflicts"] += 1
                continue
            if isinstance(raw, dict) and (raw.get("id"), raw.get("email")) in unmapped_ids:
                applied["skippedUnmapped"] += 1
                continue
            clean["candidates"].append(raw)
        clean["templates"] = payload.get("templates") or []
        applied["testers"][tester] = await mig.run_import(db, clean, tester=tester)
    return {"dryRunReport": report, "applied": applied}


def _print_report(report: dict[str, Any]) -> None:
    print("=== DRY RUN ===")
    for tester, info in report["perTester"].items():
        s = info["summary"]
        print(f"-- tester: {tester} ({info['file']})")
        for section in ("assessments", "candidates", "templates"):
            sec = s[section]
            print(f"   {section}: total={sec.get('total', sec.get('received'))} "
                  f"valid={sec.get('valid', sec.get('inserted'))} "
                  f"duplicates={sec.get('duplicates', sec.get('existing'))} "
                  f"conflicts={sec.get('conflicts')} invalid={sec.get('invalid')}")
        for c in s["conflicts"][:10]:
            print(f"   conflict: {c}")
        for e in s["errors"][:10]:
            print(f"   error: {e}")
    print(f"cross-tester conflicts: {len(report['crossTesterConflicts'])}")
    for c in report["crossTesterConflicts"]:
        print(f"   {c}")
    print(f"unmapped candidates: {len(report['unmappedCandidates'])} (manual review, never guessed)")
    for u in report["unmappedCandidates"][:20]:
        print(f"   {u}")
    print(f"totals: {report['totals']}")


async def main() -> int:
    parser = argparse.ArgumentParser(description="Import tester browser exports (dry-run by default).")
    parser.add_argument("files", nargs="+", help="Tester export JSON files.")
    parser.add_argument("--db", default=None, help="Target database (default: settings MONGODB_DATABASE).")
    parser.add_argument("--apply", action="store_true", help="Write (default is dry-run).")
    parser.add_argument("--yes", action="store_true", help="Skip the interactive confirmation.")
    parser.add_argument("--confirm-prod", action="store_true",
                        help="Required when target is primehire_admin.")
    args = parser.parse_args()

    if not settings.has_mongo:
        print("MONGODB_URI not configured. Aborting.")
        return 2
    target = args.db or settings.mongodb_database
    db = get_database(settings.mongodb_uri, target)
    paths = [Path(f) for f in args.files]
    missing = [str(p) for p in paths if not p.exists()]
    if missing:
        print(f"Missing files: {missing}")
        return 2

    if not args.apply:
        _print_report(await dry_run_all(db, paths))
        print("\nDry run only — nothing written. Re-run with --apply to write.")
        return 0

    if target == "primehire_admin" and not args.confirm_prod:
        print("Refusing to write primehire_admin without --confirm-prod. Aborting.")
        return 2
    print("!!! About to WRITE to database "
          f"'{target}'. Take an Atlas snapshot first if this is production. !!!")
    if not args.yes:
        answer = input("Type YES to continue: ").strip()
        if answer != "YES":
            print("Aborted.")
            return 3
    result = await apply_all(db, paths)
    _print_report(result["dryRunReport"])
    for tester, summary in result["applied"]["testers"].items():
        print(f"-- applied tester: {tester}: {summary['assessments']} {summary['candidates']}")
    print(f"skipped conflicts: {result['applied']['skippedConflicts']}, "
          f"skipped unmapped: {result['applied']['skippedUnmapped']}")
    print("Re-running the same command inserts nothing new (idempotent).")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
