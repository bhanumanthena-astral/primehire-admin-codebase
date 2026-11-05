"""Five-job and two-document live-broker checks in isolated validation schemas."""
import asyncio
import json
import io
import os
import uuid

import pytest

from app.config import settings
from app.models.jobs import BackgroundJobRepository
from app.models.resume_intake import now
from app.services import resume_kafka, resume_intake_security, worker
from tests.test_resume_intake_v2 import client, upload, word, first, reveal, confirm_http, drain

REAL_SCAN = resume_intake_security.scan
pytestmark = pytest.mark.skipif(not os.environ.get('ELITEHR_SMALL_KAFKA_BOOTSTRAP'), reason='Explicit small-workload broker required')


async def broker(topic, group):
    from aiokafka import AIOKafkaProducer, AIOKafkaConsumer
    bootstrap = os.environ['ELITEHR_SMALL_KAFKA_BOOTSTRAP']
    producer = AIOKafkaProducer(bootstrap_servers=bootstrap, enable_idempotence=True)
    consumer = AIOKafkaConsumer(topic, bootstrap_servers=bootstrap, group_id=group,
        enable_auto_commit=False, auto_offset_reset='earliest', max_poll_records=1)
    await producer.start()
    await consumer.start()
    return producer, consumer


async def dispatch(db, consumer):
    from aiokafka import TopicPartition
    message = await asyncio.wait_for(consumer.getone(), timeout=30)
    result = await resume_kafka.handle_message(db, message.value)
    await consumer.commit({TopicPartition(message.topic, message.partition): message.offset + 1})
    return message.value, result


async def test_five_sql_intents_consumer_restart_and_duplicate_delivery(db, monkeypatch):
    assert getattr(db, 'backend', None) == 'postgresql'
    monkeypatch.setattr(settings, 'resume_kafka_enabled', True)
    topic = 'elitehr-audit-' + uuid.uuid4().hex
    group = 'elitehr-audit-' + uuid.uuid4().hex
    monkeypatch.setattr(resume_kafka, 'TOPIC', topic)
    processed = []

    async def parse(database, job):
        assert job['jobId'] not in processed
        processed.append(job['jobId'])
        return {'synthetic': True}

    monkeypatch.setitem(worker.HANDLERS, 'resume_intake_parse', parse)
    repo = BackgroundJobRepository(db)
    for index in range(5):
        await repo.enqueue(org_id='synthetic', kind='resume_intake_parse', entity_type='audit', entity_key=str(index), payload={})
    producer, consumer = await broker(topic, group)
    try:
        assert await resume_kafka.relay_once(db, producer) == 5
        assert await worker.run_once(db, kinds=['resume_intake_parse']) is None
        message, _ = await dispatch(db, consumer)
        assert set(json.loads(message)) == {'jobId'}
        await resume_kafka.handle_message(db, message)
        assert len(processed) == 1
        await dispatch(db, consumer)
        await consumer.stop()
        from aiokafka import AIOKafkaConsumer
        consumer = AIOKafkaConsumer(topic, bootstrap_servers=os.environ['ELITEHR_SMALL_KAFKA_BOOTSTRAP'],
            group_id=group, enable_auto_commit=False, auto_offset_reset='earliest')
        await consumer.start()
        for _ in range(3):
            await dispatch(db, consumer)
        assert len(processed) == 5
        assert await db.background_jobs.count_documents({'status': 'done'}) == 5
    finally:
        await consumer.stop()
        await producer.stop()


async def test_two_real_documents_upload_parse_and_confirm_with_postgres(client, db, monkeypatch):
    assert getattr(db, 'backend', None) == 'postgresql'
    monkeypatch.setattr(settings, 'resume_kafka_enabled', True)
    monkeypatch.setattr(resume_intake_security, 'scan', REAL_SCAN)
    topic = 'elitehr-audit-doc-' + uuid.uuid4().hex
    monkeypatch.setattr(resume_kafka, 'TOPIC', topic)
    batches = []
    for index in range(2):
        from docx import Document
        document = Document(io.BytesIO(word(email=f'audit{index}@example.test')))
        for paragraph in document.paragraphs:
            if paragraph.text.startswith('Phone:'):
                paragraph.text = f'Phone: +91987654321{index}'
        content = io.BytesIO()
        document.save(content)
        response = await upload(client, content.getvalue(), key=f'audit-document-{index:04d}')
        assert response.status_code == 202, response.text
        batches.append(response.json()['batchId'])
    for _ in range(2):
        result = await worker.run_once(db, kinds=['resume_intake_import'])
        assert result['status'] == 'done'
    producer, consumer = await broker(topic, 'elitehr-audit-' + uuid.uuid4().hex)
    try:
        assert await resume_kafka.relay_once(db, producer) == 2
        for _ in range(2):
            _, result = await dispatch(db, consumer)
            assert result['status'] == 'done'
        for batch in batches:
            item = await first(client, batch)
            assert item['status'] == 'review_required'
            item = await reveal(client, item)
            await confirm_http(client, item)
            await drain(db)
        assert await db.applicants.count_documents({}) == 2
        assert await db.applications.count_documents({}) == 2
    finally:
        await consumer.stop()
        await producer.stop()
