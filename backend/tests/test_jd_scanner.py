import pytest
from app.config import settings
from app.services import clamav, resume_intake_security
from tests.test_jd_document import client, mock_db, make_pdf_bytes, JD_PROSE_LINES, _upload, _hr


@pytest.mark.parametrize('result,expected', [
    ('clean', clamav.CLEAN),
    ('virus_detected', clamav.QUARANTINED),
    ('scan_required', clamav.SCAN_UNAVAILABLE),
    ('unexpected', clamav.SCAN_UNAVAILABLE),
])
def test_enabled_adapter_uses_real_scanner(monkeypatch, result, expected):
    monkeypatch.setattr(settings, 'clamav_enabled', True)
    monkeypatch.setattr(resume_intake_security, 'scan', lambda data: result)
    assert clamav.scan_bytes(b'fixture') == expected


def test_scanner_exception_is_unavailable(monkeypatch):
    monkeypatch.setattr(settings, 'clamav_enabled', True)
    def fail(data):
        raise OSError('scanner offline')
    monkeypatch.setattr(resume_intake_security, 'scan', fail)
    assert clamav.scan_bytes(b'fixture') == clamav.SCAN_UNAVAILABLE


@pytest.mark.parametrize('mode', ['template', 'document'])
def test_jd_unavailable_scan_never_parses(client, monkeypatch, mode):
    from app.api import hiring
    monkeypatch.setattr(settings, 'clamav_enabled', True)
    monkeypatch.setattr(resume_intake_security, 'scan', lambda data: 'scan_required')
    def forbidden(*args, **kwargs):
        pytest.fail('Unscanned file reached extraction')
    monkeypatch.setattr(hiring, 'parse_bytes_isolated', forbidden)
    result = _upload(client, make_pdf_bytes(JD_PROSE_LINES), 'jd.pdf', _hr(), mode)
    assert result.status_code == 503
    assert result.json()['detail'] == clamav.UNAVAILABLE_MESSAGE


def test_jd_clean_scan_extracts(client, monkeypatch):
    monkeypatch.setattr(settings, 'clamav_enabled', True)
    monkeypatch.setattr(resume_intake_security, 'scan', lambda data: 'clean')
    result = _upload(client, make_pdf_bytes(JD_PROSE_LINES), 'jd.pdf', _hr(), 'document')
    assert result.status_code == 200, result.text


@pytest.mark.parametrize('mode', ['template', 'document'])
def test_jd_detected_malware_is_rejected(client, monkeypatch, mode):
    monkeypatch.setattr(settings, 'clamav_enabled', True)
    monkeypatch.setattr(resume_intake_security, 'scan', lambda data: 'virus_detected')
    result = _upload(client, make_pdf_bytes(JD_PROSE_LINES), 'jd.pdf', _hr(), mode)
    assert result.status_code == 422


def test_readiness_reports_scanner_outage(client, monkeypatch):
    from app.api import health
    monkeypatch.setattr(settings, 'clamav_enabled', True)
    monkeypatch.setattr(resume_intake_security, 'scan', lambda data: 'scan_required')
    monkeypatch.setattr(health, '_storage_writable', lambda: True)
    result = client.get('/api/ready')
    assert result.status_code == 503
    assert result.json()['checks']['scanner'] == 'unavailable'
