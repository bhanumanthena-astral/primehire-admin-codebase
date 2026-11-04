"""Kafka dispatch backed by the existing durable Mongo job journal.

Only opaque job IDs enter Kafka. Mongo owns leases, retries and results. A
periodic relay republishes due work, including after broker retention or loss.
"""
import asyncio
import json
import logging
import re
from datetime import timedelta

from ..config import settings
from ..models.resume_intake import now
from .capacity_guard import wait_for_capacity

logger = logging.getLogger(__name__)
TOPIC = 'elitehr.resume.parse.v1'
GROUP = 'elitehr-resume-parser-v1'


def due_query(stamp):
    return {'kind': 'resume_intake_parse', '$and': [
        {'$or': [{'status': {'$in': ['pending', 'deferred']}, 'runAfter': {'$lte': stamp}},
                 {'status': 'running', 'leaseUntil': {'$lte': stamp}}]},
        {'$or': [{'kafkaPublishedAt': None}, {'kafkaPublishedAt': {'$lt': stamp - timedelta(seconds=60)}}]},
    ]}


async def relay_once(db, producer):
    sent = 0
    stamp = now()
    async for job in db['background_jobs'].find(due_query(stamp)).sort('runAfter', 1).limit(100):
        key = job['jobId']
        await producer.send_and_wait(TOPIC, json.dumps({'jobId': key}).encode(), key=key.encode())
        # Send before marking: a crash can duplicate delivery, never lose an intent.
        await db['background_jobs'].update_one({'jobId': key, 'orgId': job['orgId']},
            {'$set': {'kafkaPublishedAt': stamp}})
        sent += 1
    return sent


async def relay(db):
    from aiokafka import AIOKafkaProducer
    producer = AIOKafkaProducer(bootstrap_servers=settings.resume_kafka_bootstrap_servers,
        enable_idempotence=True, max_request_size=16384, request_timeout_ms=15000)
    try:
        await producer.start()
        while True:
            await wait_for_capacity()
            await relay_once(db, producer)
            await asyncio.sleep(2)
    finally:
        await producer.stop()


async def handle_message(db, value):
    from .worker import run_once
    if not isinstance(value, bytes) or len(value) > 1024:
        return
    try:
        data = json.loads(value)
        key = data['jobId']
        if set(data) != {'jobId'} or not isinstance(key, str) or not re.fullmatch(r'[a-f0-9]{32}', key):
            return
    except (ValueError, KeyError, TypeError):
        logger.warning('Discarding invalid resume dispatch; no document content logged.')
        return
    # An atomic job-specific Mongo claim prevents duplicate Kafka delivery from
    # processing a file concurrently. Retry/dead-letter states remain visible.
    return await run_once(db, kinds=['resume_intake_parse'], job_id=key)


async def consume(db):
    from aiokafka import AIOKafkaConsumer, TopicPartition
    consumer = AIOKafkaConsumer(TOPIC, bootstrap_servers=settings.resume_kafka_bootstrap_servers,
        group_id=GROUP, enable_auto_commit=False, auto_offset_reset='earliest',
        max_poll_records=1, max_poll_interval_ms=900000,
        fetch_max_bytes=65536, max_partition_fetch_bytes=16384)
    try:
        await consumer.start()
        while True:
            await wait_for_capacity()
            message = await consumer.getone()
            await handle_message(db, message.value)
            # Advance only this partition after completion or durable retry.
            await consumer.commit({TopicPartition(message.topic, message.partition): message.offset + 1})
    finally:
        await consumer.stop()


async def run(db):
    """One relay, one parser, existing maintenance and non-parse work lanes."""
    from .resume_intake_jobs import supervise_intake_workers
    from .capacity_guard import monitor_capacity
    async def reconnect(operation):
        while True:
            try:
                await operation(db)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning('Resume dispatch reconnecting after %s', type(exc).__name__)
                await asyncio.sleep(5)
    async def intake(db):
        await supervise_intake_workers(db, concurrency=1)
    tasks = [asyncio.create_task(reconnect(operation)) for operation in
             [relay, consume, intake, monitor_capacity]]
    try:
        await asyncio.gather(*tasks)
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
