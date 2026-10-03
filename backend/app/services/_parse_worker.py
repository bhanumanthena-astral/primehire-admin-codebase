"""Isolated parser child entry-point.

The parent streams {"kind": ..., "data_b64": ...} on stdin; the child prints
one JSON object to stdout: {"ok": true, ...} or {"ok": false, ...}.
Bytes cross the process boundary so the child never touches disk config —
pathological files die with the child; the parent kills on timeout.
No FastAPI or motor imports in this file.
"""

from __future__ import annotations

import base64
import json
import sys
from pathlib import Path

# Ensure `import app.*` works regardless of how the child was spawned
# (script dir would otherwise shadow the backend root on sys.path).
_BACKEND_DIR = str(Path(__file__).resolve().parent.parent.parent)
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)


def _apply_memory_cap() -> None:
    try:
        import resource

        resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
    except (ImportError, ValueError, OSError):
        pass


def main() -> int:
    _apply_memory_cap()
    try:
        payload = json.loads(sys.stdin.read() or "{}")
        kind = payload["kind"]
        data = base64.b64decode(payload["data_b64"])
    except Exception:
        print(json.dumps({"ok": False, "error": "usage error"}))
        return 2
    try:
        from app.services.resume_extract import deterministic_parse, extract_text

        raw_text = extract_text(data, kind)
        parsed = deterministic_parse(raw_text)
        print(json.dumps({"ok": True, "rawText": raw_text[:20000], "parsed": parsed}))
        return 0
    except Exception as exc:  # noqa: BLE001 - child reports, parent records
        print(json.dumps({"ok": False, "error": f"{type(exc).__name__}"}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
