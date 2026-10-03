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
) -> LlmOutcome:
    """Score a PII-stripped digest against job requirements. Never raises."""
    if detect_injection(raw_text or ""):
        return LlmOutcome(injection_suspected=True, llm_unavailable=True,
                          reasons=["Prompt-injection pattern detected; LLM score skipped."])
    if not _is_configured():
        return LlmOutcome(llm_unavailable=True, reasons=["LLM not configured."])

    digest = build_stripped_digest(parsed)
    request_payload = {"candidate": digest, "job": job_reqs}
    digest_hash = input_hash(request_payload)
    user_block = (
        "<<<RESUME-START\n"
        f"{request_payload}\n"
        "RESUME-END>>>"
    )
    body = {
        "model": settings.openrouter_model.strip(),
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_block},
        ],
        "response_format": {"type": "json_object"},
        "max_tokens": 400,
        "temperature": 0.2,
    }
    headers = {
        "Authorization": f"Bearer {settings.openrouter_api_key.strip()}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://primehire.local",
        "X-Title": "PrimeHire",
    }

    outcome = LlmOutcome(llm_unavailable=True, reasons=["LLM call failed; deterministic fallback."])
    async with _semaphore():
        for attempt in range(3):  # initial + 2 retries
            started = time.monotonic()
            try:
                async with httpx.AsyncClient(timeout=timeout_s) as client:
                    resp = await client.post(OPENROUTER_URL, json=body, headers=headers)
                latency_ms = int((time.monotonic() - started) * 1000)
                if resp.status_code == 429:
                    retry_after = float(resp.headers.get("Retry-After", "5"))
                    await asyncio.sleep(min(60, retry_after) + random.uniform(0, 2))
                    await _log(db, org_id, digest_hash, output_ref, 0, 0, latency_ms,
                               error="rate_limited")
                    continue
                if resp.status_code >= 500:
                    await asyncio.sleep(2 ** attempt + random.uniform(0, 1))
                    await _log(db, org_id, digest_hash, output_ref, 0, 0, latency_ms,
                               error=f"http_{resp.status_code}")
                    continue
                if resp.status_code in (401, 403):
                    await _log(db, org_id, digest_hash, output_ref, 0, 0, latency_ms,
                               error="auth_error")
                    logger.warning("OpenRouter auth error (key name only: OPENROUTER_API_KEY)")
                    return outcome
                data = resp.json()
                content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
                usage = data.get("usage", {}) or {}
                try:
                    import json as _json

                    scored = LlmScorePayload.model_validate(_json.loads(content))
                except (ValueError, ValidationError):
                    await _log(db, org_id, digest_hash, output_ref,
                               int(usage.get("prompt_tokens", 0) or 0),
                               int(usage.get("completion_tokens", 0) or 0),
                               latency_ms, error="bad_schema")
                    if attempt < 2:
                        continue
                    return outcome
                await _log(db, org_id, digest_hash, output_ref,
                           int(usage.get("prompt_tokens", 0) or 0),
                           int(usage.get("completion_tokens", 0) or 0),
                           latency_ms)
                merged_injection = scored.injection_suspected or detect_injection(raw_text or "")
                return LlmOutcome(llm_score=scored.score, reasons=list(scored.reasons),
                                  injection_suspected=merged_injection)
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                latency_ms = int((time.monotonic() - started) * 1000)
                await _log(db, org_id, digest_hash, output_ref, 0, 0, latency_ms,
                           error=type(exc).__name__)
                await asyncio.sleep(2 ** attempt + random.uniform(0, 1))
                continue
    return outcome


async def _log(db: Any, org_id: str, digest_hash: str, output_ref: str,
               tokens_in: int, tokens_out: int, latency_ms: int, error: str | None = None) -> None:
    try:
        repo = LlmRunRepository(db)
        await repo.create({
            "orgId": org_id,
            "promptVersion": PROMPT_VERSION_SCORE,
            "model": (settings.openrouter_model or "").strip() or "unconfigured",
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
