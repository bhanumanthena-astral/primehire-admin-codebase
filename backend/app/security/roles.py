"""Role definitions, permissions catalogue, and role-to-permission mappings (§7 DECISIONS.md)."""

from __future__ import annotations

from enum import Enum


class Role(str, Enum):
    SUPER_ADMIN = "super_admin"
    ADMIN = "admin"
    HR = "hr"
    TECHNICAL_INTERVIEWER = "technical_interviewer"
    MANAGERIAL_INTERVIEWER = "managerial_interviewer"
    RECRUITER = "recruiter"
    VIEWER = "viewer"


PERMISSIONS = frozenset({
    "google.connect",
    "candidates.view", "candidates.manage",
    "assessments.view", "assessments.manage",
    "recruitment.view", "recruitment.manage", "recruitment.review",
    "users.manage",
    "roles.assign_admin",
    "org.settings",
    "jobs.manage",
    "jobs.view",
    "resumes.upload",
    "applications.view_all",
    "applications.assign",
    "applications.transition",
    "applications.override_stage",
    "reviews.read_all",
    "reports.view", "reports.refresh", "reports.export", "reports.manage_versions",
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
        "candidates.view", "candidates.manage",
        "assessments.view", "assessments.manage",
        "recruitment.view", "recruitment.manage", "recruitment.review",
        "users.manage",
        "jobs.manage",
    "jobs.view",
        "resumes.upload",
        "applications.view_all",
        "applications.assign",
        "applications.transition",
        "reviews.read_all",
        "reports.view", "reports.refresh", "reports.export", "reports.manage_versions",
        "talent_pool.manage",
        "audit.view",
        "data.export",
    }),
    Role.HR.value: frozenset({
        "candidates.view", "candidates.manage",
        "assessments.view", "assessments.manage",
        "recruitment.view", "recruitment.review",
        "jobs.manage",
    "jobs.view",
        "resumes.upload",
        "applications.view_all",
        "applications.assign",
        "applications.transition",
        "reviews.read_all", "reports.view", "reports.refresh",
        "talent_pool.manage",
    }),
    Role.RECRUITER.value: frozenset({"reports.view", "reports.refresh", "applications.transition", "candidates.view", "candidates.manage", "assessments.view", "assessments.manage", "jobs.view", "jobs.manage", "resumes.upload", "recruitment.view", "recruitment.manage"}),
    Role.VIEWER.value: frozenset({"candidates.view", "assessments.view", "jobs.view"}),
    Role.TECHNICAL_INTERVIEWER.value: frozenset({
        "recruitment.view", "recruitment.review",
        "applications.view_all",
        "reviews.read_all", "reports.view",
    }),
    Role.MANAGERIAL_INTERVIEWER.value: frozenset({
        "recruitment.view", "recruitment.review",
        "applications.view_all",
        "reviews.read_all", "reports.view",
    }),
}


ROLE_PERMISSIONS = {role: permissions | frozenset({'google.connect'}) for role, permissions in ROLE_PERMISSIONS.items()}


def get_permissions_for_role(role: str) -> frozenset[str]:
    """Return permissions set for a given role name."""
    return ROLE_PERMISSIONS.get(role, frozenset())


def has_permission(role: str, permission: str) -> bool:
    """Return True if the role grants the specified permission."""
    return permission in get_permissions_for_role(role)
