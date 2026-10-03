import React, { useCallback, useEffect, useState } from 'react';
import {
  Applicant,
  BulkSendItem,
  fetchApplicants,
  fetchEmailMode,
  revealPii,
  sendAssessments,
} from '../lib/hiringApi';
import { EmptyNote, Pill, SectionHeader } from './ui/primitives';
import DryRunBanner from './DryRunBanner';
import ScoreBadge from './ScoreBadge';

function assessmentTone(state: string): 'success' | 'warning' | 'danger' | 'neutral' | 'info' {
  if (state === 'email_sent') return 'success';
  if (state === 'failed') return 'danger';
  if (state === 'none') return 'neutral';
  return 'info';
}

function assessmentLabel(state: string): string {
  const labels: Record<string, string> = {
    none: 'not sent',
    send_requested: 'sending…',
    upstream_pending: 'sending…',
    link_created: 'sending…',
    email_queued: 'sending…',
    email_sent: 'sent',
    failed: 'failed',
  };
  return labels[state] || state;
}

/**
 * Applicants list (Slice B): masked contact columns, score badge with
 * threshold marker, review flags. Full values only via audited Reveal.
 * Nothing PII is written to localStorage or URLs (memory state only).
 */
export default function ApplicantsPage({ onOpen }: { onOpen: (id: string) => void }) {
  const [items, setItems] = useState<Applicant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [revealed, setRevealed] = useState<Record<string, Record<string, string>>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<BulkSendItem[] | null>(null);
  const [dryRun, setDryRun] = useState<boolean | null>(null);

  const load = useCallback(async (q?: string) => {
    setLoading(true);
    setError(null);
    try {
      const [list, mode] = await Promise.all([fetchApplicants(q || undefined), fetchEmailMode()]);
      setItems(list);
      setDryRun(mode.dryRun);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load applicants.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function onReveal(id: string) {
    try {
      const values = await revealPii(id, ['email', 'phone']);
      setRevealed((prev) => ({ ...prev, [id]: values }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reveal failed.');
    }
  }

  function toggleSelect(applicationId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(applicationId)) next.delete(applicationId);
      else next.add(applicationId);
      return next;
    });
  }

  async function onConfirmSend() {
    setSending(true);
    setError(null);
    try {
      const out = await sendAssessments(Array.from(selected));
      setResults(out.items);
      setSelected(new Set());
      setConfirming(false);
      await load(query);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bulk send failed.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-4" aria-label="Applicants">
      <SectionHeader
        eyebrow="Hiring pipeline"
        title="Applicants"
        subtitle="Parsed candidates with match scores. Contact details are masked until explicitly revealed (audited)."
      />
      <DryRunBanner dryRun={dryRun} />
      {selected.size > 0 && (
        <div className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm">
          <span>{selected.size} shortlisted candidate(s) selected</span>
          <button
            onClick={() => setConfirming(true)}
            className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white"
          >
            Send assessments…
          </button>
          <button onClick={() => setSelected(new Set())} className="text-xs opacity-70 hover:underline">
            Clear
          </button>
        </div>
      )}
      {confirming && (
        <div role="dialog" aria-label="Confirm bulk send" className="rounded-xl border border-sky-500/50 p-4 text-sm space-y-2">
          <p>
            Send assessment invites to <strong>{selected.size}</strong> shortlisted candidate(s)?
            Each invite is rendered, queued in the encrypted outbox, and tracked per row.
            {dryRun ? ' Dry-run is ON: nothing will be delivered.' : ''}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => void onConfirmSend()}
              disabled={sending}
              className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              {sending ? 'Queueing…' : 'Confirm send'}
            </button>
            <button onClick={() => setConfirming(false)} className="rounded-md border px-3 py-1.5 text-xs">
              Cancel
            </button>
          </div>
        </div>
      )}
      {results && (
        <div className="rounded-xl border p-3 text-sm space-y-1" aria-label="Bulk send results">
          <strong>Results:</strong>{' '}
          {results.filter((r) => r.result === 'accepted').length}/{results.length} queued
          {results.filter((r) => r.result !== 'accepted').map((r) => (
            <p key={r.applicationId} className="text-xs">
              <span className="font-mono">{r.applicationId.slice(0, 8)}</span>{' '}
              <Pill tone={r.result === 'skipped' ? 'neutral' : 'danger'}>{r.result}</Pill>{' '}
              <span className="opacity-70">{r.reason || ''}</span>
            </p>
          ))}
          <button onClick={() => setResults(null)} className="text-xs opacity-70 hover:underline">Dismiss</button>
        </div>
      )}
      <form
        onSubmit={(e) => { e.preventDefault(); void load(query); }}
        className="flex gap-2"
        aria-label="Search applicants"
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, email, or skill…"
          className="w-full max-w-sm rounded-md border px-2 py-1.5 bg-transparent text-sm"
          aria-label="Search applicants"
        />
        <button type="submit" className="rounded-md border px-3 py-1.5 text-sm">Search</button>
      </form>
      {loading && (
        <div className="space-y-2" aria-label="Loading applicants">
          {[0, 1, 2].map((i) => <div key={i} className="h-12 animate-pulse rounded-xl border" />)}
        </div>
      )}
      {!loading && error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      {!loading && !error && items.length === 0 && (
        <EmptyNote>No applicants yet — upload resumes to create candidate profiles.</EmptyNote>
      )}
      {!loading && !error && items.length > 0 && (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left opacity-70">
                <th className="px-3 py-2">Select</th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Phone</th>
                <th className="px-3 py-2">Skills</th>
                <th className="px-3 py-2">Score</th>
                <th className="px-3 py-2">Assessment</th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => {
                const parsed = a.resume?.parsedJson || {};
                const rev = revealed[a.applicantId] || {};
                const shortlisted = a.latestApplication?.currentStage === 'SHORTLISTED';
                const appId = a.latestApplication?.applicationId;
                const assess = a.latestApplication?.assessment;
                return (
                  <tr key={a.applicantId} className="border-t">
                    <td className="px-3 py-2">
                      {shortlisted && appId && (
                        <input
                          type="checkbox"
                          checked={selected.has(appId)}
                          onChange={() => toggleSelect(appId)}
                          aria-label={`Select ${a.name} for assessment`}
                        />
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <button onClick={() => onOpen(a.applicantId)} className="font-medium text-amber-600 hover:underline">
                        {a.name}
                      </button>
                      {a.possibleDuplicate && <span className="ml-2"><Pill tone="warning">Possible duplicate</Pill></span>}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {rev.email || a.email}{' '}
                      {!rev.email && (
                        <button onClick={() => void onReveal(a.applicantId)} className="text-amber-600 hover:underline" aria-label={`Reveal contact for ${a.name}`}>
                          Reveal
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{rev.phone || a.phone || '—'}</td>
                    <td className="px-3 py-2 text-xs">{(parsed.skills || []).slice(0, 5).join(', ') || '—'}</td>
                    <td className="px-3 py-2">
                      {a.latestApplication ? (
                        <ScoreBadge
                          score={a.latestApplication.matchScore}
                          threshold={a.latestApplication.threshold ?? 60}
                          needsReview={a.latestApplication.needsReview}
                          lowConfidence={a.latestApplication.lowConfidence}
                        />
                      ) : (
                        <span className="text-xs opacity-60">No application yet</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {assess ? (
                        <span title={assess.error || undefined}>
                          <Pill tone={assessmentTone(assess.state)}>{assessmentLabel(assess.state)}</Pill>
                        </span>
                      ) : (
                        <span className="text-xs opacity-60">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
