"""Optional recruitment-specific mail settings; assessment settings stay intact."""

import asyncio
import re
import httpx
from ..config import settings
from . import email_send

EmailSendError = email_send.EmailSendError


def dry_run():
    return (
        settings.email_dry_run
        if settings.recruitment_email_dry_run is None
        else settings.recruitment_email_dry_run
    )


def recipient_allowed(email):
    if not settings.recruitment_email_test_recipient_allowlist:
        return email_send.recipient_allowed(email)
    if settings.is_production:
        return True
    address = (email or "").strip().lower()
    entries = [
        entry.strip().lower()
        for entry in settings.recruitment_email_test_recipient_allowlist.split(",")
        if entry.strip()
    ]
    return any(
        address == entry or (entry.startswith("@") and address.endswith(entry))
        for entry in entries
    )


async def send_via_zepto(to_email, to_name, subject, html_body):
    if not settings.recruitment_zeptomail_api_key:
        return await email_send.send_via_zepto(to_email, to_name, subject, html_body)
    payload = {
        "from": {
            "address": settings.email_from_address.strip(),
            "name": settings.email_from_name.strip(),
        },
        "to": [
            {
                "email_address": {
                    "address": to_email.strip(),
                    "name": (to_name or "").strip(),
                }
            }
        ],
        "subject": subject,
        "htmlbody": html_body,
    }
    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                response = await client.post(
                    email_send.ZEPTO_URL,
                    json=payload,
                    headers={
                        "Accept": "application/json",
                        "Content-Type": "application/json",
                        "Authorization": settings.recruitment_zeptomail_api_key.strip(),
                    },
                )
            if 200 <= response.status_code < 300:
                return "accepted"
            if 400 <= response.status_code < 500 and response.status_code != 429:
                error = EmailSendError(
                    f"Recruitment email provider refused the message (HTTP {response.status_code})."
                )
                error.status_code = response.status_code
                try:
                    details = response.json().get("error", {}).get("details", [])
                    codes = [
                        str(detail.get("code", ""))
                        for detail in details
                        if isinstance(detail, dict)
                    ]
                    error.provider_codes = [
                        code for code in codes if re.fullmatch(r"[A-Z0-9_]{1,40}", code)
                    ]
                except (ValueError, AttributeError, TypeError):
                    error.provider_codes = []
                raise error
        except (httpx.TimeoutException, httpx.TransportError):
            pass
        if attempt < 2:
            await asyncio.sleep(2**attempt)
    raise EmailSendError("Recruitment email provider is unavailable; retry later.")
