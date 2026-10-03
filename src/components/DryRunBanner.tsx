import React from 'react';

/** Banner shown whenever EMAIL_DRY_RUN is on, so nobody mistakes records for deliveries. */
export default function DryRunBanner({ dryRun }: { dryRun: boolean | null }) {
  if (!dryRun) return null;
  return (
    <div
      role="status"
      className="rounded-xl border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm"
    >
      <strong> Dry-run mode:</strong> emails are recorded in the outbox but{' '}
      <strong>not delivered</strong>. Turn off <span className="font-mono">EMAIL_DRY_RUN</span> with a
      test-recipient allowlist to send real invites.
    </div>
  );
}
