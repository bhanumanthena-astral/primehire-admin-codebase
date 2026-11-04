#!/usr/bin/env bash
set -Eeuo pipefail
[[ ${EUID} -eq 0 && -f /etc/elitehr/e2e-provisioned ]] || exit 1
systemctl stop clamav-daemon clamav-freshclam
cat > /etc/clamav/clamd.conf <<'CONFIG'
User clamav
DatabaseDirectory /var/lib/clamav
TCPSocket 3310
TCPAddr 127.0.0.1
LocalSocket /run/clamav/clamd.ctl
FixStaleSocket true
Foreground true
MaxThreads 2
MaxQueue 8
StreamMaxLength 125M
MaxScanSize 500M
MaxFileSize 125M
MaxRecursion 16
MaxFiles 10000
ReadTimeout 60
SendBufTimeout 2000
AlertExceedsMax yes
AlertEncrypted yes
CONFIG
chmod 0644 /etc/clamav/clamd.conf
freshclam --quiet
systemctl enable --now clamav-freshclam clamav-daemon
echo 'Private malware scanner configured; verify readiness after signatures load.'
