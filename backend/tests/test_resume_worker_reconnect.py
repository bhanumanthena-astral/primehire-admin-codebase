"""Transient database disconnects restart the pool without hiding programming errors."""
import asyncio
import pytest
from pymongo.errors import AutoReconnect
from app.services import resume_intake_jobs as jobs


async def test_reconnect_retries_and_cancellation_still_stops_worker(monkeypatch):
    attempts, delays = [], []
    async def pool(db, **kwargs):
        attempts.append(kwargs)
        if len(attempts) == 1:raise AutoReconnect('Synthetic connection reset')
        raise asyncio.CancelledError
    async def sleep(delay):delays.append(delay)
    monkeypatch.setattr(jobs,'run_intake_workers',pool)
    monkeypatch.setattr(jobs.asyncio,'sleep',sleep)
    with pytest.raises(asyncio.CancelledError):
        await jobs.supervise_intake_workers(object(),concurrency=2)
    assert len(attempts) == 2 and delays == [5]


async def test_programming_or_configuration_errors_are_not_retried(monkeypatch):
    async def pool(*args, **kwargs):raise ValueError('Synthetic invalid configuration')
    monkeypatch.setattr(jobs,'run_intake_workers',pool)
    with pytest.raises(ValueError):await jobs.supervise_intake_workers(object())
