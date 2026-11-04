import json
from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.config import settings
from app.models.jobs import BackgroundJobRepository
from app.models.resume_intake import now
from app.services import capacity_guard, resume_kafka, worker


def resources(monkeypatch, available=6000, free=80):
    original = Path.read_text
    def read(path, *args, **kwargs):
        if str(path).replace('\\', '/') == '/proc/meminfo':
            return f'MemTotal: 8000 kB\nMemAvailable: {available} kB\n'
        if str(path).replace('\\', '/') == '/proc/stat':
            return 'cpu 100 0 50 850 0 0 0 0\n'
        return original(path, *args, **kwargs)
    monkeypatch.setattr(Path, 'read_text', read)
    monkeypatch.setattr(capacity_guard.os, 'sched_getaffinity', lambda _: {0}, raising=False)
    monkeypatch.setattr(capacity_guard.shutil, 'disk_usage', lambda _: SimpleNamespace(
        total=100 * 1024**3, free=free * 1024**3))
    monkeypatch.setattr(settings, 'free_tier_guard_enabled', True)


def test_guard_pauses_before_reserve_and_fails_closed(monkeypatch):
    resources(monkeypatch)
    assert capacity_guard.require_capacity()['state'] == 'healthy'
    resources(monkeypatch, available=2300)
    with pytest.raises(HTTPException) as error:
        capacity_guard.require_capacity()
    assert error.value.status_code == 503
    resources(monkeypatch, free=31)
    with pytest.raises(HTTPException):
        capacity_guard.require_capacity(required_bytes=2 * 1024**3)
    monkeypatch.setattr(Path, 'read_text', lambda *a, **k: (_ for _ in ()).throw(OSError()))
    assert capacity_guard.capacity_snapshot()['state'] == 'paused'


async def enqueue(db, index=0):
    return await BackgroundJobRepository(db).enqueue(org_id='org', kind='resume_intake_parse',
        entity_type='resume_intake_item', entity_key=str(index), payload={'itemId': str(index)})


async def test_thousand_intents_survive_broker_failure_and_duplicate_delivery(db, monkeypatch):
    monkeypatch.setattr(settings, 'resume_kafka_enabled', True)
    monkeypatch.setattr(settings, 'free_tier_guard_enabled', False)
    repo = BackgroundJobRepository(db)
    for index in range(1000):
        await enqueue(db, index)
    assert await repo.claim_next(['resume_intake_parse']) is None
    messages = []
    class Producer:
        async def send_and_wait(self, topic, value, **kwargs):
            messages.append(value)
    producer = Producer()
    for _ in range(10):
        assert await resume_kafka.relay_once(db, producer) == 100
    assert len(messages) == 1000
    assert all(set(json.loads(value)) == {'jobId'} for value in messages)
    assert await resume_kafka.relay_once(db, producer) == 0
    calls = []
    async def parse(db, job):
        calls.append(job['jobId'])
        return {'parsed': True}
    monkeypatch.setitem(worker.HANDLERS, 'resume_intake_parse', parse)
    await resume_kafka.handle_message(db, messages[0])
    await resume_kafka.handle_message(db, messages[0])
    assert len(calls) == 1
    assert await db.background_jobs.count_documents({'status': 'pending'}) == 999
    # Retention or a broker restart cannot destroy the Mongo intent.
    await db.background_jobs.update_many({'status': 'pending'},
        {'$set': {'kafkaPublishedAt': now() - timedelta(minutes=2)}})
    assert await resume_kafka.relay_once(db, producer) == 100


async def test_failed_publish_never_marks_intent_delivered(db):
    job = await enqueue(db)
    class BrokenProducer:
        async def send_and_wait(self, *args, **kwargs):
            raise OSError('broker unavailable')
    with pytest.raises(OSError):
        await resume_kafka.relay_once(db, BrokenProducer())
    stored = await db.background_jobs.find_one({'jobId': job['jobId']})
    assert stored['status'] == 'pending'
    assert not stored.get('kafkaPublishedAt')


async def test_super_admin_only_capacity_visibility(db, monkeypatch):
    from app.api.diagnostics import get_capacity, get_diagnostics
    await db.deployment_health.insert_one({'_id': 'local-capacity', 'state': 'paused'})
    user = SimpleNamespace(role='admin', org_id='org')
    with pytest.raises(HTTPException) as error:
        await get_capacity(user, db)
    assert error.value.status_code == 403
    assert (await get_diagnostics(user, db))['capacity'] is None
    user.role = 'super_admin'
    assert (await get_capacity(user, db))['capacity']['state'] == 'paused'
    assert (await get_diagnostics(user, db))['capacity']['state'] == 'paused'
