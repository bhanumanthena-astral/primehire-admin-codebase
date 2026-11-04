"""User management API: list, invite, update, delete (§2.5 DECISIONS.md)."""

from __future__ import annotations

from datetime import timedelta
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status

from ..security.deps import CurrentUser, require_permission, get_db
from ..models.user import (
    UserRepository,
    InvitationRepository,
    to_public_user,
    utcnow,
)
from ..schemas.user import UserCreate, UserUpdate, UserPublic, UserRole
from ..security.deps import CurrentUser, require_permission
from ..security.passwords import hash_password
from ..security.roles import Role
from ..security.tokens import generate_opaque_token, hash_token, INVITE_TOKEN_LIFETIME

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("", response_model=list[UserPublic])
async def list_users(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    current_user: CurrentUser = Depends(require_permission("users.manage")),
    db: Any = Depends(get_db),
) -> list[UserPublic]:
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    repo = UserRepository(db)
    docs = await repo.list_by_org(current_user.org_id, skip=skip, limit=limit)
    return [UserPublic(**d) for d in docs]


@router.post("", response_model=dict[str, Any], status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: UserCreate,
    current_user: CurrentUser = Depends(require_permission("users.manage")),
    db: Any = Depends(get_db),
) -> dict[str, Any]:
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    # Only super_admin (possessing roles.assign_admin) can create admin or super_admin
    if payload.role in (UserRole.ADMIN, UserRole.SUPER_ADMIN):
        if "roles.assign_admin" not in current_user.permissions:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Forbidden: requires 'roles.assign_admin' to create admin users",
            )

    repo = UserRepository(db)
    org_id = current_user.org_id
    if current_user.is_super_admin and payload.orgId:
        org_id = payload.orgId

    existing = await repo.get_by_email(payload.email, org_id=org_id)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="User with this email already exists in this organization",
        )

    doc: dict[str, Any] = {
        "email": payload.email,
        "name": payload.name,
        "role": payload.role.value,
        "orgId": org_id,
        "isActive": True,
        "jobAccess": payload.jobAccess,
    }

    if payload.password:
        try:
            doc["passwordHash"] = hash_password(payload.password)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc))
    else:
        # User will set password via invitation token
        doc["passwordHash"] = ""

    user = await repo.create(doc)

    # Generate invitation token
    invite_token = generate_opaque_token()
    inv_repo = InvitationRepository(db)
    await inv_repo.create_invitation(
        user_id=user["userId"],
        org_id=org_id,
        token_hash=hash_token(invite_token),
        kind="invite",
        created_by=current_user.user_id,
        expires_at=utcnow() + INVITE_TOKEN_LIFETIME,
    )

    return {
        "user": to_public_user(user),
        "inviteUrl": f"/accept-invite#token={invite_token}",
    }


@router.post("/{user_id}/invite")
async def reissue_invite(user_id: str, current_user: CurrentUser = Depends(require_permission("users.manage")), db: Any = Depends(get_db)):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    user = await UserRepository(db).get_by_id(user_id, current_user.org_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.get("role") in {"admin", "super_admin"} and "roles.assign_admin" not in current_user.permissions:
        raise HTTPException(status_code=403, detail="Forbidden: requires 'roles.assign_admin' to invite administrator users")
    if not user.get("isActive") or user.get("passwordHash"):
        raise HTTPException(status_code=409, detail="Invitations require an active account awaiting password setup")
    await db["invitations"].update_many({"userId":user_id, "orgId":current_user.org_id, "kind":"invite", "usedAt":None}, {"$set":{"usedAt":utcnow()}})
    token = generate_opaque_token()
    await InvitationRepository(db).create_invitation(user_id=user_id, org_id=current_user.org_id,
        token_hash=hash_token(token), kind="invite", created_by=current_user.user_id,
        expires_at=utcnow()+INVITE_TOKEN_LIFETIME)
    from ..models.hiring import AuditLogRepository
    await AuditLogRepository(db).log(org_id=current_user.org_id, actor_user_id=current_user.user_id,
        action="user.invite_reissued",resource_type="user",resource_id=user_id,details={})
    return {"inviteUrl":f"/accept-invite#token={token}"}


@router.get("/directory", response_model=list[UserPublic])
async def list_user_directory(
    current_user: CurrentUser = Depends(require_permission("jobs.manage")),
    db: Any = Depends(get_db),
) -> list[UserPublic]:
    """Minimal ACTIVE-user directory for job assignee selection (PRD §21).

    Declared before /{user_id} so "directory" is never parsed as an id.
    Only active users are listed; the assign endpoints re-validate anyway.
    """
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    repo = UserRepository(db)
    if current_user.role not in {"super_admin", "admin"}:
        own = await repo.get_by_id(current_user.user_id, current_user.org_id)
        docs = [own] if own else []
    else:
        docs = await repo.list_by_org(current_user.org_id, skip=0, limit=500)
    return [UserPublic(**to_public_user(d)) for d in docs if d.get("isActive", True)]


@router.get("/{user_id}", response_model=UserPublic)
async def get_user(
    user_id: str,
    current_user: CurrentUser = Depends(require_permission("users.manage")),
    db: Any = Depends(get_db),
) -> UserPublic:
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    repo = UserRepository(db)
    user = await repo.get_by_id(
        user_id, org_id=None if current_user.is_super_admin else current_user.org_id
    )
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return UserPublic(**to_public_user(user))


@router.put("/{user_id}", response_model=UserPublic)
async def update_user(
    user_id: str,
    payload: UserUpdate,
    current_user: CurrentUser = Depends(require_permission("users.manage")),
    db: Any = Depends(get_db),
) -> UserPublic:
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    repo = UserRepository(db)
    target = await repo.get_by_id(
        user_id, org_id=None if current_user.is_super_admin else current_user.org_id
    )
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    updates: dict[str, Any] = {}
    if payload.name is not None:
        updates["name"] = payload.name
    if payload.jobAccess is not None:
        if target.get('role') in {'admin','super_admin'} and not current_user.is_super_admin:
            raise HTTPException(status_code=403,detail='Only a super administrator can change administrator access')
        updates['jobAccess'] = payload.jobAccess
    if payload.isActive is not None:
        updates["isActive"] = payload.isActive
    if payload.role is not None:
        if payload.role in (UserRole.ADMIN, UserRole.SUPER_ADMIN):
            if "roles.assign_admin" not in current_user.permissions:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Forbidden: requires 'roles.assign_admin' to assign admin roles",
                )
        updates["role"] = payload.role.value

    updated = await repo.update(user_id, updates)
    if 'jobAccess' in updates:
        from ..models.hiring import AuditLogRepository
        await AuditLogRepository(db).log(org_id=target['orgId'],actor_user_id=current_user.user_id,
            action='user.job_access_changed',resource_type='user',resource_id=user_id,
            details={'from':target.get('jobAccess'),'to':updates['jobAccess']})
    return UserPublic(**to_public_user(updated))


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: str,
    current_user: CurrentUser = Depends(require_permission("users.manage")),
    db: Any = Depends(get_db),
) -> None:
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    if user_id == current_user.user_id:
        raise HTTPException(status_code=400, detail="Cannot delete your own user account")

    repo = UserRepository(db)
    target = await repo.get_by_id(
        user_id, org_id=None if current_user.is_super_admin else current_user.org_id
    )
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    # If deleting a super_admin, require caller to be super_admin
    if target.get("role") == Role.SUPER_ADMIN.value and not current_user.is_super_admin:
        raise HTTPException(status_code=403, detail="Only super_admin can delete another super_admin")

    await repo.delete(user_id)
