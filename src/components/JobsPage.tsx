import React, { useCallback, useEffect, useState } from 'react';
import { createJob, fetchJobs, Job, updateJob } from '../lib/hiringApi';
import { EmptyNote, Pill, SectionHeader } from './ui/primitives';

/**
 * Jobs page (Slice A): list job profiles + create a job.
 * Uploads target a jobKey from this list; matching/scoring lands in Slice B.
 */
export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [jobKey, setJobKey] = useState('');
  const [title, setTitle] = useState('');
  const [mustHave, setMustHave] = useState('');
  const [assessmentJobId, setAssessmentJobId] = useState('');
  const [linking, setLinking] = useState<Record<string, string>>({});
  const [linkError, setLinkError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setJobs(await fetchJobs());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load jobs.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!jobKey.trim() || !title.trim()) {
      setFormError('Job key and title are required.');
      return;
    }
    setCreating(true);
    try {
      const created = await createJob({
        jobKey: jobKey.trim(),
        title: title.trim(),
        mustHaveSkills: mustHave.split(',').map((s) => s.trim()).filter(Boolean),
        assessmentJobId: assessmentJobId.trim() || null,
      });
      setJobs((prev) => [created, ...prev]);
      setJobKey('');
      setTitle('');
      setMustHave('');
      setAssessmentJobId('');
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to create job.');
    } finally {
      setCreating(false);
    }
  }

  async function onLinkAssessment(job: Job) {
    setLinkError(null);
    const value = (linking[job.jobId] ?? '').trim();
    try {
      const updated = await updateJob(job.jobId, { assessmentJobId: value || null });
      setJobs((prev) => prev.map((j) => (j.jobId === job.jobId ? updated : j)));
    } catch (e) {
      setLinkError(e instanceof Error ? e.message : 'Failed to link assessment.');
    }
  }

  return (
    <div className="space-y-6" aria-label="Jobs">
      <SectionHeader
        eyebrow="Hiring pipeline"
        title="Job Profiles"
        subtitle="Create the job profile that resumes are matched against. Scoring and the 60% split land in Slice B."
      />
      <form onSubmit={onCreate} className="rounded-xl border p-4 space-y-3" aria-label="Create job">
        <div className="grid gap-3 md:grid-cols-3">
          <label className="flex flex-col gap-1 text-sm">
            Job key
            <input
              value={jobKey}
              onChange={(e) => setJobKey(e.target.value)}
              placeholder="BE-2026-001"
              className="rounded-md border px-2 py-1.5 bg-transparent"
              aria-label="Job key"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Title
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Backend Engineer"
              className="rounded-md border px-2 py-1.5 bg-transparent"
              aria-label="Job title"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Must-have skills (comma separated)
            <input
              value={mustHave}
              onChange={(e) => setMustHave(e.target.value)}
              placeholder="Python, SQL, AWS"
              className="rounded-md border px-2 py-1.5 bg-transparent"
              aria-label="Must-have skills"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Assessment job ID (upstream, optional)
            <input
              value={assessmentJobId}
              onChange={(e) => setAssessmentJobId(e.target.value)}
              placeholder="JOB-abc123"
              className="rounded-md border px-2 py-1.5 bg-transparent"
              aria-label="Assessment job ID"
            />
          </label>
        </div>
        {formError && <p role="alert" className="text-sm text-red-500">{formError}</p>}
        <button
          type="submit"
          disabled={creating}
          className="rounded-md bg-amber-600 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {creating ? 'Creating…' : 'Create job'}
        </button>
      </form>

      {loading && (
        <div className="space-y-2" aria-label="Loading jobs">
          {[0, 1, 2].map((i) => <div key={i} className="h-12 animate-pulse rounded-xl border" />)}
        </div>
      )}
      {!loading && error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      {!loading && !error && jobs.length === 0 && (
        <EmptyNote>No jobs yet — create the first job profile above to enable resume uploads.</EmptyNote>
      )}
      {!loading && !error && jobs.length > 0 && (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left opacity-70">
                <th className="px-3 py-2">Job key</th>
                <th className="px-3 py-2">Title</th>
                <th className="px-3 py-2">Must-have</th>
                <th className="px-3 py-2">Threshold</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Assessment</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.jobId} className="border-t">
                  <td className="px-3 py-2 font-mono">{j.jobKey}</td>
                  <td className="px-3 py-2">{j.title}</td>
                  <td className="px-3 py-2">{j.mustHaveSkills.join(', ') || '—'}</td>
                  <td className="px-3 py-2">{j.matchThreshold}%</td>
                  <td className="px-3 py-2">
                    <Pill tone={j.status === 'open' ? 'success' : 'neutral'}>{j.status}</Pill>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      <input
                        value={linking[j.jobId] ?? j.assessmentJobId ?? ''}
                        onChange={(e) => setLinking((p) => ({ ...p, [j.jobId]: e.target.value }))}
                        placeholder="JOB-…"
                        className="w-28 rounded-md border px-1.5 py-1 font-mono text-xs bg-transparent"
                        aria-label={`Assessment job ID for ${j.jobKey}`}
                      />
                      <button
                        onClick={() => void onLinkAssessment(j)}
                        className="rounded-md border px-2 py-1 text-xs"
                      >
                        Link
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {linkError && <p role="alert" className="text-sm text-red-500">{linkError}</p>}
    </div>
  );
}
