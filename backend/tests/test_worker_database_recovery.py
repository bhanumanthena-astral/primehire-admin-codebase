import asyncio

import pytest
from pymongo.errors import ConnectionFailure

from app.services import worker


async def test_assessment_worker_recovers_from_database_disconnect(monkeypatch):
    calls = []
    delays = []

    async def run_once(db, kinds=None):
        calls.append(kinds)
        if len(calls) == 1:
            raise ConnectionFailure('Synthetic PostgreSQL restart')
        raise asyncio.CancelledError

    async def wait_for(awaitable, timeout):
        awaitable.close()
        delays.append(timeout)
        raise asyncio.TimeoutError

    monkeypatch.setattr(worker, 'run_once', run_once)
    monkeypatch.setattr(worker.asyncio, 'wait_for', wait_for)
    with pytest.raises(asyncio.CancelledError):
        await worker.run_forever(object(), kinds=['assessment_sync'])
    assert calls == [['assessment_sync'], ['assessment_sync']]
    assert delays == [5]


async def test_worker_does_not_hide_programming_errors(monkeypatch):
    async def run_once(db, kinds=None):
        raise ValueError('Synthetic invalid workflow')

    monkeypatch.setattr(worker, 'run_once', run_once)
    with pytest.raises(ValueError):
        await worker.run_forever(object())
