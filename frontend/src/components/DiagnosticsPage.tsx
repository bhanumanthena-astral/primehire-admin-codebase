import {Button} from '@/components/ui/button';
import React, { useCallback, useEffect, useState } from 'react';
import { Diagnostics, fetchDiagnostics, retryFailedLlmJobs, retryJob, retryOutboxMessage } from '../lib/hiringApi';
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

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { void load(); }, 30000);
    return () => window.clearInterval(timer);
  }, [load]);

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

  async function onRetryFailedLlm() {
    try {
      const r = await retryFailedLlmJobs();
      setError(null);
      await load();
      if (r.retried === 0) {
        setError('No dead LLM jobs to retry.');
      }
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
      {!loading && error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {!loading && !error && data && (
        <>
          {data.capacity?.enabled && <section className="space-y-3 rounded-xl border p-4" aria-label="Free tier capacity">
            <h3 className="font-semibold">Free tier capacity Â· {data.capacity.state}</h3>
            <p className="text-sm">CPU used: {data.capacity.cpuUsedPercent == null ? 'Waiting for sample' : `${data.capacity.cpuUsedPercent}%`} · GPU: not available on this VM</p>
            <p className="text-sm">Memory available: {data.capacity.memoryAvailablePercent ?? 'Unknown'}% Â· Disk available: {data.capacity.diskAvailablePercent ?? 'Unknown'}% Â· Reserved: 30%</p>
            {Date.now() - Date.parse(data.capacity.checkedAt) > 60000 && <p role="alert" className="text-sm text-destructive">Capacity monitor is stale. Check the resume worker.</p>}
            {data.capacity.reasons.map(reason => <p key={reason} role={data.capacity?.state === 'paused' ? 'alert' : 'status'} className="text-sm">{reason}</p>)}
            <p className="text-xs opacity-70">Parsing and new uploads pause at the 30% reserve threshold. This monitors the host; verify Oracle billing and tenancy quotas separately.</p>
            {!!data.capacityAlerts?.length && <details><summary className="cursor-pointer text-sm">Recent capacity alerts</summary>{data.capacityAlerts.map((alert, i) => <p key={i} className="mt-2 text-xs">{new Date(alert.checkedAt).toLocaleString()} Â· {alert.state} Â· {alert.reasons.join(' ')}</p>)}</details>}
          </section>}
          <div className="flex flex-wrap gap-2 text-sm">
            <span>Outbox: {Object.entries(data.outbox).map(([k, v]) => `${k} ${v}`).join(' Â· ') || 'empty'}</span>
            <span className="opacity-60">Allowlist: {data.allowlistConfigured ? 'set' : 'not set'}</span>
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Failed emails ({data.failedOutbox.length})</h3>
            {data.failedOutbox.length === 0 && <EmptyNote>No failed emails.</EmptyNote>}
            {data.failedOutbox.map((m) => (
              <div key={m.messageId} className="flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-sm">
                <Pill tone="danger">failed</Pill>
                <span className="font-mono text-xs">{m.messageId.slice(0, 8)}</span>
                <span className="text-xs opacity-70">{m.kind} â†’ {m.toMasked}</span>
                <span className="text-xs text-destructive">{m.lastError || ''}</span>
                <Button variant="ghost" onClick={() => void onRetryOutbox(m.messageId)} className="ml-auto text-xs text-sky-600 hover:underline">
                  Retry
                </Button>
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold">LLM health</h3>
              <Button variant="ghost" onClick={() => void onRetryFailedLlm()} className="ml-auto text-xs text-sky-600 hover:underline">
                Retry failed LLM jobs
              </Button>
            </div>
            {!data.llm && <EmptyNote>No LLM activity recorded yet.</EmptyNote>}
            {data.llm && (
              <div className="rounded-xl border px-3 py-2 text-sm" aria-label="LLM health card">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone={data.llm.breaker.state === 'closed' ? 'success' : 'warning'}>
                    breaker {data.llm.breaker.state}
                  </Pill>
                  <span className="font-mono text-xs">{data.llm.providerModel}</span>
                  <span className="text-xs opacity-70">
                    bucket {data.llm.bucket.tokens}/{data.llm.bucket.capacity} @ {data.llm.bucket.rpm}/min
                  </span>
                  <span className="text-xs opacity-70">queued {data.llm.queuedJobs}</span>
                  {data.llm.oldestWaitingSeconds != null && (
                    <span className="text-xs opacity-70">
                      oldest waiting {Math.round(data.llm.oldestWaitingSeconds)}s
                    </span>
                  )}
                  <span className="text-xs opacity-70">429s last hour: {data.llm.rateLimitedLastHour}</span>
                </div>
                {data.llm.lastError ? (
                  <p className="mt-1 text-xs text-destructive">
                    last error: {data.llm.lastError.error} Â· {data.llm.lastError.promptVersion} Â·{' '}
                    {data.llm.lastError.latencyMs}ms
                  </p>
                ) : (
                  <p className="mt-1 text-xs opacity-60">no recent LLM errors</p>
                )}
                {data.llm.fakeProvider !== 'off' && (
                  <p className="mt-1 text-xs text-warning">fake provider active: {data.llm.fakeProvider} (dev only)</p>
                )}
              </div>
            )}
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Dead jobs ({data.deadJobs.length})</h3>
            {data.deadJobs.length === 0 && <EmptyNote>No dead jobs.</EmptyNote>}
            {data.deadJobs.map((j) => (
              <div key={j.jobId} className="flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-sm">
                <Pill tone="danger">dead</Pill>
                <span className="font-mono text-xs">{j.jobId.slice(0, 8)}</span>
                <span className="text-xs opacity-70">{j.kind} Â· {j.entityType}:{String(j.entityKey).slice(0, 8)}</span>
                <span className="text-xs text-destructive">{j.lastError || ''}</span>
                <Button variant="ghost" onClick={() => void onRetryJob(j.jobId)} className="ml-auto text-xs text-sky-600 hover:underline">
                  Retry
                </Button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
