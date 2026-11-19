# Assessment invitation delivery

The API queues an assessment request; it does not confirm an email was sent.
The assessment worker creates the link, persists an encrypted outbox message,
and sends it through the configured company/platform provider.

## Rollout

Deploy the backend release and restart `elitehr@assessment` and
`elitehr@scheduler` using the existing deployment workflow. The assessment
role now consumes `email_send` jobs itself. Both roles may run together;
atomic outbox claims prevent concurrent sends of the same message.

An email-capable worker reconciles due outbox messages every 30 seconds,
up to 50 per pass. Missing jobs are created; finished/dead jobs with pending
outbox messages are revived. Existing active jobs retain their leases.
No bulk resend or database reset is needed. Previously successful messages,
including dry-run records, are not automatically resent.

Local development uses `scripts/run_v2_assessment_worker.py` without
`--no-email` or `--results-only` for delivery. The standard local launcher
intentionally uses dry-run unless its single-recipient test mode is selected.
Do not disable that guard to diagnose a queue problem.

## Verify

1. Confirm the assessment service is running and inspect its logs for failures.
2. Inspect authenticated `/api/diagnostics`: pending counts should decrease;
   failed outbox rows expose safe errors. Never log encrypted/decrypted bodies,
   credentials, assessment passwords, or full recipient addresses.
3. For an explicitly requested invitation, verify `status=sent`,
   `sentVia=zepto`, `deliveryStatus=accepted`, and `wiped=true`.
   `sentVia=dry_run` means no provider request occurred.
4. Provider acceptance is not proof of inbox delivery. Verify the recipient
   inbox and provider delivery/bounce records separately.

Temporary provider failures and rate limits retry with bounded exponential
backoff. Permanent 4xx errors (except 429) require fixing configuration/message
data, then using the failed-message retry action. That action resets the
attempt budget; the worker recovers the corresponding job.

Delivery is at-least-once: if the provider accepts a message and the process
dies before persisting success, recovery after the five-minute claim window
can send a duplicate. Exactly-once delivery requires provider-side idempotency.
