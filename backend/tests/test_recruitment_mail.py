"""Recruitment-only overrides cannot alter assessment delivery configuration."""

import pytest
from app.config import settings, Settings, validate_settings
from app.services import recruitment_mail as mail


async def test_private_sender_preserves_assessment_settings_and_credentials(
    monkeypatch,
):
    monkeypatch.setattr(
        settings, "recruitment_zeptomail_api_key", "synthetic-recruitment-key"
    )
    monkeypatch.setattr(settings, "recruitment_email_dry_run", False)
    monkeypatch.setattr(
        settings, "recruitment_email_test_recipient_allowlist", "allowed@example.test"
    )
    monkeypatch.setattr(settings, "email_dry_run", True)
    monkeypatch.setattr(settings, "zeptomail_api_key", "synthetic-assessment-key")
    captured = {}

    class Response:
        status_code = 200

    class Client:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def post(self, url, **kwargs):
            captured.update(kwargs)
            return Response()

    monkeypatch.setattr(mail.httpx, "AsyncClient", Client)
    assert not mail.dry_run() and mail.recipient_allowed("allowed@example.test")
    assert not mail.recipient_allowed("other@example.test")
    assert (
        await mail.send_via_zepto(
            "allowed@example.test", "Synthetic recipient", "Test", "<p>Synthetic</p>"
        )
        == "accepted"
    )
    assert captured["headers"]["Authorization"] == "synthetic-recruitment-key"
    assert (
        settings.email_dry_run
        and settings.zeptomail_api_key == "synthetic-assessment-key"
    )


async def test_private_mail_retries_transient_failure_and_rejects_credentials(
    monkeypatch,
):
    monkeypatch.setattr(settings, "recruitment_zeptomail_api_key", "synthetic-key")
    calls = []

    class Response:
        def __init__(self, status):
            self.status_code = status

    class Client:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def post(self, *args, **kwargs):
            calls.append(1)
            return Response(503)

    async def no_sleep(*args):
        pass

    monkeypatch.setattr(mail.httpx, "AsyncClient", Client)
    monkeypatch.setattr(mail.asyncio, "sleep", no_sleep)
    with pytest.raises(mail.EmailSendError):
        await mail.send_via_zepto("allowed@example.test", "", "Test", "<p>Test</p>")
    assert len(calls) == 3

    async def refused(*args, **kwargs):
        return Response(401)

    monkeypatch.setattr(Client, "post", refused)
    with pytest.raises(mail.EmailSendError, match="refused"):
        await mail.send_via_zepto("allowed@example.test", "", "Test", "<p>Test</p>")


def test_live_recruitment_requires_named_allowlist(monkeypatch):
    candidate = Settings(
        recruitment_portals_enabled=True,
        mongodb_database="primehire_admin_v2",
        recruitment_email_dry_run=False,
        recruitment_zeptomail_api_key="synthetic-key",
        recruitment_email_test_recipient_allowlist="",
        email_test_recipient_allowlist="",
    )
    with pytest.raises(
        RuntimeError, match="RECRUITMENT_EMAIL_TEST_RECIPIENT_ALLOWLIST"
    ):
        validate_settings(candidate)
