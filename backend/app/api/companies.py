"""Company directory and super-admin decisions on company administrator access."""
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, ConfigDict, SecretStr
from pymongo.errors import DuplicateKeyError

from ..models.organization import OrganizationRepository
from ..models.hiring import AuditLogRepository
from ..security.deps import get_current_user, get_db, require_super_admin
from ..security.roles import get_permissions_for_role, user_permissions
from ..services.company_settings import read_settings, public_settings, encrypt_api_key
from ..services.outbox_crypto import OutboxCryptoError


router = APIRouter(prefix="/api/companies", tags=["companies"])
catalog = get_permissions_for_role("admin")


class CompanyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)


class Decision(BaseModel):
    approve: bool


class CompanyEmailSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: str = Field(pattern="^(custom|disabled|platform)$")
    fromAddress: str = Field(default="", max_length=254)
    fromName: str = Field(default="", max_length=160)
    apiKey: SecretStr | None = None
    clearApiKey: bool = False


class CompanySettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expectedRevision: int = Field(ge=0)
    email: CompanyEmailSettings
    enabledPermissions: list[str] = Field(max_length=100)


def database(db=Depends(get_db)):
    if db is None:
        raise HTTPException(503, "Database unavailable")
    return db


@router.get("")
async def directory(user=Depends(get_current_user), db=Depends(database)):
    if user.role not in {"super_admin", "admin"}:
        raise HTTPException(403, "Administrator access required")
    scope = {} if user.is_super_admin else {"orgId": user.org_id}
    companies = await db.organizations.find(scope, {"_id": 0, "name": 1, "orgId": 1}).sort("name", 1).to_list(None)
    groups = {company["orgId"]: company for company in companies}
    for company in companies:
        company["members"] = []
    if user.is_super_admin or "users.manage" in user.permissions:
        fields = {"_id": 0, "userId": 1, "name": 1, "role": 1, "orgId": 1, "permissionRequests": 1, "email": 1, "isActive": 1, "mfa": 1, "passwordHash": 1, "jobAccess": 1}
        async for member in db.users.find(scope, fields).sort("name", 1):
            if member["orgId"] in groups:
                from ..models.user import to_public_user
                groups[member["orgId"]]["members"].append({**to_public_user(member), "permissionRequests": member.get("permissionRequests", [])})
    own = await db.users.find_one({"orgId": user.org_id, "userId": user.user_id}) or {}
    return {"companies": companies, "catalog": sorted(catalog), "granted": sorted(user.permissions),
            "pending": own.get("permissionRequests", [])}


@router.post("", status_code=201)
async def create_company(payload: CompanyCreate, user=Depends(require_super_admin), db=Depends(database)):
    if user.impersonating:
        raise HTTPException(403, "View-as sessions are read-only")
    name = payload.name.strip()
    if not name:
        raise HTTPException(422, "Enter a company name")
    company = await OrganizationRepository(db).create({"orgId": str(uuid4()), "name": name})
    return {"orgId": company["orgId"], "name": name}


@router.get("/{org_id}/settings")
async def company_settings(org_id: str, user=Depends(require_super_admin), db=Depends(database)):
    if not await db.organizations.find_one({"orgId": org_id}):
        raise HTTPException(404, "Company not found")
    return public_settings(await read_settings(db, org_id), org_id, catalog)


@router.put("/{org_id}/settings")
async def update_company_settings(org_id: str, payload: CompanySettingsUpdate,
                                  user=Depends(require_super_admin), db=Depends(database)):
    if user.impersonating:
        raise HTTPException(403, "View-as sessions are read-only")
    if not await db.organizations.find_one({"orgId": org_id}):
        raise HTTPException(404, "Company not found")
    if set(payload.enabledPermissions) - catalog:
        raise HTTPException(422, "Unknown company permission")
    old = await read_settings(db, org_id)
    if payload.expectedRevision != old.get("revision", 0):
        raise HTTPException(409, "Company settings changed. Reopen settings and try again.")
    email = payload.email.model_dump(exclude={"apiKey", "clearApiKey"})
    email["fromAddress"] = email["fromAddress"].strip()
    email["fromName"] = email["fromName"].strip()
    import re
    if email["fromAddress"] and not re.fullmatch(r"[^\s<>,;@]+@[^\s<>,;@]+\.[^\s<>,;@]+", email["fromAddress"]):
        raise HTTPException(422, "Enter a valid sender email address")
    if any(c in email["fromName"] for c in "\r\n"):
        raise HTTPException(422, "Enter a valid sender name")
    if email["mode"] == "platform" and org_id != "default":
        raise HTTPException(422, "Use this company's own email credentials")
    encrypted = old.get("email", {}).get("apiKeyEncrypted")
    if payload.email.clearApiKey:
        encrypted = None
    key = payload.email.apiKey.get_secret_value().strip() if payload.email.apiKey else ""
    if key:
        if len(key) > 4096 or any(c.isspace() for c in key.removeprefix("Zoho-enczapikey ")):
            raise HTTPException(422, "Enter a valid ZeptoMail Send Mail token")
        if payload.email.clearApiKey:
            raise HTTPException(422, "Choose either replace or remove the saved key")
        if not key.startswith("Zoho-enczapikey "):
            key = "Zoho-enczapikey " + key
        try:
            encrypted = encrypt_api_key(org_id, key)
        except OutboxCryptoError:
            raise HTTPException(503, "Credential encryption is unavailable. No settings were saved.") from None
    if email["mode"] == "custom" and not (encrypted and email["fromAddress"] and email["fromName"]):
        raise HTTPException(422, "Company email requires a sender address, sender name and API key")
    if encrypted:
        email["apiKeyEncrypted"] = encrypted
    record = {"_id": org_id, "orgId": org_id, "revision": payload.expectedRevision + 1,
              "email": email, "enabledPermissions": sorted(set(payload.enabledPermissions))}
    if old:
        result = await db.company_settings.update_one({"_id": org_id, "revision": payload.expectedRevision},
                                                       {"$set": {k: v for k, v in record.items() if k != "_id"}})
        if not result.matched_count:
            raise HTTPException(409, "Company settings changed. Reopen settings and try again.")
    else:
        try:
            await db.company_settings.insert_one(record)
        except DuplicateKeyError:
            raise HTTPException(409, "Company settings changed. Reopen settings and try again.") from None
    await AuditLogRepository(db).log(org_id=org_id, actor_user_id=user.user_id,
        action="company.settings.updated", resource_type="company", resource_id=org_id,
        details={"revision": record["revision"], "emailMode": email["mode"],
                 "keyChanged": bool(key) or payload.email.clearApiKey,
                 "enabledPermissions": record["enabledPermissions"]})
    return public_settings(record, org_id, catalog)


@router.post("/requests/{permission}")
async def request_permission(permission: str, user=Depends(get_current_user), db=Depends(database)):
    if user.role != "admin" or user.impersonating:
        raise HTTPException(403, "Only company administrators can request access")
    if permission not in catalog:
        raise HTTPException(422, "Unknown company admin permission")
    account = await db.users.find_one({"userId": user.user_id, "orgId": user.org_id, "role": "admin", "isActive": True})
    if not account or permission in user_permissions(account):
        raise HTTPException(409, "Permission already granted or account changed")
    pending = set(account.get("permissionRequests", []))
    if permission not in pending:
        await save_access(db, account, {"permissionRequests": sorted(pending | {permission})})
    return {"pending": True}


@router.put("/{org_id}/requests/{user_id}/{permission}")
async def decide(org_id: str, user_id: str, permission: str, decision: Decision,
                 user=Depends(require_super_admin), db=Depends(database)):
    if permission not in catalog:
        raise HTTPException(422, "Unknown company admin permission")
    if user.impersonating:
        raise HTTPException(403, "View-as sessions are read-only")
    account = await db.users.find_one({"userId": user_id, "orgId": org_id, "role": "admin", "isActive": True})
    if not account or permission not in account.get("permissionRequests", []):
        raise HTTPException(409, "Request is no longer pending")
    changes = {"permissionRequests": [p for p in account["permissionRequests"] if p != permission]}
    if decision.approve:
        changes["adminPermissions"] = sorted(user_permissions(account) | {permission})
    await save_access(db, account, changes)
    return {"approved": decision.approve}


async def save_access(db, account, changes):
    result = await db.users.update_one(
        {"userId": account["userId"], "orgId": account["orgId"], "role": "admin", "isActive": True,
         "permissionRevision": account.get("permissionRevision")},
        {"$set": changes, "$inc": {"permissionRevision": 1}})
    if not result.matched_count:
        raise HTTPException(409, "Administrator access changed. Refresh and try again.")
