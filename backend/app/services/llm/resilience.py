"""LLM resilience Tier 1: error taxonomy, token bucket, circuit breaker, cache.

Shared by the background resume pipeline and the sync JD path. Rules:

- Retryable: 429, 502/503/504, timeouts, connection errors. Everything else
  (400/401/402/403, schema violations) fails fast with a sanitized reason.
- Provider error bodies are NEVER stored/logged (they may echo prompt text):
  only status code, error code/type, and allowlisted messages leave this
  module. Secrets never appear anywhere here.
- Governance state lives in ONE `llm_governance` collection keyed
  `bucket:{provider}:{model}`, `breaker:{provider}:{model}`,
  `cache:{promptVersion}:{inputHash}`. (L2 will fingerprint per-org keys as a
  truncated HMAC with an app secret — never a plain hash, never logged.)

No model names are hardcoded: provider/model always come from settings.
"""

from __future__ import annotations

import logging
import random
import time
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from typing import Any

logger = logging.getLogger(__name__)

RETRYABLE_STATUSES = frozenset({429, 502, 503, 504})
FAIL_FAST_STATUSES = frozenset({400, 401, 402, 403})

CACHE_TTL_DAYS = 7


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def as_aware(value: Any) -> datetime | None:
    """Normalize a stored timestamp for Python-side arithmetic.

    Mongo drivers return naive UTC datetimes by default (both Atlas via
    Motor and mongomock); this module writes timezone-aware ones. Comparing
    the two raises TypeError, which would silently disable age/wait/refill
    budgets — so naive values are assumed UTC instead of erroring out.
    """
    if isinstance(value, datetime):
        return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
    return None


def _settings():
    from ...config import settings

    return settings


def governance_key() -> str:
    """Shared bucket/breaker key. L1 scope is provider+model (no per-org keys)."""
    settings = _settings()
    provider = (settings.llm_provider or "openrouter").strip().lower() or "openrouter"
    model = (settings.openrouter_model or "").strip().lower() or "unconfigured"
    return f"{provider}:{model}"


# --------------------------------------------------------------------------
# Error taxonomy (sanitized: codes only, never bodies)
# --------------------------------------------------------------------------

def classify_status(status: int) -> tuple[str, bool]:
    """Map an HTTP status to (error_code, retryable). Unknown 5xx retry."""
    if status == 429:
        return "rate_limited", True
    if status in FAIL_FAST_STATUSES:
        return {
            400: "bad_request",
            401: "auth_error",
            402: "payment_required",
            403: "auth_error",
        }[status], False
    if status >= 500:
        return f"http_{status}", True
    if 400 <= status < 500:
        return f"http_{status}", False
    return "unexpected_status", False


_SANITIZED_MESSAGES = {
    # Neutral descriptions of WHAT happened (no bodies, no secrets).
    # Callers compose the disposition ("deferred", "text-only fallback").
    "rate_limited": "LLM rate-limited.",
    "bad_request": "LLM request was rejected.",
    "auth_error": "LLM authentication failed; check OPENROUTER_API_KEY.",
    "payment_required": "LLM quota exhausted.",
    "bad_schema": "LLM returned unusable output.",
    "bad_envelope": "LLM returned an unreadable response.",
    "timeout": "LLM timed out.",
    "transport_error": "LLM connection failed.",
    "injection_suspected": "Prompt-injection pattern detected; LLM skipped.",
    "unconfigured": "LLM not configured.",
}


def sanitized_message(error_code: str) -> str:
    """User/diagnostics-safe message for an error code. Never includes bodies."""
    if error_code.startswith("http_"):
        return "LLM provider error; deferred with backoff."
    return _SANITIZED_MESSAGES.get(error_code, "LLM call failed; deterministic fallback.")


def parse_retry_after(headers: Any, default_s: float = 5.0) -> float:
    """Seconds from Retry-After (delta or HTTP date), clamped to [0, 3600]."""
    try:
        raw = None
        if hasattr(headers, "get"):
            raw = headers.get("Retry-After", headers.get("retry-after"))
        if raw is None:
            return default_s
        try:
            return max(0.0, min(3600.0, float(str(raw).strip())))
        except (TypeError, ValueError):
            moment = parsedate_to_datetime(str(raw))
            if moment.tzinfo is None:
                moment = moment.replace(tzinfo=timezone.utc)
            return max(0.0, min(3600.0, (moment - _utcnow()).total_seconds()))
    except Exception:  # noqa: BLE001 — malformed headers must not break dispatch
        return default_s


def rate_limit_remaining(headers: Any) -> int | None:
    """Remaining quota hint, if the provider reports one. Never content."""
    try:
        get = getattr(headers, "get", None)
        if get is None:
            return None
        for name in ("X-RateLimit-Remaining", "x-ratelimit-remaining",
                     "X-Rate-Limit-Remaining", "ratelimit-remaining"):
            raw = get(name)
            if raw is not None:
                return max(0, int(str(raw).strip()))
    except (TypeError, ValueError):
        return None
    return None


def compute_defer_delay(retry_after_s: float | None, attempts: int,
                        base_s: float = 30.0, cap_s: float = 3600.0) -> datetime:
    """runAfter = now + max(Retry-After, exponential backoff) + jitter."""
    backoff = min(base_s * (2 ** max(0, attempts - 1)), cap_s)
    delay = max(float(retry_after_s or 0.0), backoff)
    delay += random.uniform(0, min(30.0, delay))
    return _utcnow() + timedelta(seconds=delay)


# --------------------------------------------------------------------------
# Token bucket (Mongo-atomic take; interactive reserve for sync calls)
# --------------------------------------------------------------------------

def _bucket_defaults() -> tuple[int, int, float]:
    settings = _settings()
    return (
        max(1, int(settings.llm_rpm or 30)),
        max(1, int(settings.llm_burst or 5)),
        min(0.9, max(0.0, float(settings.llm_interactive_reserve or 0.0))),
    )


def _bucket_id(key: str) -> str:
    return f"bucket:{key}"


def _refill_math(tokens: float, capacity: float, rpm: float,
                 elapsed_min: float) -> float:
    return min(float(capacity), float(tokens) + max(0.0, elapsed_min) * float(rpm))


async def bucket_take(db: Any, key: str, *, kind: str = "bulk",
                      now: datetime | None = None) -> tuple[bool, float]:
    """Take one token if available. Returns (allowed, retry_after_s).

    Bulk calls keep a reserve floor for interactive (sync) calls so a batch
    cannot starve a waiting user. The take is a single atomic Mongo update
    (aggregation-pipeline `findOneAndUpdate`); on servers without pipeline
    updates it falls back to a version-guarded compare-and-set loop, which
    carries the same atomicity (one conditional update per take).
    """
    settings = _settings()
    rpm, burst, reserve = _bucket_defaults()
    _ = settings
    floor = int(float(burst) * reserve)
    needed = 1 if kind == "interactive" else floor + 1
    moment = now or _utcnow()
    coll = db["llm_governance"]
    bid = _bucket_id(key)

    update: Any = [
        {"$set": {
            "tokens": {"$ifNull": ["$tokens", burst]},
            "capacity": burst,
            "rpm": rpm,
            "lastRefill": {"$ifNull": ["$lastRefill", moment]},
            "updatedAt": moment,
        }},
        {"$set": {
            "refilled": {
                "$min": ["$capacity", {"$add": ["$tokens", {"$multiply": [
                    {"$max": [0, {"$divide": [{"$subtract": [moment, "$lastRefill"]}, 60000.0]}]},
                    "$rpm",
                ]}]}],
            },
        }},
        {"$set": {
            "allowed": {"$gte": ["$refilled", needed]},
            "tokens": {"$cond": [{"$gte": ["$refilled", needed]},
                                 {"$subtract": ["$refilled", 1]}, "$refilled"]},
            "lastRefill": moment,
            "updatedAt": moment,
            "kind": "bucket",
            "key": key,
        }},
    ]
    try:
        doc = await coll.find_one_and_update(
            {"_id": bid}, update, upsert=True, return_document=True,
        )
        if doc and bool(doc.get("allowed", False)):
            return True, 0.0
        refilled = float((doc or {}).get("refilled", 0.0))
        wait_s = max(1.0, (float(needed) - refilled) / max(1.0, float(rpm)) * 60.0)
        return False, wait_s
    except Exception:  # noqa: BLE001 — no pipeline updates; CAS fallback below
        logger.debug("Bucket pipeline update unsupported; using CAS fallback")
    return await _bucket_take_cas(db, key, kind=kind, now=moment,
                                  rpm=rpm, burst=burst, floor=floor, needed=needed)


async def _bucket_take_cas(db: Any, key: str, *, kind: str, now: datetime,
                           rpm: int, burst: int, floor: int, needed: int,
                           ) -> tuple[bool, float]:
    """Version-guarded take loop. Each take is one conditional atomic update."""
    coll = db["llm_governance"]
    bid = _bucket_id(key)
    for _ in range(8):
        doc = await coll.find_one({"_id": bid})
        if doc is None:
            tokens, version, last = float(burst), 0, now
            try:
                await coll.insert_one({
                    "_id": bid, "kind": "bucket", "key": key,
                    "tokens": tokens, "capacity": burst, "rpm": rpm,
                    "lastRefill": last, "version": version, "updatedAt": now,
                })
            except Exception:  # noqa: BLE001 — lost the init race; re-read
                continue
            doc = await coll.find_one({"_id": bid})
            if doc is None:
                continue
        tokens = float(doc.get("tokens", burst))
        last = doc.get("lastRefill") or now
        last_aware = as_aware(last) or now
        elapsed_min = max(0.0, (now - last_aware).total_seconds() / 60.0)
        refilled = _refill_math(tokens, doc.get("capacity", burst),
                                doc.get("rpm", rpm), elapsed_min)
        allowed = refilled >= needed
        new_tokens = refilled - 1.0 if allowed else refilled
        res = await coll.update_one(
            {"_id": bid, "version": int(doc.get("version", 0))},
            {"$set": {"tokens": new_tokens, "capacity": burst, "rpm": rpm,
                      "lastRefill": now, "updatedAt": now,
                      "kind": "bucket", "key": key},
             "$inc": {"version": 1}},
        )
        if (res.modified_count or 0) == 1:
            if allowed:
                return True, 0.0
            wait_s = max(1.0, (float(needed) - refilled) / max(1.0, float(rpm)) * 60.0)
            return False, wait_s
    return False, 60.0


async def bucket_clamp(db: Any, key: str, remaining: int | None) -> None:
    """Lower stored tokens when the provider reports less remaining quota."""
    if remaining is None:
        return
    try:
        await db["llm_governance"].update_one(
            {"_id": _bucket_id(key)},
            {"$set": {"tokens": max(0.0, float(remaining)), "updatedAt": _utcnow()}},
        )
    except Exception:  # noqa: BLE001 — clamping is best-effort
        logger.debug("Bucket clamp skipped")


async def bucket_state(db: Any, key: str) -> dict[str, Any]:
    """Metadata-only snapshot for diagnostics (no secrets exist here)."""
    doc = await db["llm_governance"].find_one({"_id": _bucket_id(key)}) or {}
    doc.pop("_id", None)
    return {
        "tokens": doc.get("tokens", 0),
        "capacity": doc.get("capacity", 0),
        "rpm": doc.get("rpm", 0),
    }


# --------------------------------------------------------------------------
# Circuit breaker (Mongo-shared; single half-open probe)
# --------------------------------------------------------------------------

def _breaker_id(key: str) -> str:
    return f"breaker:{key}"


def _breaker_cfg() -> tuple[int, int]:
    settings = _settings()
    return (
        max(2, int(settings.llm_breaker_threshold or 5)),
        max(1, int(settings.llm_breaker_cooldown_s or 300)),
    )


async def breaker_check(db: Any, key: str,
                        now: datetime | None = None) -> tuple[bool, dict[str, Any]]:
    """(allowed, info). Opens are shared; one half-open probe at a time."""
    threshold, cooldown_s = _breaker_cfg()
    _ = threshold
    moment = now or _utcnow()
    coll = db["llm_governance"]
    doc = await coll.find_one({"_id": _breaker_id(key)}) or {}
    state = str(doc.get("state", "closed"))
    if state == "closed":
        return True, {"state": "closed", "failures": int(doc.get("failures", 0))}
    if state == "open":
        probe_at = as_aware(doc.get("nextProbeAt"))
        due = probe_at is not None and moment >= probe_at
        if probe_at is None:
            due = True  # corrupt doc: fail open for recovery, then re-arms
        if due:
            res = await coll.update_one(
                {"_id": _breaker_id(key), "state": "open"},
                {"$set": {"state": "half_open", "updatedAt": moment}},
            )
            if (res.modified_count or 0) == 1:
                return True, {"state": "half_open", "failures": int(doc.get("failures", 0))}
        wait_s = 60.0
        probe_at = as_aware(doc.get("nextProbeAt"))
        if probe_at is not None:
            wait_s = max(1.0, (probe_at - moment).total_seconds())
        return False, {"state": "open", "retry_after_s": wait_s,
                       "failures": int(doc.get("failures", 0))}
    # half_open: a probe is already in flight elsewhere.
    return False, {"state": "half_open", "retry_after_s": 30.0,
                   "failures": int(doc.get("failures", 0))}


async def breaker_record(db: Any, key: str, *, success: bool,
                         retryable_failure: bool) -> dict[str, Any]:
    """Record one call. Only 429/5xx-class failures trip the breaker."""
    threshold, cooldown_s = _breaker_cfg()
    coll = db["llm_governance"]
    bid = _breaker_id(key)
    moment = _utcnow()
    if success:
        await coll.update_one(
            {"_id": bid},
            {"$set": {"state": "closed", "failures": 0, "updatedAt": moment,
                      "kind": "breaker", "key": key}},
            upsert=True,
        )
        return {"state": "closed", "failures": 0}
    if not retryable_failure:
        return {"state": str((await coll.find_one({"_id": bid}) or {}).get("state", "closed"))}
    doc = await coll.find_one({"_id": bid}) or {}
    failures = int(doc.get("failures", 0)) + 1
    if failures >= threshold:
        jitter = random.uniform(0, min(60.0, float(cooldown_s)))
        await coll.update_one(
            {"_id": bid},
            {"$set": {"state": "open", "failures": failures,
                      "openedAt": moment,
                      "nextProbeAt": moment + timedelta(seconds=cooldown_s + jitter),
                      "updatedAt": moment, "kind": "breaker", "key": key}},
            upsert=True,
        )
        logger.warning("LLM breaker OPEN for %s after %d failures", key, failures)
        return {"state": "open", "failures": failures}
    await coll.update_one(
        {"_id": bid},
        {"$set": {"state": "closed", "failures": failures, "updatedAt": moment,
                  "kind": "breaker", "key": key}},
        upsert=True,
    )
    return {"state": "closed", "failures": failures}


# --------------------------------------------------------------------------
# Result cache (digest + job-hash + prompt version; TTL)
# --------------------------------------------------------------------------

def _cache_id(prompt_version: str, input_hash: str) -> str:
    return f"cache:{prompt_version}:{input_hash}"


async def cache_get(db: Any, prompt_version: str, input_hash: str) -> dict[str, Any] | None:
    try:
        doc = await db["llm_governance"].find_one({
            "_id": _cache_id(prompt_version, input_hash),
            "expiresAt": {"$gt": _utcnow()},
        })
    except Exception:  # noqa: BLE001 — cache is best-effort
        return None
    if not doc:
        return None
    payload = doc.get("payload")
    return dict(payload) if isinstance(payload, dict) else None


async def cache_put(db: Any, prompt_version: str, input_hash: str,
                    payload: dict[str, Any], ttl_days: int = CACHE_TTL_DAYS) -> None:
    try:
        await db["llm_governance"].update_one(
            {"_id": _cache_id(prompt_version, input_hash)},
            {"$set": {"kind": "cache", "payload": dict(payload),
                      "expiresAt": _utcnow() + timedelta(days=ttl_days),
                      "updatedAt": _utcnow()}},
            upsert=True,
        )
    except Exception:  # noqa: BLE001 — cache is best-effort
        logger.debug("LLM cache put skipped")


# --------------------------------------------------------------------------
# Shared pre-flight + post-call for worker (bulk) and sync (interactive)
# --------------------------------------------------------------------------

async def llm_guard(db: Any, *, kind: str = "bulk") -> tuple[bool, str, dict[str, Any]]:
    """Pre-flight shared by both paths. (allowed, reason, info).

    Unconfigured providers bypass the guard (callers report "not
    configured" themselves); nothing is recorded for calls never made.
    """
    settings = _settings()
    if not (settings.openrouter_api_key or "").strip() or not (settings.openrouter_model or "").strip():
        return True, "unconfigured-bypass", {"state": "closed"}
    key = governance_key()
    ok, info = await breaker_check(db, key)
    if not ok:
        return False, "breaker-open", info
    allowed, wait_s = await bucket_take(db, key, kind=kind)
    if not allowed:
        return False, "rate-limited", {"retry_after_s": wait_s, "state": info.get("state", "closed")}
    return True, "ok", info


async def llm_record(db: Any, *, outcome: Any) -> None:
    """Record one finished call: breaker on 429/5xx-class, clamp on hints."""
    key = governance_key()
    is_ok = bool(getattr(outcome, "llm_score", None) is not None
                 or getattr(outcome, "payload", None) is not None)
    code = str(getattr(outcome, "error_code", None) or "")
    retryable = bool(getattr(outcome, "retryable", False))
    if is_ok:
        await breaker_record(db, key, success=True, retryable_failure=False)
    elif retryable or code in ("rate_limited",) or code.startswith("http_5"):
        await breaker_record(db, key, success=False, retryable_failure=True)
    try:
        await bucket_clamp(db, key, getattr(outcome, "rate_limit_remaining", None))
    except Exception:  # noqa: BLE001 — clamp is best-effort
        logger.debug("Bucket clamp skipped")


# --------------------------------------------------------------------------
# Dev-only fake provider (429 drills; refused in production)
# --------------------------------------------------------------------------

def fake_mode() -> str:
    if _settings().is_production:
        return "off"
    return (_settings().llm_fake_provider or "off").strip().lower()


async def fake_call(*, success_factory: Any) -> tuple[str, Any]:
    """Simulate a provider round-trip. Returns (kind, payload).

    kind: "ok" (success_factory()), "http" (status, headers),
    "raise" ("timeout"), "bad_schema" (unusable JSON).
    """
    mode = fake_mode()
    if mode == "down":
        return "http", (503, {})
    if mode != "mixed":
        return "ok", success_factory()
    settings = _settings()
    rate = min(1.0, max(0.0, float(settings.llm_fake_failure_rate or 0.0)))
    if random.random() >= rate:
        return "ok", success_factory()
    pick = random.random()
    if pick < 0.5:
        return "http", (429, {"Retry-After": str(int(settings.llm_fake_retry_after_s or 5))})
    if pick < 0.75:
        return "http", (503, {})
    if pick < 0.9:
        return "raise", "timeout"
    return "bad_schema", None


# --------------------------------------------------------------------------
# Diagnostics card data (metadata only — no bodies, no secrets)
# --------------------------------------------------------------------------

async def llm_health(db: Any, org_id: str) -> dict[str, Any]:
    """LLM health card: breakers, buckets, queue depth, 429s, last error."""
    key = governance_key()
    breaker = await db["llm_governance"].find_one({"_id": f"breaker:{key}"}) or {}
    bucket = await bucket_state(db, key)
    queued = 0
    oldest_wait_s: float | None = None
    try:
        now = _utcnow()
        cursor = db["background_jobs"].find({
            "orgId": org_id,
            "kind": {"$in": ["resume_process", "llm_complete"]},
            "status": {"$in": ["pending", "deferred"]},
        })
        async for job in cursor:
            queued += 1
            anchor = as_aware(job.get("runAfter") or job.get("createdAt"))
            age = max(0.0, (now - anchor).total_seconds()) if anchor else 0.0
            oldest_wait_s = age if oldest_wait_s is None else max(oldest_wait_s, age)
    except Exception:  # noqa: BLE001 — diagnostics must not break the page
        logger.debug("LLM queue depth skipped")
    hour_ago = _utcnow() - timedelta(hours=1)
    rate_limited_1h = 0
    last_error: dict[str, Any] | None = None
    try:
        rate_limited_1h = await db["llm_runs"].count_documents({
            "orgId": org_id, "error": "rate_limited", "createdAt": {"$gte": hour_ago},
        })
        cursor = db["llm_runs"].find(
            {"orgId": org_id, "error": {"$ne": None}}
        ).sort("createdAt", -1).limit(1)
        async for row in cursor:
            last_error = {
                "error": row.get("error"),
                "promptVersion": row.get("promptVersion"),
                "model": row.get("model"),
                "latencyMs": row.get("latencyMs"),
                "createdAt": row.get("createdAt").isoformat()
                if isinstance(row.get("createdAt"), datetime) else None,
            }
    except Exception:  # noqa: BLE001 — diagnostics must not break the page
        logger.debug("LLM error stats skipped")
    return {
        "providerModel": key,
        "breaker": {"state": str(breaker.get("state", "closed")),
                    "failures": int(breaker.get("failures", 0))},
        "bucket": bucket,
        "queuedJobs": queued,
        "oldestWaitingSeconds": oldest_wait_s,
        "rateLimitedLastHour": rate_limited_1h,
        "lastError": last_error,
        "fakeProvider": fake_mode(),
    }
