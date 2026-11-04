from tests.test_resume_intake_v2 import client, upload, word
from app.config import settings
from app.services import capacity_guard


async def test_host_reservations_block_overflow_across_tenants(client, db, monkeypatch):
    monkeypatch.setattr(settings, 'free_tier_guard_enabled', True)
    monkeypatch.setattr(capacity_guard, 'require_capacity', lambda **kwargs: {})
    await db.resume_intake_batches.insert_one({'orgId': 'another-tenant', 'imported': False,
        'reservedItems': 1000})
    response = await upload(client, word())
    assert response.status_code == 429, response.text
    assert await db.resume_intake_batches.count_documents({'orgId': 'default'}) == 0


async def test_replay_does_not_consume_another_admission_slot(client, db, monkeypatch):
    monkeypatch.setattr(settings, 'free_tier_guard_enabled', True)
    monkeypatch.setattr(capacity_guard, 'require_capacity', lambda **kwargs: {})
    document = word()
    first = await upload(client, document)
    assert first.status_code == 202, first.text
    await db.resume_intake_batches.insert_one({'orgId': 'another-tenant', 'imported': False,
        'reservedItems': 999})
    replay = await upload(client, document)
    assert replay.status_code == 202, replay.text
    assert replay.json()['batchId'] == first.json()['batchId']
    assert await db.resume_intake_batches.count_documents({'orgId': 'default'}) == 1
