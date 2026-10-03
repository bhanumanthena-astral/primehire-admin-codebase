"""LLM service package: provider adapter behind a stable interface."""

from .base import PROMPT_VERSION_SCORE, build_stripped_digest, detect_injection, scrub_text
from .openrouter import LlmOutcome, score_candidate

__all__ = [
    "PROMPT_VERSION_SCORE",
    "LlmOutcome",
    "build_stripped_digest",
    "detect_injection",
    "score_candidate",
    "scrub_text",
]
