from cryptography.fernet import Fernet
from app.config import settings
from app.security.recruitment import project_application
from app.services.candidate_link_crypto import encrypt_link


def test_credentials_only_for_contact_authorized_view(monkeypatch):
    monkeypatch.setattr(settings,'outbox_encryption_key',Fernet.generate_key().decode())
    row={'assessment':{'state':'link_created','link':'https://example.test/assessment','accessCodeEncrypted':encrypt_link('PrivateCode123')}}
    visible=project_application(row,{'assessment','contact'})['assessment']
    assert visible['password']=='PrivateCode123'
    assert visible['link']=='https://example.test/assessment'
    assert 'accessCodeEncrypted' not in visible
    restricted=project_application(row,{'assessment'})['assessment']
    assert 'password' not in restricted and 'link' not in restricted


def test_unreadable_code_does_not_break_candidate_list(monkeypatch):
    monkeypatch.setattr(settings,'outbox_encryption_key',Fernet.generate_key().decode())
    result=project_application({'assessment':{'accessCodeEncrypted':'invalid'}},{'assessment','contact'})
    assert result['assessment']['passwordUnavailable'] is True
    assert 'password' not in result['assessment']
