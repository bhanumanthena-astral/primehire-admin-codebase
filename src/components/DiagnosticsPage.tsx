import React, { useCallback, useEffect, useState } from 'react';
import { Diagnostics, fetchDiagnostics, retryJob, retryOutboxMessage } from '../lib/hiringApi';
import { EmptyNote, Pill, SectionHeader } from './ui/primitives';
import DryRunBanner from './DryRunBanner';

/** Admin diagnostics (Slice C): outbox + worker visibility, manual retries. */
export default function DiagnosticsPage() {
  const [data, setData] = useState<Diagnostics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchDiagnostics());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load diagnostics.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function onRetryOutbox(id: string) {
    try {
      await retryOutboxMessage(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Retry failed.');
    }
  }

  async function onRetryJob(id: string) {
    try {
      await retryJob(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Retry failed.');
    }
  }

  return (
    <div className="space-y-4" aria-label="Diagnostics">
      <SectionHeader
        eyebrow="Operations"
        title="Diagnostics"
        subtitle="Email outbox and background-job health. Bodies are never listed here."
      />
      {data && <DryRunBanner dryRun={data.dryRun} />}
      {loading && <div className="h-16 animate-pulse rounded-xl border" aria-label="Loading diagnostics" />}
      {!loading && error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      {!loading && !error && data && (
        <>
          <div className="flex flex-wrap gap-2 text-sm">
            <span>Outbox: {Object.entries(data.outbox).map(([k, v]) => `${k} ${v}`).join(' · ') || 'empty'}</span>
            <span className="opacity-60">Allowlist: {data.allowlistConfigured ? 'set' : 'not set'}</span>
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Failed emails ({data.failedOutbox.length})</h3>
            {data.failedOutbox.length === 0 && <EmptyNote>No failed emails.</EmptyNote>}
            {data.failedOutbox.map((m) => (
              <div key={m.messageId} className="flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-sm">
                <Pill tone="danger">failed</Pill>
                <span className="font-mono text-xs">{m.messageId.slice(0, 8)}</span>
                <span className="text-xs opacity-70">{m.kind} → {m.toMasked}</span>
                <span className="text-xs text-red-500">{m.lastError || ''}</span>
                <button onClick={() => void onRetryOutbox(m.messageId)} className="ml-auto text-xs text-sky-600 hover:underline">
                  Retry
                </button>
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Dead jobs ({data.deadJobs.length})</h3>
            {data.deadJobs.length === 0 && <EmptyNote>No dead jobs.</EmptyNote>}
            {data.deadJobs.map((j) => (
              <div key={j.jobId} className="flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-sm">
                <Pill tone="danger">dead</Pill>
                <span className="font-mono text-xs">{j.jobId.slice(0, 8)}</span>
                <span className="text-xs opacity-70">{j.kind} · {j.entityType}:{String(j.entityKey).slice(0, 8)}</span>
                <span className="text-xs text-red-500">{j.lastError || ''}</span>
                <button onClick={() => void onRetryJob(j.jobId)} className="ml-auto text-xs text-sky-600 hover:underline">
                  Retry
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
