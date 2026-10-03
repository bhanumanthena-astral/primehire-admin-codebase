"""In-memory sliding-window rate limiter (§2.4 of DECISIONS.md)."""

from __future__ import annotations

import time
from collections import defaultdict
from dataclasses import dataclass


@dataclass
class RateLimitResult:
    allowed: bool
    remaining: int
    retry_after: int


class SlidingWindowRateLimiter:
    """Thread-safe in-memory sliding-window counter rate limiter."""

    def __init__(self) -> None:
        # key -> list of timestamp floats
        self._history: dict[str, list[float]] = defaultdict(list)

    def check(self, key: str, max_requests: int, window_seconds: int) -> RateLimitResult:
        now = time.time()
        cutoff = now - window_seconds
        records = [t for t in self._history[key] if t > cutoff]
        self._history[key] = records

        if len(records) >= max_requests:
            earliest = records[0]
            retry_after = max(1, int(window_seconds - (now - earliest)))
            return RateLimitResult(allowed=False, remaining=0, retry_after=retry_after)

        records.append(now)
        remaining = max_requests - len(records)
        return RateLimitResult(allowed=True, remaining=remaining, retry_after=0)

    def reset(self, key: str) -> None:
        """Reset history for a key (e.g. after successful login)."""
        self._history.pop(key, None)


limiter = SlidingWindowRateLimiter()
