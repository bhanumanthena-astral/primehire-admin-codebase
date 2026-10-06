import React, { useCallback, useEffect, useState } from 'react';
import {
  Applicant,
  Application,
  TimelineEntry,
  downloadResumeFile,
  fetchApplicantProfile,
  revealPii,
  transitionApplication,
} from '../lib/hiringApi';
import { EmptyNote, Pill, SectionHeader } from './ui/primitives';
import RoadmapStepper, { stepsForStage } from './RoadmapStepper';
import ScoreBadge from './ScoreBadge';

/**
 * Applicant Profile (Slice B): everything HR needs for one candidate —
 * matched/missing chips, experience, education, CTC, notice, full score
 * breakdown, resume download, stage timeline, and gated stage actions
 * (reason mandatory, server-enforced).
 */
export default function ApplicantProfilePage({
  applicantId,
  onBack,
}: {
  applicantId: string;
  onBack: () => void;
}) {
  const [applicant, setApplicant] = useState<Applicant | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [toStage, setToStage] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<Record<string, string>>({});
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = await fetchApplicantProfile(applicantId);
      setApplicant(p.applicant);
      setApplications(p.applications);
      setTimeline(p.timeline);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load profile.');
    } finally {
      setLoading(false);
    }
  }, [applicantId]);

  useEffect(() => { void load(); }, [load]);

  async function onReveal() {
    if (!applicant) return;
    try {
      setRevealed(await revealPii(applicant.applicantId, ['email', 'phone']));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reveal failed.');
    }
  }

  async function onTransition(appId: string) {
    const stage = toStage[appId];
    const why = (reason[appId] || '').trim();
    if (!stage) { setError('Select a target stage first.'); return; }
    if (!why) { setError('A reason is required for every stage change.'); return; }
    setActing(true);
    setError(null);
    try {
      await transitionApplication(appId, stage, why);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Stage change failed.');
    } finally {
      setActing(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-2" aria-label="Loading profile">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl border" />)}
      </div>
    );
  }
  if (error && !applicant) return <p role="alert" className="text-sm text-red-500">{error}</p>;
  if (!applicant) return <EmptyNote>Candidate not found.</EmptyNote>;

  const parsed = applicant.resume?.parsedJson || {};
  const breakdownOf = (a: Application) => a.scoreBreakdown || {};

  return (
    <div className="space-y-6" aria-label="Applicant profile">
      <button onClick={onBack} className="text-sm text-amber-600 hover:underline">← All applicants</button>
      <SectionHeader
        eyebrow="Candidate profile"
        title={applicant.name}
        subtitle={`Applicant since ${new Date(applicant.createdAt).toLocaleDateString()}`}
      />
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}

      <div className="rounded-xl border p-4 space-y-2 text-sm">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-xs">{revealed.email || applicant.email}</span>
          <span className="font-mono text-xs">{revealed.phone || applicant.phone || '—'}</span>
          {Object.keys(revealed).length === 0 ? (
            <button onClick={() => void onReveal()} className="text-xs text-amber-600 hover:underline">
              Reveal contact (logged)
            </button>
          ) : (
            <span className="text-xs opacity-60">Revealed — this view was logged.</span>
          )}
          {applicant.possibleDuplicate && <Pill tone="warning">Possible duplicate</Pill>}
        </div>
        <div className="grid gap-1 text-xs opacity-80 md:grid-cols-2">
          <span>Experience: {parsed.experienceYears ?? '—'} years</span>
          <span>Education: {(parsed.education || []).join(', ') || '—'}</span>
          <span>CTC: {parsed.ctcCurrentLpa ? `${parsed.ctcCurrentLpa} LPA` : '—'} current
            {parsed.ctcExpectedLpa ? ` / ${parsed.ctcExpectedLpa} LPA expected` : ''}</span>
          <span>Notice: {parsed.noticePeriodDays === 0 ? 'Immediate' : parsed.noticePeriodDays ? `${parsed.noticePeriodDays} days` : '—'}</span>
        </div>
        <p className="text-xs opacity-70">
          Consent: {applicant.consent?.source || '—'} / {applicant.consent?.textVersion || '—'}
          {applicant.retentionUntil ? ` · retained until ${new Date(applicant.retentionUntil).toLocaleDateString()}` : ''}
        </p>
      </div>

      {applications.length === 0 && <EmptyNote>No applications yet for this candidate.</EmptyNote>}
      {applications.map((a) => {
        const b = breakdownOf(a);
        const entries = timeline.filter((t) => t.applicationId === a.applicationId);
        return (
          <div key={a.applicationId} className="rounded-xl border p-4 space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <strong>Application</strong>
              <span className="font-mono text-xs opacity-60">{a.applicationId.slice(0, 8)}</span>
              <Pill tone="info">{a.currentStage}</Pill>
              <ScoreBadge
                score={a.matchScore}
                threshold={b.threshold ?? 60}
                needsReview={a.needsReview}
                lowConfidence={b.lowConfidence}
              />
            </div>
            <RoadmapStepper steps={stepsForStage(a.currentStage)} />

            {a.reviewReasons.length > 0 && (
              <div className="flex flex-wrap gap-1.5" aria-label="Review reasons">
                {a.reviewReasons.map((r, i) => <span key={i}><Pill tone="warning">{r}</Pill></span>)}
              </div>
            )}

            <div className="grid gap-3 text-sm md:grid-cols-2">
              <div className="space-y-1.5">
                <h4 className="text-xs font-semibold uppercase opacity-60">Skills vs job</h4>
                <div className="flex flex-wrap gap-1">
                  {(b.matched || []).map((s: string) => <span key={`m-${s}`}><Pill tone="success">{s}</Pill></span>)}
                  {(b.missing || []).map((s: string) => <span key={`x-${s}`}><Pill tone="danger">missing: {s}</Pill></span>)}
                  {(b.matched || []).length === 0 && (b.missing || []).length === 0 && (
                    <span className="text-xs opacity-60">No requirements compared yet.</span>
                  )}
                </div>
                {b.expNote && <p className="text-xs opacity-70">Experience: {b.expNote}</p>}
              </div>
              <div className="space-y-1.5">
                <h4 className="text-xs font-semibold uppercase opacity-60">
                  Score breakdown · {b.scoreVersion || 'keyword-v1'}
                </h4>
                <p className="text-xs">Keyword: <strong>{b.keyword ?? '—'}</strong> · LLM: <strong>{b.llm ?? '—'}</strong>
                  {b.llmUnavailable && ' (unavailable — deterministic only)'} · Final: <strong>{b.final ?? a.matchScore ?? '—'}</strong></p>
                {b.llmStatus === 'pending' && (
                  <p className="mt-1"><Pill tone="warning">AI scoring pending</Pill></p>
                )}
                <p className="text-xs opacity-70">
                  Weights {b.weights ? `${Math.round((b.weights.keyword || 0.7) * 100)}/${Math.round((b.weights.llm || 0.3) * 100)}` : '70/30'} ·
                  threshold {b.threshold ?? 60}
                  {typeof b.disagreement === 'number' && b.disagreement >= 25 && (
                    <span className="text-amber-600"> · ⚠ disagreement {b.disagreement}pts</span>
                  )}
                </p>
                {(b.llmReasons || []).length > 0 && (
                  <ul className="list-disc pl-5 text-xs opacity-80">
                    {(b.llmReasons || []).map((r: string, i: number) => <li key={i}>{r}</li>)}
                  </ul>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-sm">
              {applicant.resume?.fileId && (
                <button
                  onClick={() => downloadResumeFile(applicant.resume.fileId, applicant.resume.fileName || 'resume').catch((e) =>
                    setError(e instanceof Error ? e.message : 'Download failed.'))}
                  className="rounded-md border px-3 py-1.5 text-xs"
                >
                  ⬇ Resume ({applicant.resume.fileName || 'file'})
                </button>
              )}
              {a.talentPool?.inPool && (
                <span className="text-xs opacity-70">
                  In talent pool · {a.talentPool.reasonCategory} · re-contact {a.talentPool.recontactFlag}
                </span>
              )}
            </div>

            <div className="space-y-1">
              <h4 className="text-xs font-semibold uppercase opacity-60">Stage timeline</h4>
              {entries.length === 0 && <p className="text-xs opacity-60">No transitions yet.</p>}
              {entries.map((t) => (
                <p key={t.historyId} className="text-xs">
                  <span className="font-mono opacity-60">{new Date(t.transitionAt).toLocaleString()}</span>{' '}
                  {t.fromStage || '∅'} → <strong>{t.toStage}</strong>{' '}
                  <span className="opacity-70">· {t.reason || 'no reason'}</span>
                </p>
              ))}
            </div>

            <form
              onSubmit={(e) => { e.preventDefault(); void onTransition(a.applicationId); }}
              className="flex flex-wrap items-end gap-2 border-t pt-3"
              aria-label="Stage actions"
            >
              <label className="flex flex-col gap-1 text-xs">
                Move to
                <select
                  value={toStage[a.applicationId] || ''}
                  onChange={(e) => setToStage((p) => ({ ...p, [a.applicationId]: e.target.value }))}
                  className="rounded-md border px-2 py-1.5 bg-transparent"
                  aria-label="Target stage"
                >
                  <option value="">Select…</option>
                  {['SHORTLISTED', 'TALENT_POOL', 'ASSESSMENT_SENT', 'REJECTED', 'WITHDRAWN', 'ON_HOLD'].map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs">
                Reason (required)
                <input
                  value={reason[a.applicationId] || ''}
                  onChange={(e) => setReason((p) => ({ ...p, [a.applicationId]: e.target.value }))}
                  placeholder="Why is this candidate moving?"
                  className="rounded-md border px-2 py-1.5 bg-transparent"
                  aria-label="Stage change reason"
                />
              </label>
              <button
                type="submit"
                disabled={acting}
                className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                Apply
              </button>
            </form>
          </div>
        );
      })}
    </div>
  );
}
