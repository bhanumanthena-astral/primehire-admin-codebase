"""PII masking helpers (server-side; Phase 3 projection builds on these)."""

from __future__ import annotations


def mask_email(email: str) -> str:
    """a***@example.com style. Empty stays empty."""
    if not email or "@" not in email:
        return ""
    local, _, domain = email.partition("@")
    if not local or not domain:
        return ""
    return f"{local[0]}***@{domain}"


def mask_phone(phone: str) -> str:
    """Keep country/last digits only: +91-XXXXXX1234 style."""
    digits = "".join(c for c in (phone or "") if c.isdigit())
    if not digits:
        return ""
    if len(digits) <= 4:
        return "XXXX"
    if len(digits) > 10:
        cc, rest = digits[:-10], digits[-10:]
        return f"+{cc}-XXXXXX{rest[-4:]}"
    return f"XXXXXX{digits[-4:]}"


def phone_digits_variants(phone: str) -> list[str]:
    """Canonical phone keys for indexed duplicate lookup.

    Stores [fullDigits, last10] so +91-98765-43210 and 9876543210 match
    through one indexed equality query in either direction.
    """
    digits = "".join(c for c in (phone or "") if c.isdigit())
    if not digits:
        return []
    variants = [digits]
    if len(digits) > 10 and digits[-10:] not in variants:
        variants.append(digits[-10:])
    return variants
