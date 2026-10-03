"""Role definitions, permissions catalogue, and role-to-permission mappings (§7 DECISIONS.md)."""

from __future__ import annotations

from enum import Enum


class Role(str, Enum):
    SUPER_ADMIN = "super_admin"
    ADMIN = "admin"
    HR = "hr"
    TECHNICAL_INTERVIEWER = "technical_interviewer"
    MANAGERIAL_INTERVIEWER = "managerial_interviewer"


PERMISSIONS = frozenset({
    "users.manage",
    "roles.assign_admin",
    "org.settings",
    "jobs.manage",
    "resumes.upload",
    "applications.view_all",
    "applications.assign",
    "applications.transition",
    "applications.override_stage",
    "reviews.read_all",
    "reviews.unlock",
    "talent_pool.manage",
    "audit.view",
    "data.export",
    "data.erase",
    "portal.view_as",
})

# Complete mapping from Role to its permitted set
ROLE_PERMISSIONS: dict[str, frozenset[str]] = {
    Role.SUPER_ADMIN.value: PERMISSIONS,
    Role.ADMIN.value: frozenset({
        "users.manage",
        "jobs.manage",
        "resumes.upload",
        "applications.view_all",
        "applications.assign",
        "applications.transition",
        "reviews.read_all",
        "talent_pool.manage",
        "audit.view",
        "data.export",
    }),
    Role.HR.value: frozenset({
        "jobs.manage",
        "resumes.upload",
        "applications.view_all",
        "applications.assign",
        "applications.transition",
        "reviews.read_all",
        "talent_pool.manage",
    }),
    Role.TECHNICAL_INTERVIEWER.value: frozenset({
        "applications.view_all",
        "reviews.read_all",
    }),
    Role.MANAGERIAL_INTERVIEWER.value: frozenset({
        "applications.view_all",
        "reviews.read_all",
    }),
}


def get_permissions_for_role(role: str) -> frozenset[str]:
    """Return permissions set for a given role name."""
    return ROLE_PERMISSIONS.get(role, frozenset())


def has_permission(role: str, permission: str) -> bool:
    """Return True if the role grants the specified permission."""
    return permission in get_permissions_for_role(role)
