"""Opt-in regression check against the actual E2E broker process."""
import ipaddress
import os
from pathlib import Path
import subprocess

import pytest


@pytest.mark.skipif(not os.getenv('ELITEHR_E2E_KAFKA_PID'), reason='Explicit E2E broker PID required')
def test_e2e_kafka_has_no_public_management_listener():
    pid = int(os.environ['ELITEHR_E2E_KAFKA_PID'])
    assert b'kafka.Kafka' in Path(f'/proc/{pid}/cmdline').read_bytes()
    sockets = subprocess.check_output(['ss', '-lntpH'], text=True)
    addresses = [line.split()[3] for line in sockets.splitlines() if f'pid={pid},' in line]
    assert {9092, 9093} <= {int(value.rsplit(':', 1)[1]) for value in addresses}
    for value in addresses:
        address = ipaddress.ip_address(value.rsplit(':', 1)[0].strip('[]'))
        assert address.is_loopback or getattr(address, 'ipv4_mapped', None) and address.ipv4_mapped.is_loopback
