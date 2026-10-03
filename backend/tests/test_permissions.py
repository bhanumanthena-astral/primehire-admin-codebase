"""Tests for role and permissions system."""

from app.security.roles import Role, PERMISSIONS, ROLE_PERMISSIONS, get_permissions_for_role, has_permission


def test_super_admin_has_all_permissions():
    perms = get_permissions_for_role(Role.SUPER_ADMIN.value)
    assert perms == PERMISSIONS
    assert has_permission(Role.SUPER_ADMIN.value, "roles.assign_admin")
    assert has_permission(Role.SUPER_ADMIN.value, "portal.view_as")


def test_admin_permissions_restricted():
    perms = get_permissions_for_role(Role.ADMIN.value)
    assert "users.manage" in perms
    assert "jobs.manage" in perms
    # Admin cannot assign admin role or view as other users
    assert "roles.assign_admin" not in perms
    assert "portal.view_as" not in perms
    assert not has_permission(Role.ADMIN.value, "portal.view_as")


def test_interviewers_read_only():
    tech_perms = get_permissions_for_role(Role.TECHNICAL_INTERVIEWER.value)
    assert "applications.view_all" in tech_perms
    assert "reviews.read_all" in tech_perms
    assert "users.manage" not in tech_perms
    assert "jobs.manage" not in tech_perms
    assert "applications.transition" not in tech_perms
