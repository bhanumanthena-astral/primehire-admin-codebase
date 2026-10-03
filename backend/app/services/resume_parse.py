"""Resume parsing orchestration: isolated child process + 30 s kill-on-timeout.

One pathological PDF must never hang the worker/API. Each file is parsed in
a dedicated child (`_parse_worker.py`); the parent enforces PARSE_TIMEOUT_S
and kills the child on expiry. The file is marked `failed`, the batch
continues. Bytes cross on stdin so the child needs no disk/config access.
Windows memory cap is best-effort (see child).
"""

from __future__ import annotations

import base64
import json
import logging
import subprocess
import sys
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

PARSE_TIMEOUT_S = 30

_WORKER = str(Path(__file__).resolve().parent / "_parse_worker.py")
_BACKEND_DIR = str(Path(__file__).resolve().parent.parent.parent)


class ParseTimeout(Exception):
    """Child did not finish within PARSE_TIMEOUT_S and was killed."""


class ParseFailed(Exception):
    """Child reported failure or returned unparseable output."""


def parse_bytes_isolated(data: bytes, kind: str, timeout: int = PARSE_TIMEOUT_S) -> dict[str, Any]:
    """Parse upload bytes in an isolated child. Returns {rawText, parsed}."""
    payload = json.dumps({"kind": kind, "data_b64": base64.b64encode(data).decode()})
    proc = subprocess.Popen(
        [sys.executable, _WORKER],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        cwd=_BACKEND_DIR,
    )
    try:
        out, _ = proc.communicate(input=payload, timeout=timeout)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait()
        raise ParseTimeout(f"Parsing exceeded {timeout}s and was killed.") from None
    if proc.returncode != 0:
        raise ParseFailed("Parser child failed.")
    try:
        result = json.loads(out or "")
    except ValueError:
        raise ParseFailed("Parser child returned invalid output.") from None
    if not result.get("ok"):
        raise ParseFailed(result.get("error", "Parser child failed."))
    return {"rawText": result.get("rawText", ""), "parsed": result.get("parsed", {})}


def parse_file_isolated(storage_key: str, kind: str, timeout: int = PARSE_TIMEOUT_S) -> dict[str, Any]:
    """Parse one stored file in an isolated child. Returns {rawText, parsed}."""
    from .storage import read_bytes

    return parse_bytes_isolated(read_bytes(storage_key), kind, timeout)
