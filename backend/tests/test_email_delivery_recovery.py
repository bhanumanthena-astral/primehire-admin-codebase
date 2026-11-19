"""Outbox recovery and delivery tests; no real providers or recipients."""
import asyncio
import json
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest
from cryptography.fernet import Fernet

from app.config import settings
from app.models.jobs import BackgroundJobRepository
from app.models.outbox import EmailOutboxRepository
from app.services import email_send
from app.services.outbox_crypto import encrypt_body
from app.services.worker import run_once


@pytest.fixture(autouse=True)
def mail_config(monkeypatch):
    monkeypatch.setattr(settings, 'outbox_encryption_key', Fernet.generate_key().decode())
    monkeypatch.setattr(settings, 'email_dry_run', False)
    monkeypatch.setattr(email_send, 'recipient_allowed', lambda _: True)
    monkeypatch.setattr(email_send, 'mail_configuration', AsyncMock(return_value=None))
    monkeypatch.setattr(email_send, 'send_via_zepto', AsyncMock(return_value='accepted'))


async def message(db):
    return await EmailOutboxRepository(db).enqueue(org_id='test', kind='job_assigned',
        entity_type='job', entity_key='job-1', to_email='test@example.invalid', to_name='Test',
        subject='Invitation', payload_encrypted=encrypt_body(json.dumps({'to':'test@example.invalid','html':'Hello'})))


@pytest.mark.asyncio
async def test_orphan_outbox_is_recovered_and_sent_once(db):
    msg = await message(db)
    assert await email_send.recover_email_jobs(db) == 1
    assert await email_send.recover_email_jobs(db) == 0
    assert (await run_once(db, kinds=['email_send']))['status'] == 'done'
    saved = await EmailOutboxRepository(db).get(msg['messageId'], 'test', include_body=True)
    assert saved['status'] == 'sent' and saved['deliveryStatus'] == 'accepted'
    assert saved['payloadEncrypted'] is None
    assert await email_send.recover_email_jobs(db) == 0
    email_send.send_via_zepto.assert_awaited_once()


@pytest.mark.asyncio
async def test_transient_failure_defers_job_until_outbox_retry(db):
    msg = await message(db)
    await email_send.recover_email_jobs(db)
    email_send.send_via_zepto.side_effect = email_send.EmailSendError('Provider unavailable')
    assert (await run_once(db, kinds=['email_send']))['status'] == 'deferred'
    saved = await EmailOutboxRepository(db).get(msg['messageId'], 'test')
    job = await db.background_jobs.find_one({'kind':'email_send'})
    assert job['runAfter'] == saved['nextRetryAt']
    assert await run_once(db, kinds=['email_send']) is None
    email_send.send_via_zepto.side_effect = None
    past = datetime.now(timezone.utc) - timedelta(seconds=1)
    await db.email_outbox.update_one({'messageId':msg['messageId']}, {'$set':{'nextRetryAt':past}})
    await db.background_jobs.update_one({'jobId':job['jobId']}, {'$set':{'runAfter':past}})
    assert (await run_once(db, kinds=['email_send']))['status'] == 'done'
    assert (await EmailOutboxRepository(db).get(msg['messageId'], 'test'))['status'] == 'sent'


@pytest.mark.asyncio
async def test_permanent_failure_and_manual_retry_revive_completed_job(db):
    msg = await message(db)
    await email_send.recover_email_jobs(db)
    error = email_send.EmailSendError('Credentials rejected')
    error.status_code = 401
    email_send.send_via_zepto.side_effect = error
    await run_once(db, kinds=['email_send'])
    assert (await EmailOutboxRepository(db).get(msg['messageId'], 'test'))['status'] == 'failed'
    assert await email_send.recover_email_jobs(db) == 0
    assert not await EmailOutboxRepository(db).requeue(msg['messageId'], 'other-org')
    assert await EmailOutboxRepository(db).requeue(msg['messageId'], 'test')
    assert await email_send.recover_email_jobs(db) == 1
    email_send.send_via_zepto.side_effect = None
    await run_once(db, kinds=['email_send'])
    assert (await EmailOutboxRepository(db).get(msg['messageId'], 'test'))['status'] == 'sent'


@pytest.mark.asyncio
async def test_concurrent_delivery_claim_and_exhausted_crash_recovery(db):
    msg = await message(db)
    job = {'orgId':'test', 'payload':{'messageId':msg['messageId']}}
    await asyncio.gather(email_send.process_email_job(db, job), email_send.process_email_job(db, job))
    email_send.send_via_zepto.assert_awaited_once()
    await db.email_outbox.update_one({'messageId':msg['messageId']}, {'$set':{
        'status':'sending', 'attempts':5, 'updatedAt':datetime.now(timezone.utc)-timedelta(minutes=6)}})
    await email_send.process_email_job(db, job)
    assert (await EmailOutboxRepository(db).get(msg['messageId'], 'test'))['status'] == 'failed'
    email_send.send_via_zepto.assert_awaited_once()


def test_production_assessment_worker_consumes_emails(monkeypatch):
    import sys
    from deploy import runtime
    from app.db import mongodb
    from app.services import worker
    monkeypatch.setattr(sys, 'argv', ['runtime', 'assessment'])
    monkeypatch.setattr(runtime, 'validate_deployment', lambda _: None)
    monkeypatch.setattr(runtime, 'v2_index_specs', lambda specs: specs)
    monkeypatch.setattr(mongodb, 'get_database', lambda *args: object())
    run = AsyncMock()
    monkeypatch.setattr(worker, 'run_forever', run)
    runtime.main()
    assert 'email_send' in run.call_args.kwargs['kinds']
