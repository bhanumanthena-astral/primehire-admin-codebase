import React, { useCallback, useEffect, useState } from 'react';
import {
  fetchBatch,
  fetchBatches,
  fetchJobs,
  Job,
  ResumeBatch,
  ResumeFile,
  uploadResumes,
} from '../lib/hiringApi';
import { EmptyNote, Pill, SectionHeader } from './ui/primitives';

function statusTone(s: string): 'success' | 'warning' | 'danger' | 'neutral' | 'info' {
  if (s === 'parsed' || s === 'done') return 'success';
  if (s === 'failed') return 'danger';
  if (s === 'quarantined' || s === 'partial') return 'warning';
  return 'info';
}

/**
 * Resume Upload page (Slice A): pick a job, tick consent, upload single or
 * bulk resumes, watch the live batch table with per-file parse statuses.
 */
export default function ResumeUploadPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobKey, setJobKey] = useState('');
  const [consent, setConsent] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [batches, setBatches] = useState<ResumeBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<{ batch: ResumeBatch; files: ResumeFile[] } | null>(null);
  const [polling, setPolling] = useState(false);

  // Live batch table: the worker finishes parse/score off-request, so poll
  // until every file reaches a terminal status.
  useEffect(() => {
    if (!selected || selected.batch.status !== 'processing') {
      setPolling(false);
      return;
    }
    setPolling(true);
    let tries = 0;
    const timer = setInterval(async () => {
      tries += 1;
      try {
        const fresh = await fetchBatch(selected.batch.batchId);
        setSelected(fresh);
        if (fresh.batch.status !== 'processing' || tries >= 60) {
          clearInterval(timer);
          setPolling(false);
          if (fresh.batch.status !== 'processing') {
            setBatches((prev) => [fresh.batch, ...prev.filter((b) => b.batchId !== fresh.batch.batchId)]);
          }
        }
      } catch {
        clearInterval(timer);
        setPolling(false);
      }
    }, 3000);
    return () => { clearInterval(timer); setPolling(false); };
  }, [selected?.batch.batchId, selected?.batch.status]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [j, b] = await Promise.all([fetchJobs(), fetchBatches()]);
      setJobs(j);
      setBatches(b);
      if (j.length > 0) setJobKey((prev) => prev || j[0].jobKey);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadAll(); }, [loadAll]);

  async function onUpload(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!jobKey) { setError('Select a job profile first.'); return; }
    if (!consent) { setError('Candidate consent is required to upload resumes.'); return; }
    if (files.length === 0) { setError('Choose at least one PDF, DOCX or DOC file.'); return; }
    setUploading(true);
    try {
      const result = await uploadResumes(jobKey, consent, files);
      setSelected(result);
      setBatches((prev) => [result.batch, ...prev.filter((b) => b.batchId !== result.batch.batchId)]);
      setFiles([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  async function openBatch(batchId: string) {
    try {
      setSelected(await fetchBatch(batchId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load batch.');
    }
  }

  return (
    <div className="space-y-6" aria-label="Resume upload">
      <SectionHeader
        eyebrow="Hiring pipeline"
        title="Resume Upload"
        subtitle="Single or bulk upload against a job profile. Files are validated, then a background worker parses, scores, and routes each candidate — this table updates live."
      />
      <form onSubmit={onUpload} className="rounded-xl border p-4 space-y-3" aria-label="Upload resumes">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            Job profile
            <select
              value={jobKey}
              onChange={(e) => setJobKey(e.target.value)}
              className="rounded-md border px-2 py-1.5 bg-transparent"
              aria-label="Job profile"
            >
              {jobs.map((j) => (
                <option key={j.jobId} value={j.jobKey}>{j.jobKey} — {j.title}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Resumes (PDF / DOCX / DOC, up to 10 files)
            <input
              type="file"
              multiple
              accept=".pdf,.docx,.doc"
              onChange={(e) => setFiles(Array.from(e.target.files || []))}
              className="text-sm"
              aria-label="Resume files"
            />
          </label>
        </div>
        {files.length > 0 && (
          <p className="text-xs opacity-70">{files.length} file(s) selected: {files.map((f) => f.name).join(', ')}</p>
        )}
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            aria-label="Candidate consent confirmed"
          />
          <span>
            I confirm candidates consented to processing their resumes for this hiring
            workflow (consent recorded as <span className="font-mono">hr_upload / v1</span>).
          </span>
        </label>
        {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
        <button
          type="submit"
          disabled={uploading || !consent}
          title={!consent ? 'Tick the consent checkbox to enable upload' : undefined}
          className="rounded-md bg-amber-600 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {uploading ? 'Uploading…' : 'Upload & enqueue'}
        </button>
      </form>

      {selected && (
        <div className="rounded-xl border p-4 space-y-3" aria-label="Batch detail">
          <div className="flex items-center gap-2 text-sm">
            <strong>Batch {selected.batch.batchId.slice(0, 8)}</strong>
            <Pill tone={statusTone(selected.batch.status)}>{selected.batch.status}</Pill>
            {polling && <span className="text-xs opacity-60">Worker running — refreshing…</span>}
            {!polling && selected.batch.status === 'processing' && (
              <button onClick={() => void openBatch(selected.batch.batchId)} className="text-xs text-amber-600 hover:underline">
                Refresh
              </button>
            )}
            <span className="opacity-70">
              {selected.batch.counts.parsed} parsed · {selected.batch.counts.failed} failed ·{' '}
              {selected.batch.counts.quarantined} quarantined
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left opacity-70">
                  <th className="px-2 py-1">File</th>
                  <th className="px-2 py-1">Size</th>
                  <th className="px-2 py-1">Status</th>
                  <th className="px-2 py-1">Name</th>
                  <th className="px-2 py-1">Email</th>
                  <th className="px-2 py-1">Phone</th>
                  <th className="px-2 py-1">Skills</th>
                </tr>
              </thead>
              <tbody>
                {selected.files.map((f) => (
                  <tr key={f.fileId} className="border-t">
                    <td className="px-2 py-1 font-mono text-xs">{f.fileName}</td>
                    <td className="px-2 py-1">{(f.sizeBytes / 1024).toFixed(1)} KB</td>
                    <td className="px-2 py-1">
                      <Pill tone={statusTone(f.status)}>{f.status}</Pill>
                      {f.error && <span className="ml-1 text-xs opacity-70">{f.error}</span>}
                    </td>
                    <td className="px-2 py-1">{f.parsedJson?.name || '—'}</td>
                    <td className="px-2 py-1">{f.parsedJson?.email || '—'}</td>
                    <td className="px-2 py-1">{f.parsedJson?.phone || '—'}</td>
                    <td className="px-2 py-1 text-xs">{(f.parsedJson?.skills || []).join(', ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Upload batches</h3>
        {loading && <div className="h-12 animate-pulse rounded-xl border" aria-label="Loading batches" />}
        {!loading && batches.length === 0 && (
          <EmptyNote>No uploads yet — run the first batch above.</EmptyNote>
        )}
        {batches.map((b) => (
          <button
            key={b.batchId}
            onClick={() => void openBatch(b.batchId)}
            className="flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left text-sm hover:bg-white/5"
          >
            <span className="font-mono text-xs">{b.batchId.slice(0, 8)}</span>
            <span>{b.jobKey}</span>
            <Pill tone={statusTone(b.status)}>{b.status}</Pill>
            <span className="opacity-70">
              {b.counts.parsed}/{b.counts.total} parsed
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
