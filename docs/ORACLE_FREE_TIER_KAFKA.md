# Fixed Oracle Free Tier deployment: 70% ceiling

Status: code and deployment package prepared locally. No Oracle account has been connected, VM created, database migrated, or public deployment started. The home region, VM address and private SSH key path are still required. Linux/ARM installation and an actual resume workload must pass on the selected VM before cutover.

## Capacity and cost boundaries

Use exactly one dedicated Ubuntu 24.04 A1 VM in the home region, with 1 OCPU, 8 GB RAM, and a 100 GB boot volume. No autoscaler, instance pool, managed Kafka, extra VM, GPU, load balancer or managed database is needed. MongoDB Community runs privately on the same VM; Oracle Autonomous Database is not a drop-in replacement for this app's MongoDB schema.

The conservative current free allowance is 1,500 OCPU-hours and 9,000 GB-hours/month, with 200 GB combined boot/block storage. In a 31-day month this VM uses 744 OCPU-hours (49.6%), 5,952 GB-hours (66.1%) and 100 GB provisioned storage (50%). This assumes no other resources consume these shared allowances. Never resize or create an extra instance to work around unavailable A1 capacity.

Sources, checked November 2, 2026:
- Oracle free resources: https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
- Budget soft limits and daily evaluation: https://docs.oracle.com/en-us/iaas/Content/Billing/Concepts/budgetsoverview.htm
- Quota policy precedence and AD scope: https://docs.oracle.com/en-us/iaas/Content/Quotas/Concepts/quota_policy_syntax.htm
- Free OpenRouter limits: https://openrouter.ai/collections/free-models

A paid tenancy can incur charges. Local metrics and Oracle budget notifications are not a guaranteed billing cutoff. Before provisioning, verify existing tenancy-wide resources, the home region's actual free eligibility, storage performance tier and billing estimate. Apply the reviewed quota template in backend/deploy/oracle/free-quotas.example as one policy with the actual dedicated compartment and availability domain. Quotas do not remove existing resources or prohibit every paid service. Do not grant application/worker credentials permission to create or resize cloud resources. Keep paid services and all other regions unused. Configure an Oracle budget and actual/forecast alerts as a secondary signal, not the enforcement mechanism. This package does not claim to observe live Oracle billing.

## Local limits

The opt-in profile installs a shared systemd slice: CPUQuota=70%, MemoryHigh=4000M, MemoryMax=4500M, no swap allocation for slice services. MongoDB, scanner, API, workers, Caddy, Kafka and backup join the slice. The remaining memory is for the OS and the protected reserve. Heavy intake operations share one slot, including imports and Kafka parsing. The parser's existing 768 MiB process limit remains enforced. These are conservative initial limits; an 8 GB fit is not a completed load test.

A host resource guard checks real Linux MemAvailable and storage free space. Below 40% free it warns; below 30% it blocks new uploads with Retry-After and pauses new intake work. Upload body admission and chunk writes check capacity too. Archive extraction checks headroom between entries. Backups check staging space before stopping writers. Work already running can finish; the guard is backpressure, not a reservation of all operating-system or database writes.

A fixed outbound shaper limits the single VM's default network interface to 20 Mbit/s. Even continuous use for 31 days is about 6.70 decimal TB, below 70% of Oracle's documented 10 TB free egress allowance. This covers only the dedicated single-VNIC host, not other cloud resources or a separately hosted frontend. API/Caddy services depend on the limiter starting successfully. Keep the single interface/topology; revalidate after any manual network change.

## Upload and queue behavior

Multiple resumes mode accepts up to 1,000 selected files. The browser sends sequential requests containing at most ten files and approximately 64 MB of configured maximum file sizes. A stable key per chunk makes retries safe. Successfully accepted chunks remain visible as separate batches in Processing & review. A failure preserves the selection for retry; keep the page open while uploading. Existing individual file/format checks remain active.

ZIP files support at most 1,000 entries and retain the compressed and expanded byte limits. This is not a promise that 1,000 maximum-size resumes fit in one ZIP. Large collections should use Multiple resumes. The free profile caps spreadsheet rows at 1,000. Spreadsheet-plus-companion-ZIP worst-case reservations may require smaller administrator-configured row/archive limits to fit the host-wide capacity.

Host-wide admission counts active items and unimported batch reservations across tenants, limiting them to 1,000. Pending human review also occupies capacity. Complete or delete existing batches before sending another full collection. Server resource backpressure can stop a multi-chunk upload partway through; retry resumes the same logical chunks.

MongoDB stores authoritative job intents, application linkage, leases, attempts, retry scheduling and dead-letter results. A relay sends only opaque job IDs to a private one-partition Kafka topic. A consumer claims one exact job atomically and invokes the existing scanner/parser. Kafka offsets commit after handling, while durable Mongo retry states preserve failures. Duplicate Kafka messages cannot concurrently claim the same job. Due intents are periodically republished, so broker loss or retention expiry does not erase pending work. Other worker entry points do not bypass Kafka when enabled. Files and candidate text never enter Kafka messages.

Kafka is one KRaft broker/controller, with a persistent local data directory, 384 MB JVM heap, 1 GB container memory ceiling, bounded retention and loopback-only listeners. It is not highly available. Mongo, original files and cryptographic keys still require the existing encrypted backup process. Resumes are parsed locally; AI ATS scoring and interview summaries call OpenRouter separately. Free OpenRouter models can rate-limit well before 1,000 evaluations/day. There is no automatic paid-model fallback in this profile; explicit paid model IDs fail deployment validation. Zoho credentials must be supplied privately for the existing email integration. Do not assume Zoho Mail SMTP credentials are ZeptoMail API credentials.

## Super Admin alerts

Super Admin sees CPU utilization, available memory/disk percentages, queue/worker diagnostics and recent capacity transitions in Administration > Diagnostics. A global banner appears on warnings, pauses or stale monitoring. Other roles receive no deployment metrics or alert history, and GET /api/diagnostics/capacity returns 403 for non-Super-Admin users. Polling is every 30 seconds; worker monitoring updates every 15 seconds. Alerts are in-app and in the local journal, not email notifications. Oracle cost/usage telemetry is not connected yet. No GPU exists on A1; do not interpret CPU percentages as GPU usage.

## Installation and cutover

1. Verify the actual tenancy and apply the reviewed, region/AD-specific limits before creating resources. Use the fixed VM described above. Limit SSH to the administrator IP, allow public HTTPS, and never expose MongoDB, clamd or Kafka.
2. Follow ORACLE_BACKEND_DEPLOYMENT.md to build, verify, transfer and bootstrap a clean backend release on a NEW dedicated VM. Preserve V2 data and encryption keys exactly; do not migrate V1.
3. Configure private /etc/elitehr/backend.env and restore V2 data/storage before starting application writers. No credentials belong in chat or the frontend bundle.
4. On the host run: sudo bash /opt/elitehr/current/deploy/oracle/enable_free_profile.sh . This deliberately stops app services, installs private Kafka and hard resource/egress limits, then leaves API and workers stopped. It is a one-time dedicated-host procedure; inspect an interrupted installation instead of blindly rerunning it.
5. Run the existing readiness check: sudo -u elitehr /opt/elitehr/current/.venv/bin/python -m deploy.runtime check --env-file /etc/elitehr/backend.env . Check Kafka, scanner, slice limits and egress service. Verify the persistent Kafka directory is writable by the pinned image's UID 1000.
6. Start only elitehr@api and elitehr@resume after readiness succeeds. Verify one synthetic upload end to end, then representative PDF, DOCX and scanned resumes. Measure RSS, CPU, queue latency and disk before attempting the full batch. Do not claim a throughput SLA from synthetic queue tests.
7. Configure HTTPS and publish the frontend using its existing same-origin gateway. Enable scheduler/recruitment email services only after reviewing pending recipients and privately configuring the correct Zoho product credentials.
8. Confirm Super Admin can see capacity, other roles cannot, parser concurrency is one, existing source reports are unchanged, and retries do not create duplicate jobs. Monitor the first full import. Stop intake when necessary; never scale automatically.

Required operator details: Oracle home region and selected AD, dedicated compartment, VM public IP, SSH username, local private-key path, final HTTPS hostname, and whether V2 data is to be migrated. The actual billing/tenancy inventory and VM limits must be verified before public launch.

## Local validation completed

- Frontend TypeScript check and production Pages build passed.
- Eight frontend upload/file-picker tests passed, including 1,000-file chunking, partial failure, stable retry keys and cancellation.
- Eighty-three focused backend tests passed, including resource failure/backpressure, duplicate delivery, Super Admin access, admission reservations and free-profile validation. Earlier intake coverage also passed.
- A real local Apache Kafka 4.3.2 broker delivered 1,000 synthetic job IDs sequentially with manual offset commits. The handler was synthetic and Mongo was in-memory; this is not a resume throughput or production memory benchmark.
- New shell scripts passed bash syntax checks in Linux. The pinned Kafka image runs as UID 1000; observed broker memory after the synthetic test was approximately 342 MiB under a 1 GiB container limit. This is not the whole-host peak.
- Backend release: artifacts/backend/elitehr-backend-20261102-free-kafka-02.tar.gz, with SHA-256 sidecar. Required Kafka/capacity runtime files are included; environment files are excluded.
- The temporary Kafka test container was removed. No Oracle resources were created.
