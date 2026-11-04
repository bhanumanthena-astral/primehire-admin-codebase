"""OpenRouter scorer: concurrency-limited, 429-aware, fallback-safe.

- Model name comes ONLY from settings (`OPENROUTER_MODEL`); nothing is
  hardcoded here. Empty model or key = LLM disabled → deterministic-only.
- Concurrency: one asyncio semaphore sized by `LLM_CONCURRENCY` (default 2)
  so a 10-file batch never hammers the free tier.
- Retries: initial try + up to 2 retries (429 honors Retry-After + jitter;
  5xx/timeout back off + jitter). Then `llm_unavailable=True` and the caller
  uses the deterministic score with a visible flag. Never raises for
  transport/model errors.
"""

from __future__ import annotations

import asyncio
import logging
import random
import time
from functools import partial
from dataclasses import dataclass, field
from typing import Any

import httpx
from pydantic import ValidationError

from ...config import settings
from ...models.llm import LlmRunRepository
from .base import (
    PROMPT_VERSION_SCORE,
    SYSTEM_PROMPT,
    LlmScorePayload,
    build_stripped_digest,
    detect_injection,
    input_hash,
)

logger = logging.getLogger(__name__)

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

_semaphores: dict[str, asyncio.Semaphore] = {}


def _semaphore() -> asyncio.Semaphore:
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:  # pragma: no cover — always a loop in worker/tests
        loop = None
    key = f"{id(loop)}:{max(1, min(8, settings.llm_concurrency))}"
    sem = _semaphores.get(key)
    if sem is None:
        sem = asyncio.Semaphore(max(1, min(8, settings.llm_concurrency)))
        _semaphores[key] = sem
    return sem


@dataclass
class LlmOutcome:
    llm_score: int | None = None
    reasons: list[str] = field(default_factory=list)
    injection_suspected: bool = False
    llm_unavailable: bool = False
    # Resilience Tier 1 dispatch flags (defaults keep every existing caller
    # and test construction working unchanged).
    retryable: bool = False
    retry_after_s: float = 0.0
    error_code: str | None = None
    rate_limit_remaining: int | None = None
    from_cache: bool = False


def _is_configured() -> bool:
    return bool((settings.openrouter_api_key or "").strip()) and bool(
        (settings.openrouter_model or "").strip()
    )


async def score_candidate(
    db: Any,
    org_id: str,
    *,
    parsed: dict[str, Any],
    raw_text: str,
    job_reqs: dict[str, Any],
    output_ref: str,
    timeout_s: int = 30,
    max_attempts: int = 3,
    model_override: str | None = None,
) -> LlmOutcome:
    """Score a PII-stripped digest against job requirements. Never raises.

    `max_attempts` bounds inline retries: the background worker passes 1 so
    a retryable failure returns fast (with `retryable` set) for deferral
    instead of sleeping the worker; the sync paths keep the default 3.
    """
    from .resilience import (
        cache_get,
        cache_put,
        classify_status,
        fake_call,
        fake_mode,
        parse_retry_after,
        rate_limit_remaining,
        sanitized_message,
    )

    selected_model = (model_override or settings.openrouter_model or '').strip()
    log_run = partial(_log, model=selected_model)
    if detect_injection(raw_text or ""):
        return LlmOutcome(injection_suspected=True, llm_unavailable=True,
                          reasons=["Prompt-injection pattern detected; LLM score skipped."])
    digest = build_stripped_digest(parsed)
    request_payload = {"candidate": digest, "job": job_reqs}
    digest_hash = input_hash({**request_payload, 'model': selected_model} if model_override else request_payload)
    cached = await cache_get(db, PROMPT_VERSION_SCORE, digest_hash)
    if cached is not None:
        try:
            hit = LlmScorePayload.model_validate(cached)
            return LlmOutcome(llm_score=hit.score, reasons=list(hit.reasons),
                              injection_suspected=hit.injection_suspected,
                              from_cache=True)
        except ValidationError:
            pass
    if fake_mode() != "off":
        return await _fake_score(db, org_id, digest_hash, output_ref)
    if not settings.openrouter_api_key.strip() or not selected_model:
        return LlmOutcome(llm_unavailable=True, reasons=["LLM not configured."])
    user_block = (
        "<<<RESUME-START\n"
        f"{request_payload}\n"
        "RESUME-END>>>"
    )
    body = {
        "model": selected_model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_block},
        ],
        "response_format": {"type": "json_object"},
        "max_tokens": 400,
        "temperature": 0.2,
    }
    if model_override:
        # Free providers may require internal reasoning. Leave a bounded
        # allowance for that work before the short structured ATS answer.
        body["max_tokens"] = 1600
    headers = {
        "Authorization": f"Bearer {settings.openrouter_api_key.strip()}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://primehire.local",
        "X-Title": "PrimeHire",
    }

    outcome = LlmOutcome(llm_unavailable=True, reasons=["LLM call failed; deterministic fallback."])
    attempts = max(1, int(max_attempts or 3))
    async with _semaphore():
        for attempt in range(attempts):
            started = time.monotonic()
            try:
                async with httpx.AsyncClient(timeout=timeout_s) as client:
                    resp = await client.post(OPENROUTER_URL, json=body, headers=headers)
                latency_ms = int((time.monotonic() - started) * 1000)
                remaining = rate_limit_remaining(resp.headers)
                if resp.status_code == 429:
                    retry_after = parse_retry_after(resp.headers)
                    await log_run(db, org_id, digest_hash, output_ref, 0, 0, latency_ms,
                               error="rate_limited")
                    if attempt + 1 < attempts:
                        await asyncio.sleep(min(60, retry_after) + random.uniform(0, 2))
                        continue
                    return LlmOutcome(
                        llm_unavailable=True, retryable=True, retry_after_s=retry_after,
                        error_code="rate_limited", rate_limit_remaining=remaining,
                        reasons=[sanitized_message("rate_limited")])
                if resp.status_code >= 500:
                    code, _ = classify_status(resp.status_code)
                    await log_run(db, org_id, digest_hash, output_ref, 0, 0, latency_ms,
                               error=code)
                    if attempt + 1 < attempts:
                        await asyncio.sleep(2 ** attempt + random.uniform(0, 1))
                        continue
                    return LlmOutcome(
                        llm_unavailable=True, retryable=True,
                        error_code=code, rate_limit_remaining=remaining,
                        reasons=[sanitized_message(code)])
                if resp.status_code in (401, 403):
                    await log_run(db, org_id, digest_hash, output_ref, 0, 0, latency_ms,
                               error="auth_error")
                    logger.warning("OpenRouter auth error (key name only: OPENROUTER_API_KEY)")
                    return LlmOutcome(
                        llm_unavailable=True, error_code="auth_error",
                        rate_limit_remaining=remaining,
                        reasons=[sanitized_message("auth_error")])
                if resp.status_code != 200:
                    code, _ = classify_status(resp.status_code)
                    await log_run(db, org_id, digest_hash, output_ref, 0, 0, latency_ms,
                               error=code)
                    return LlmOutcome(
                        llm_unavailable=True, error_code=code,
                        rate_limit_remaining=remaining,
                        reasons=[sanitized_message(code)])
                usage = {}
                try:
                    import json as _json
                    data = resp.json()
                    content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
                    usage = data.get("usage", {}) or {}
                    if not isinstance(usage,dict):usage={}
                    usage = {key: max(0,int(usage.get(key,0) or 0)) for key in ['prompt_tokens','completion_tokens']}
                    scored = LlmScorePayload.model_validate(_json.loads(content))
                except (ValueError, TypeError, KeyError, IndexError, AttributeError, ValidationError):
                    usage = {}
                    await log_run(db, org_id, digest_hash, output_ref,
                               int(usage.get("prompt_tokens", 0) or 0),
                               int(usage.get("completion_tokens", 0) or 0),
                               latency_ms, error="bad_schema")
                    if attempt + 1 < attempts:
                        continue
                    return LlmOutcome(
                        llm_unavailable=True, error_code="bad_schema",
                        rate_limit_remaining=remaining,
                        reasons=[sanitized_message("bad_schema")])
                await log_run(db, org_id, digest_hash, output_ref,
                           int(usage.get("prompt_tokens", 0) or 0),
                           int(usage.get("completion_tokens", 0) or 0),
                           latency_ms)
                await cache_put(db, PROMPT_VERSION_SCORE, digest_hash,
                                {"score": scored.score, "reasons": list(scored.reasons),
                                 "injection_suspected": bool(scored.injection_suspected)})
                merged_injection = scored.injection_suspected or detect_injection(raw_text or "")
                return LlmOutcome(llm_score=scored.score, reasons=list(scored.reasons),
                                  injection_suspected=merged_injection,
                                  rate_limit_remaining=remaining)
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                latency_ms = int((time.monotonic() - started) * 1000)
                code = "timeout" if isinstance(exc, httpx.TimeoutException) else "transport_error"
                await log_run(db, org_id, digest_hash, output_ref, 0, 0, latency_ms,
                           error=code)
                if attempt + 1 < attempts:
                    await asyncio.sleep(2 ** attempt + random.uniform(0, 1))
                    continue
                return LlmOutcome(
                    llm_unavailable=True, retryable=True,
                    error_code=code, reasons=[sanitized_message(code)])
    return outcome


async def _fake_score(db: Any, org_id: str, digest_hash: str, output_ref: str) -> LlmOutcome:
    """Dev-only drill path (fake provider mode): never production, never secrets."""
    from .resilience import fake_call

    def _ok() -> LlmOutcome:
        return LlmOutcome(llm_score=70, reasons=["synthetic fake-provider output (drill)"])

    kind, payload = await fake_call(success_factory=_ok)
    if kind == "ok":
        await _log(db, org_id, digest_hash, output_ref, 0, 0, 0)
        result = payload
        result.from_cache = False
        return result
    if kind == "http":
        status, headers = payload
        if status == 429:
            from .resilience import parse_retry_after

            retry_after = parse_retry_after(headers)
            await _log(db, org_id, digest_hash, output_ref, 0, 0, 0, error="rate_limited")
            return LlmOutcome(llm_unavailable=True, retryable=True, retry_after_s=retry_after,
                              error_code="rate_limited",
                              reasons=["LLM rate-limited (fake-provider drill)."])
        await _log(db, org_id, digest_hash, output_ref, 0, 0, 0, error=f"http_{status}")
        return LlmOutcome(llm_unavailable=True, retryable=True, error_code=f"http_{status}",
                          reasons=["LLM provider error (fake-provider drill)."])
    if kind == "raise":
        await _log(db, org_id, digest_hash, output_ref, 0, 0, 0, error="timeout")
        return LlmOutcome(llm_unavailable=True, retryable=True, error_code="timeout",
                          reasons=["LLM timed out (fake-provider drill)."])
    await _log(db, org_id, digest_hash, output_ref, 0, 0, 0, error="bad_schema")
    return LlmOutcome(llm_unavailable=True, error_code="bad_schema",
                      reasons=["LLM returned unusable output (fake-provider drill)."])


async def _log(db: Any, org_id: str, digest_hash: str, output_ref: str,
               tokens_in: int, tokens_out: int, latency_ms: int, error: str | None = None, *, model: str | None = None) -> None:
    try:
        repo = LlmRunRepository(db)
        await repo.create({
            "orgId": org_id,
            "promptVersion": PROMPT_VERSION_SCORE,
            "model": (model or settings.openrouter_model or "").strip() or "unconfigured",
            "tokensIn": tokens_in,
            "tokensOut": tokens_out,
            "inputHash": digest_hash,  # hash only — never content
            "outputRef": output_ref,
            "decider": "system",
            "latencyMs": latency_ms,
            "error": error,
        })
    except Exception:  # noqa: BLE001 — audit logging must not break scoring
        logger.exception("llm_runs insert failed")
