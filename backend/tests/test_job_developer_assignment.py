"""Developer assignment persists and synchronizes the reviewer queue."""
from tests.test_hiring_api import client, mock_db
from tests.conftest import auth_headers, ensure_user, post_job
from app.security.deps import get_db


def test_assign_replace_and_clear_developer(client):
    admin = auth_headers()
    job = post_job(client, admin, admin, "DEVELOPER-ASSIGN")
    developers = [ensure_user(client, admin, role="technical_interviewer") for _ in range(2)]
    path = f"/api/jobs/{job['jobId']}/developer-assignment"
    database = client.app.dependency_overrides[get_db]()
    for developer in developers:
        response = client.put(path, headers=admin, json={"userId": developer})
        assert response.status_code == 200, response.text
        assert response.json()["assignedDeveloperUserId"] == developer
        profile = client.portal.call(database.recruit_profiles.find_one, {"userId": developer})
        assert job["jobId"] in profile["reviewJobIds"]
        assert "assessment" in profile["visibleFields"]
        detail = client.get(f"/api/jobs/{job['jobId']}", headers=auth_headers(role="technical_interviewer", user_id=developer))
        assert detail.status_code == 200, detail.text
    previous = client.portal.call(database.recruit_profiles.find_one, {"userId": developers[0]})
    assert job["jobId"] not in previous["reviewJobIds"]
    response = client.put(path, headers=admin, json={"userId": None})
    assert response.status_code == 200, response.text
    assert response.json()["assignedDeveloperUserId"] is None
    profile = client.portal.call(database.recruit_profiles.find_one, {"userId": developers[1]})
    assert job["jobId"] not in profile["reviewJobIds"]


def test_developer_assignment_rejects_invalid_target_and_non_admin(client):
    admin = auth_headers()
    job = post_job(client, admin, admin, "DEVELOPER-BOUNDARY")
    path = f"/api/jobs/{job['jobId']}/developer-assignment"
    hr = ensure_user(client, admin)
    assert client.put(path, headers=admin, json={"userId": hr}).status_code == 422
    assert client.put(path, headers=auth_headers(role="hr", user_id=hr), json={"userId": None}).status_code == 403
