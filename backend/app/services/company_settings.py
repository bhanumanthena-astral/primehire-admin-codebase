"""Private company configuration. Credentials never enter organization serializers."""
import json
from dataclasses import dataclass, field

from .outbox_crypto import encrypt_body, decrypt_body, OutboxCryptoError


class CompanyMailError(Exception):
    """Safe configuration error; contains no provider credentials."""


@dataclass(frozen=True)
class MailConfiguration:
    api_key: str = field(repr=False)
    from_address: str
    from_name: str


async def read_settings(db, org_id):
    if db is None:
        raise CompanyMailError("Company email settings are unavailable.")
    return await db.company_settings.find_one({"_id": org_id}) or {}


def public_settings(record, org_id, catalog):
    email = record.get("email", {})
    return {"orgId": org_id, "revision": record.get("revision", 0),
            "enabledPermissions": record.get("enabledPermissions", sorted(catalog)),
            "email": {"mode": email.get("mode", "platform" if org_id == "default" else "disabled"),
                      "fromAddress": email.get("fromAddress", ""),
                      "fromName": email.get("fromName", ""),
                      "apiKeyConfigured": bool(email.get("apiKeyEncrypted"))}}


async def mail_configuration(db, org_id):
    record = await read_settings(db, org_id)
    email = record.get("email", {})
    mode = email.get("mode", "platform" if org_id == "default" else "disabled")
    if mode == "platform" and org_id == "default":
        return None  # Preserve the original platform/recruitment channel settings.
    if mode != "custom":
        raise CompanyMailError("Email is disabled for this company. Ask the super admin to configure it.")
    try:
        secret = json.loads(decrypt_body(email.get("apiKeyEncrypted", "")))
        if secret.get("orgId") != org_id or secret.get("purpose") != "company-zeptomail":
            raise ValueError("Credential binding mismatch")
        key = secret["apiKey"]
        if not key or not email.get("fromAddress") or not email.get("fromName"):
            raise ValueError("Incomplete sender")
    except (OutboxCryptoError, ValueError, KeyError, TypeError, AttributeError):
        raise CompanyMailError("Company email credentials are unavailable. Ask the super admin to update them.") from None
    return MailConfiguration(key, email["fromAddress"], email["fromName"])


def encrypt_api_key(org_id, key):
    return encrypt_body(json.dumps({"purpose": "company-zeptomail", "orgId": org_id, "apiKey": key}))


async def company_sender_name(db, org_id):
    from ..config import settings
    record = await read_settings(db, org_id)
    name = record.get("email", {}).get("fromName")
    if name:
        return name
    company = await db.organizations.find_one({"orgId": org_id}, {"name": 1}) or {}
    return company.get("name") or settings.email_from_name
