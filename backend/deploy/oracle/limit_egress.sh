#!/usr/bin/env bash
# Dedicated single-VNIC host. 20 Mbit/s for 31 days is at most 6.70 decimal TB,
# below 70% of the documented 10 TB monthly free egress allowance.
set -Eeuo pipefail
[[ ${EUID} -eq 0 && -f /etc/elitehr/host-provisioned ]] || exit 1
network_device=$(ip -o route get 1.1.1.1 | awk '{for (i=1;i<=NF;i++) if ($i=="dev") {print $(i+1); exit}}')
[[ "$network_device" =~ ^[a-zA-Z0-9_.:-]+$ && "$network_device" != lo ]] || exit 1
tc qdisc replace dev "$network_device" root tbf rate 20mbit burst 128kb latency 200ms
echo 'Single-host outbound traffic capped at 20 Mbit/s. No other OCI resources are covered.'
