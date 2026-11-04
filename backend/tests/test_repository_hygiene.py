"""Private credential setup and repository cleanup checks use only synthetic data."""
import importlib.util
import json
import sys
from pathlib import Path

import pytest
from cryptography.fernet import Fernet
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[2]


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def oauth_setup(tmp_path, monkeypatch):
    module = load('configure_google_oauth')
    monkeypatch.setattr(module, 'ROOT', tmp_path)
    backend = tmp_path / 'backend'
    backend.mkdir()
    key = Fernet.generate_key().decode()
    env = backend / '.env'
    env.write_text('ENV=local\nMONGODB_DATABASE=primehire_admin_v2\nGOOGLE_TOKEN_ENCRYPTION_KEY=' + key + '\n', encoding='utf-8')
    source = tmp_path / 'client.json'
    source.write_text(json.dumps({'web': {'client_id': 'synthetic-client-id',
        'client_secret': 'synthetic-client-secret-value'}}), encoding='utf-8')
    return module, env, source, key


def arguments(monkeypatch, source, *extra):
    monkeypatch.setattr(sys, 'argv', ['configure_google_oauth.py', '--client-json', str(source),
        '--redirect-uri', 'http://localhost:3000/api/auth/google/callback', *extra])


def test_setup_requires_confirmation_when_google_json_omits_redirect_metadata(oauth_setup, monkeypatch):
    module, env, source, _ = oauth_setup
    before = env.read_bytes()
    arguments(monkeypatch, source)
    with pytest.raises(SystemExit):
        module.main()
    assert env.read_bytes() == before


def test_confirmed_local_setup_preserves_existing_key_without_echoing_credentials(oauth_setup, monkeypatch, capsys):
    module, env, source, key = oauth_setup
    arguments(monkeypatch, source, '--confirm-registered-redirect')
    module.main()
    values = dotenv_values(env)
    assert values['GOOGLE_OAUTH_ENABLED'] == 'true'
    assert values['GOOGLE_TOKEN_ENCRYPTION_KEY'] == key
    assert values['GOOGLE_CLIENT_SECRET'] == 'synthetic-client-secret-value'
    assert values['MONGODB_DATABASE'] == 'primehire_admin_v2'
    output = capsys.readouterr()
    assert 'synthetic-client-secret-value' not in output.out + output.err


def test_setup_rejects_installed_client_without_changing_backend(oauth_setup, monkeypatch):
    module, env, source, _ = oauth_setup
    before = env.read_bytes()
    source.write_text(json.dumps({'installed': {'client_id': 'synthetic'}}), encoding='utf-8')
    arguments(monkeypatch, source, '--confirm-registered-redirect')
    with pytest.raises(SystemExit):
        module.main()
    assert env.read_bytes() == before


@pytest.mark.parametrize('name', ['client_secret_synthetic.json', 'backend/secrets/google.json',
    'scratch/probe.js', '.env.local', 'backend/storage/resume.pdf', 'dist/index.html', 'frontend/node_modules/react/index.js'])
def test_private_and_generated_paths_cannot_enter_git(name):
    audit = load('audit_repository')
    assert audit.findings_for(name, b'content', {})[0]['rule'] == 'private_or_generated_file'


def test_guard_reports_paths_and_rules_without_secret_values():
    audit = load('audit_repository')
    secret = 'z' * 48
    body = ('const headers = ' + json.dumps({'x-secret-key': secret})).encode()
    findings = audit.findings_for('scripts/probe.js', body, {secret: 'PRIMEHIRE_SECRET_KEY'})
    assert {row['rule'] for row in findings} == {'embedded_provider_credential', 'configured_secret_in_source'}
    assert secret not in json.dumps(findings)
    assert audit.findings_for('backend/tests/fixture.py', b"GOOGLE_CLIENT_SECRET = 'synthetic-client-secret-value'", {}) == []


def test_guard_recognizes_google_secrets_without_relying_on_local_env():
    audit = load('audit_repository')
    token = 'GOCSPX-' + 'z' * 32
    findings = audit.findings_for('scripts/example.json', token.encode(), {})
    assert findings == [{'path': 'scripts/example.json', 'rule': 'google_oauth_secret'}]
    assert token not in json.dumps(findings)


def test_configuration_repr_never_exposes_secrets_or_database_credentials():
    from app.config import Settings
    secret = 'synthetic-sensitive-setting-value'
    candidate = Settings(_env_file=None, google_client_secret=secret, google_token_encryption_key=secret,
        jwt_secret=secret, primehire_access_key=secret, primehire_secret_key=secret,
        mongodb_uri='mongodb://synthetic:'+secret+'@localhost:27017', openrouter_api_key=secret,
        outbox_encryption_key=secret, recruitment_outbox_encryption_key=secret, zeptomail_api_key=secret)
    assert secret not in repr(candidate)
    assert secret not in str(candidate)
