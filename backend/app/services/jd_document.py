"""Normal JD document text extraction (AI JD Ingestion Phase 1).

Text-first, LLM-free: a normal JD PDF/DOCX/DOC goes through the SAME secure
chain as the prescribed template (filename safety, magic bytes, size caps,
ClamAV hook, isolated 30 s parser) and comes out as normalized text.

Nothing is persisted here and no LLM is called — Phase 2 will structure the
returned text. The prescribed-template path in `jd_template.py` is untouched.
"""

from __future__ import annotations

#: Version marker for the document-ingestion path (distinct from the
#: prescribed-template `JD_TEMPLATE_VERSION = "v1"`).
JD_DOCUMENT_VERSION = "doc-v1"

#: Shown when document mode returns text without structured fields (LLM
#: unconfigured, unavailable, or failed). States the runtime truth — never a
#: phase reference, never a promise the AI ran.
JD_DOCUMENT_AI_PENDING_WARNING = (
    "AI field extraction is unavailable — text extraction only. "
    "You can continue filling the form manually; nothing was saved."
)

#: Defensive cap mirroring the isolated worker's `rawText[:20000]` truncation.
JD_DOCUMENT_MAX_CHARS = 20000


def normalize_jd_text(text: str) -> str:
    """Normalize extracted JD text for the LLM handoff (Phase 2).

    - CRLF/CR → LF, per-line trailing whitespace stripped.
    - Leading/trailing blank lines dropped; 3+ consecutive blanks → 2.
    - Hard-capped at `JD_DOCUMENT_MAX_CHARS` (worker already truncates,
      this is defense-in-depth for direct callers).
    """
    raw = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    lines = [line.rstrip() for line in raw.split("\n")]
    while lines and not lines[0]:
        lines.pop(0)
    while lines and not lines[-1]:
        lines.pop()
    collapsed: list[str] = []
    blanks = 0
    for line in lines:
        if line:
            blanks = 0
            collapsed.append(line)
        else:
            blanks += 1
            if blanks <= 2:
                collapsed.append("")
    return "\n".join(collapsed)[:JD_DOCUMENT_MAX_CHARS]


def is_extractable(text: str) -> bool:
    """True when the normalized text has any readable content."""
    return bool((text or "").strip())
