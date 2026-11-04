"""Local resource guard. This is backpressure, not an Oracle billing API."""
import asyncio
import logging
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path

from fastapi import HTTPException
from ..config import settings

logger = logging.getLogger(__name__)
_cpu_sample = None


def capacity_snapshot(*, required_bytes=0, config=None):
    config = config or settings
    if not config.free_tier_guard_enabled:
        return {"enabled": False, "state": "disabled", "reasons": []}
    global _cpu_sample
    reasons = []
    report = {"enabled": True, "checkedAt": datetime.now(timezone.utc).isoformat(),
              "reservePercent": 30, "state": "healthy", "reasons": reasons}
    try:
        cpu = [int(value) for value in Path('/proc/stat').read_text().splitlines()[0].split()[1:9]]
        current_cpu = (sum(cpu), cpu[3] + cpu[4])
        report['cpuUsedPercent'] = None
        if _cpu_sample and current_cpu[0] > _cpu_sample[0]:
            report['cpuUsedPercent'] = round(100 * (1 - (current_cpu[1] - _cpu_sample[1]) / (current_cpu[0] - _cpu_sample[0])), 1)
        _cpu_sample = current_cpu
        report['gpu'] = 'Not available on the A1 CPU instance'
        report['plannedAllocation'] = {'ocpus': 1, 'memoryGb': 8, 'volumeGb': 100,
            'cpuAllowancePercent': 50, 'memoryAllowancePercent': 66.67, 'volumeAllowancePercent': 50,
            'source': 'Deployment plan; tenancy-wide OCI usage is not connected'}
        memory = {}
        for line in Path('/proc/meminfo').read_text().splitlines():
            key, value = line.split(':', 1)
            memory[key] = int(value.strip().split()[0]) * 1024
        total, available = memory['MemTotal'], memory['MemAvailable']
        report['memoryAvailablePercent'] = round(100 * available / total, 1)
        if available < total * .30:
            reasons.append('Memory reserve is below 30%; new parsing is paused.')
        disk = shutil.disk_usage(config.storage_dir)
        report['diskAvailablePercent'] = round(100 * disk.free / disk.total, 1)
        # Also leave space for the upload and its bounded extracted contents.
        if disk.free - required_bytes < max(disk.total * .30, 2 * 1024**3):
            reasons.append('Disk reserve would fall below 30%; new intake is paused.')
        if len(os.sched_getaffinity(0)) < 1:
            reasons.append('CPU availability could not be verified.')
    except (OSError, KeyError, ValueError, AttributeError, IndexError):
        reasons.append('Resource monitoring is unavailable; new intake is paused.')
    if reasons:
        report['state'] = 'paused'
    elif min(report['memoryAvailablePercent'], report['diskAvailablePercent']) < 40:
        report['state'] = 'warning'
        reasons.append('Less than 40% capacity remains; the 30% reserve is protected.')
    return report


def require_capacity(*, required_bytes=0, config=None):
    report = capacity_snapshot(required_bytes=required_bytes, config=config)
    if report['state'] == 'paused':
        raise HTTPException(503, ' '.join(report['reasons']), headers={'Retry-After': '30'})
    return report


async def wait_for_capacity():
    while capacity_snapshot()['state'] == 'paused':
        await asyncio.sleep(10)


async def monitor_capacity(db, *, interval=15):
    """Persistent diagnostics + transition-only alerts; no candidate data."""
    previous = None
    while True:
        report = await asyncio.to_thread(capacity_snapshot)
        await db['deployment_health'].update_one({'_id': 'local-capacity'}, {'$set': report}, upsert=True)
        state = report['state']
        if state != previous:
            logger.log(logging.WARNING if state in {'warning', 'paused'} else logging.INFO,
                       'Capacity state=%s reasons=%s', state, report['reasons'])
            # Local durable alert history visible only through Super Admin diagnostics.
            await db['deployment_alerts'].insert_one({**report, 'kind': 'capacity_transition'})
            # Bound history; health itself is a single document.
            from datetime import timedelta
            await db['deployment_alerts'].delete_many({'checkedAt': {'$lt':
                (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()}})
            previous = state
        await asyncio.sleep(interval)
