"""Hermetic release/startup checks: no real database, mail, provider or cloud calls."""
import asyncio
import copy
import json
import tarfile
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from cryptography.fernet import Fernet
from app.config import Settings
from deploy.build_release import build, verify
from deploy.runtime import validate_deployment, v2_index_specs, check_dependencies
from deploy.oracle.host_config import private_write


@pytest.fixture
def production(tmp_path):
    return Settings(_env_file=None, env='production', debug=False,
        mongodb_database='primehire_admin_v2',
        mongodb_uri='mongodb://elitehr_app:synthetic-password@127.0.0.1:27017/primehire_admin_v2?authSource=primehire_admin_v2',
        resume_module_v2_enabled=True, recruitment_portals_enabled=True,
        jwt_secret='synthetic-jwt-secret-for-tests-only-123456',
        resume_identity_secret='synthetic-identity-for-tests-only-123456',
        outbox_encryption_key=Fernet.generate_key().decode(),
        recruitment_outbox_encryption_key='',
        zeptomail_api_key='synthetic-never-used', email_dry_run=False,
        email_from_address='sender@example.invalid', email_from_name='Test',
        recruitment_email_dry_run=True, allowed_origins='https://app.example.invalid',
        storage_dir=str(tmp_path), resume_clamd_host='127.0.0.1', clamav_enabled=True,
        llm_fake_provider='off')


def test_production_config_accepts_private_v2(production):
    validate_deployment(production)


@pytest.mark.parametrize('changes',[
    {'env':'development'}, {'mongodb_database':'primehire_admin'},
    {'mongodb_uri':'mongodb+srv://synthetic.invalid/primehire_admin_v2'},
    {'mongodb_uri':'mongodb://u:p@203.0.113.1:27017/primehire_admin_v2'},
    {'mongodb_uri':'mongodb://127.0.0.1:27017/primehire_admin_v2'},
    {'mongodb_uri':'mongodb://u:p@127.0.0.1:27017/primehire_admin'},
    {'mongodb_uri':'mongodb://root:synthetic@127.0.0.1:27017/primehire_admin_v2?authSource=admin'},
    {'mongodb_uri':'mongodb://invalid:port'},
    {'resume_clamd_host':'0.0.0.0'}, {'storage_dir':'relative-folder'},
    {'resume_module_v2_enabled':False}, {'recruitment_portals_enabled':False},
    {'jwt_secret':'__TRANSFER_SECURELY__'}, {'jwt_secret':'short'},
    {'resume_identity_secret':''}, {'outbox_encryption_key':'malformed'},
    {'zeptomail_api_key':''}, {'debug':True}, {'allowed_origins':'*'},
    {'clamav_enabled':False},
])
def test_deployment_rejects_unsafe_configuration(production, changes):
    with pytest.raises(RuntimeError):
        validate_deployment(production.model_copy(update=changes))


def test_indexes_change_only_private_copy():
    source = {'candidates':[
        ([('interviewId',1)],{'name':'uniq_interviewId_v2','partialFilterExpression':{'interviewId':{'$ne':None}}}),
        ([('name',1)],{'name':'unrelated'})],
        'applications':[([('jobId',1)],{'name':'uniq_active_application'})]}
    original = copy.deepcopy(source)
    result = v2_index_specs(source)
    assert source == original
    assert result['candidates'][0][1]['partialFilterExpression']['interviewId'] == {'$type':'string','$gt':''}
    assert result['candidates'][1] == source['candidates'][1]
    active = result['applications'][0][1]['partialFilterExpression']['currentStage']['$in']
    assert 'REJECTED' not in active and 'WITHDRAWN' not in active


@pytest.fixture
def extracted(tmp_path):
    source = tmp_path/'source'
    for directory in ['app','migrations','deploy']:
        (source/directory).mkdir(parents=True)
        (source/directory/'module.py').write_text('# synthetic source',encoding='utf-8')
    (source/'requirements-production.txt').write_text('fastapi==0.143.1',encoding='utf-8')
    for name in ['.env','storage/resume.pdf','tests/test_fake.py','frontend/index.html','deploy/private.env']:
        path = source/name
        path.parent.mkdir(exist_ok=True,parents=True)
        path.write_text('MUST_NOT_SHIP',encoding='utf-8')
    archive = build(source,tmp_path/'artifacts','test-01')
    target = tmp_path/'extracted'
    with tarfile.open(archive) as package:
        names = package.getnames()
        assert set(names) == {'app/module.py','migrations/module.py','deploy/module.py','requirements-production.txt','release.json'}
        package.extractall(target,filter='data')
    assert archive.with_suffix('.gz.sha256').is_file()
    return target


def test_backend_archive_excludes_data_and_secrets(extracted):
    assert verify(extracted) == 'test-01'


@pytest.mark.parametrize('mutation',['extra','modified','missing','identity','traversal'])
def test_manifest_rejects_unexpected_or_tampered_release(extracted, mutation):
    if mutation == 'extra':
        (extracted/'.env').write_text('private',encoding='utf-8')
    elif mutation == 'modified':
        (extracted/'app/module.py').write_text('changed',encoding='utf-8')
    elif mutation == 'missing':
        (extracted/'app/module.py').unlink()
    else:
        path = extracted/'release.json'
        manifest = json.loads(path.read_text(encoding='utf-8'))
        if mutation == 'identity':manifest['database'] = 'primehire_admin'
        else:manifest['files']['../outside.py'] = 'synthetic'
        path.write_text(json.dumps(manifest),encoding='utf-8')
    with pytest.raises(ValueError):verify(extracted)


def test_archive_rejects_unsafe_version(tmp_path):
    with pytest.raises(ValueError):build(tmp_path,tmp_path/'out','../../overwrite')


def test_private_configuration_never_overwrites(tmp_path):
    path = tmp_path/'private.env'
    private_write(path,'synthetic')
    with pytest.raises(RuntimeError):private_write(path,'replacement')
    assert path.read_text(encoding='utf-8') == 'synthetic'


@pytest.mark.asyncio
async def test_dependency_probe_uses_synthetic_scan_and_private_database(production,monkeypatch):
    import app.db.mongodb as mongo
    import app.services.resume_intake_security as scanner
    database = AsyncMock()
    calls = []
    monkeypatch.setattr(mongo,'get_database',lambda uri,name: database)
    monkeypatch.setattr(scanner,'scanner_ready',lambda: True)
    monkeypatch.setattr(scanner,'scan',lambda data: calls.append(data) or 'clean')
    await check_dependencies(production)
    database.command.assert_awaited_once_with('ping')
    assert calls == [b'Elite HR synthetic deployment readiness check']
    monkeypatch.setattr(scanner,'scan',lambda data:'scan_required')
    with pytest.raises(RuntimeError,match='synthetic scan'):await check_dependencies(production)
    monkeypatch.setattr(scanner,'scanner_ready',lambda:False)
    with pytest.raises(RuntimeError,match='not ready'):await check_dependencies(production)


@pytest.mark.asyncio
@pytest.mark.parametrize('kinds',[None,['assessment_send','email_send']])
async def test_worker_claim_filter_preserves_legacy_default(monkeypatch,kinds):
    import app.services.worker as worker
    calls = []
    async def claim(db,**kwargs):
        calls.append(kwargs)
        raise asyncio.CancelledError
    monkeypatch.setattr(worker,'run_once',claim)
    monkeypatch.setattr(asyncio.get_running_loop(),'add_signal_handler',lambda *args:None)
    with pytest.raises(asyncio.CancelledError):await worker.run_forever(object(),kinds=kinds)
    assert calls == ([{}] if kinds is None else [{'kinds':kinds}])


@pytest.mark.parametrize('changes', [
    {'resume_worker_concurrency': 2}, {'resume_kafka_enabled': False},
    {'resume_kafka_bootstrap_servers': 'public.example:9092'},
    {'openrouter_model': 'paid/model'}, {'free_tier_active_resume_limit': 2000},
])
def test_free_profile_rejects_parallel_or_paid_configuration(production, changes):
    config = production.model_copy(update={'free_tier_guard_enabled': True,
        'resume_kafka_enabled': True, 'resume_worker_concurrency': 1, **changes})
    with pytest.raises(RuntimeError):
        validate_deployment(config)
