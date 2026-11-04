"""Opt-in real-broker smoke test; uses only synthetic in-memory job records."""
import asyncio
import os
import uuid

import pytest

from app.config import settings
from app.models.resume_intake import now
from app.services import resume_kafka, worker


@pytest.mark.skipif(not os.environ.get('KAFKA_TEST_BOOTSTRAP_SERVERS'), reason='No local Kafka test broker selected')
async def test_real_broker_delivers_thousand_job_ids_one_at_a_time(db, monkeypatch):
    from aiokafka import AIOKafkaProducer, AIOKafkaConsumer, TopicPartition
    bootstrap = os.environ['KAFKA_TEST_BOOTSTRAP_SERVERS']
    monkeypatch.setattr(settings, 'resume_kafka_enabled', True)
    monkeypatch.setattr(settings, 'free_tier_guard_enabled', False)
    topic = 'elitehr-smoke-' + uuid.uuid4().hex
    monkeypatch.setattr(resume_kafka, 'TOPIC', topic)
    stamp = now()
    await db.background_jobs.insert_many([{'jobId': uuid.uuid4().hex, 'orgId': 'synthetic',
        'kind': 'resume_intake_parse', 'payload': {'itemId': str(index)},
        'status': 'pending', 'attempts': 0, 'maxAttempts': 5, 'runAfter': stamp,
        'leaseUntil': None, 'createdAt': stamp, 'updatedAt': stamp} for index in range(1000)])
    active = 0
    processed = set()
    async def parse(db, job):
        nonlocal active
        active += 1
        assert active == 1
        assert job['jobId'] not in processed
        processed.add(job['jobId'])
        await asyncio.sleep(0)
        active -= 1
        return {'parsed': True}
    monkeypatch.setitem(worker.HANDLERS, 'resume_intake_parse', parse)
    producer = AIOKafkaProducer(bootstrap_servers=bootstrap, enable_idempotence=True)
    consumer = AIOKafkaConsumer(topic, bootstrap_servers=bootstrap,
        group_id='synthetic-' + uuid.uuid4().hex, auto_offset_reset='earliest', enable_auto_commit=False)
    try:
        await producer.start()
        for _ in range(10):
            assert await resume_kafka.relay_once(db, producer) == 100
        await consumer.start()
        for _ in range(1000):
            message = await asyncio.wait_for(consumer.getone(), timeout=30)
            await resume_kafka.handle_message(db, message.value)
            await consumer.commit({TopicPartition(message.topic, message.partition): message.offset + 1})
        assert len(processed) == 1000
        assert await db.background_jobs.count_documents({'status': 'done'}) == 1000
    finally:
        await consumer.stop()
        await producer.stop()
