"""Bounded local parsing adapter. Subprocesses never import app configuration."""
from __future__ import annotations
import base64
import json
import os
import subprocess
import sys
from pathlib import Path
from .resume_intake_security import IntakeError


def isolated(data, kind, *, options=None, timeout=60):
    worker = Path(__file__).with_name("_resume_intake_worker.py")
    child_env = {key: os.environ[key] for key in ["SYSTEMROOT", "WINDIR", "PATH", "TEMP", "TMP", "LANG", "LC_ALL"] if key in os.environ}
    child_env.update(PYTHONIOENCODING="utf-8", PYTHONDONTWRITEBYTECODE="1")
    proc = subprocess.Popen([sys.executable, str(worker)], stdin=subprocess.PIPE,
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, encoding="utf-8", env=child_env)
    try:
        output, _ = proc.communicate(json.dumps({"data": base64.b64encode(data).decode(),
            "kind": kind, "options": options or {}}), timeout=timeout)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.communicate()
        raise IntakeError("failed", "Processing timed out. Retry or use a shorter document.") from None
    try:
        result = json.loads(output)
    except (ValueError, TypeError):
        raise IntakeError("failed", "The isolated parser failed. Please retry.") from None
    if not result.get("ok"):
        raise IntakeError(result.get("code", "failed"), result.get("message", "Parsing failed."))
    return result["result"]
