"""Gmail send using the existing encrypted, refreshable Google connection."""

import base64
from email.message import EmailMessage
import httpx
from fastapi import HTTPException
from . import google_oauth as oauth


async def send(db, org, user_id, to, subject, html):
    token = await oauth.access_token(db, org, user_id, required_scope=oauth.GMAIL_SCOPE)
    message = EmailMessage()
    message["To"] = to
    message["Subject"] = subject
    message.set_content("This message contains an HTML report summary.")
    message.add_alternative(html, subtype="html")
    raw = base64.urlsafe_b64encode(message.as_bytes()).decode()
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(
                "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
                headers={"Authorization": "Bearer " + token},
                json={"raw": raw},
            )
    except httpx.HTTPError:
        raise HTTPException(
            502, "Gmail delivery status is unknown. Verify Sent Mail before retrying."
        ) from None
    if response.status_code in {401, 403}:
        raise HTTPException(409, "Reconnect Google and allow Gmail sending.")
    if not response.is_success:
        raise HTTPException(503, "Gmail did not accept the email.")
    result = response.json()
    if not result.get("id"):
        raise HTTPException(502, "Gmail did not confirm acceptance.")
    return result["id"]
