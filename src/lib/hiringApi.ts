import { authFetch } from './authFetch';

/**
 * Hiring API client (Phase 2 Slice A): jobs + resume upload/batches.
 * Same base-URL discipline as mongoApi: VITE_API_URL at build time,
 * same-origin otherwise. All calls carry the Bearer token via authFetch.
 */

const API_BASE = (
  (import.meta as any).env?.VITE_API_URL as string | undefined || ''
).replace(/\/+$/, '');

export interface Job {
  jobId: string;
  orgId: string;
  jobKey: string;
  title: string;
  description: string;
  mustHaveSkills: string[];
  niceToHaveSkills: { skill: string; weight: number }[];
  minExperienceYears: number | null;
  maxExperienceYears: number | null;
  matchThreshold: number;
  status: string;
  assessmentJobId: string | null;
  assessmentRoundType: string;
  reuseAssessmentMonths: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ResumeFile {
  fileId: string;
  batchId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
  status: 'uploaded' | 'quarantined' | 'parsed' | 'failed';
  error: string | null;
  rawTextChars: number;
  parsedJson: Record<string, any>;
  createdAt: string;
}

export interface ResumeBatch {
  batchId: string;
  orgId: string;
  jobKey: string;
  fileIds: string[];
  status: 'pending' | 'processing' | 'done' | 'partial';
  counts: { total: number; parsed: number; failed: number; quarantined: number };
  failures: { index: number; fileName: string; code: string; message: string }[];
  consent: Record<string, any>;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

async function apiErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body: any = await res.json();
    const detail = body?.detail ?? body;
    if (typeof detail === 'string' && detail) return detail;
    if (Array.isArray(detail)) return detail.map((d) => d.msg || JSON.stringify(d)).join(', ');
  } catch { /* fall through */ }
  return `${res.status} on ${fallback}`;
}

export async function fetchJobs(): Promise<Job[]> {
  const res = await authFetch(`${API_BASE}/api/jobs?limit=100`);
  if (!res.ok) throw new Error(await apiErrorMessage(res, 'GET /api/jobs'));
  return res.json();
}

export async function createJob(input: {
  jobKey: string;
  title: string;
  description?: string;
  mustHaveSkills?: string[];
  matchThreshold?: number;
  assessmentJobId?: string | null;
  assessmentRoundType?: string;
}): Promise<Job> {
  const res = await authFetch(`${API_BASE}/api/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await apiErrorMessage(res, 'POST /api/jobs'));
  return res.json();
}

export async function uploadResumes(
  jobKey: string,
  consent: boolean,
  files: File[],
): Promise<{ batch: ResumeBatch; files: ResumeFile[] }> {
  const form = new FormData();
  form.append('jobKey', jobKey);
  form.append('consent', consent ? 'true' : 'false');
  for (const f of files) form.append('files', f, f.name);
  // NOTE: no Content-Type header — the browser sets multipart boundary.
  const res = await authFetch(`${API_BASE}/api/resumes/upload`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(await apiErrorMessage(res, 'POST /api/resumes/upload'));
  return res.json();
}

export async function fetchBatches(): Promise<ResumeBatch[]> {
  const res = await authFetch(`${API_BASE}/api/resumes/batches?limit=50`);
  if (!res.ok) throw new Error(await apiErrorMessage(res, 'GET /api/resumes/batches'));
  return res.json();
}

export async function fetchBatch(batchId: string): Promise<{ batch: ResumeBatch; files: ResumeFile[] }> {
  const res = await authFetch(`${API_BASE}/api/resumes/batches/${batchId}`);
  if (!res.ok) throw new Error(await apiErrorMessage(res, 'GET batch'));
  return res.json();
}

export interface Applicant {
  applicantId: string;
  orgId: string;
  email: string;
  name: string;
  phone: string;
  resume: Record<string, any>;
  consent: Record<string, any>;
  retentionUntil: string | null;
  tags: string[];
  possibleDuplicate: boolean;
  latestApplication: {
    applicationId: string;
    jobId: string;
    currentStage: string;
    matchScore: number | null;
    needsReview: boolean;
    threshold: number;
    lowConfidence: boolean;
    assessment: { state: string; error: string | null };
  } | null;  createdAt: string;
  updatedAt: string;
}

export interface Application {
  applicationId: string;
  orgId: string;
  jobId: string;
  applicantId: string;
  currentStage: string;
  stageEnteredAt: string;
  candidateKey: string | null;
  assignedReviewers: string[];
  matchScore: number | null;
  scoreBreakdown: Record<string, any>;
  needsReview: boolean;
  reviewReasons: string[];
  talentPool: Record<string, any> | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface TimelineEntry {
  historyId: string;
  applicationId: string;
  fromStage: string;
  toStage: string;
  transitionAt: string;
  actorUserId: string;
  reason: string;
  isOverride: boolean;
  metadata: Record<string, any>;
}

export async function fetchApplicants(query?: string): Promise<Applicant[]> {
  const qs = query ? `?q=${encodeURIComponent(query)}&limit=100` : '?limit=100';
  const res = await authFetch(`${API_BASE}/api/applicants${qs}`);
  if (!res.ok) throw new Error(await apiErrorMessage(res, 'GET /api/applicants'));
  return res.json();
}

export async function fetchApplicantProfile(applicantId: string): Promise<{
  applicant: Applicant;
  applications: Application[];
  timeline: TimelineEntry[];
}> {
  const res = await authFetch(`${API_BASE}/api/applicants/${applicantId}/profile`);
  if (!res.ok) throw new Error(await apiErrorMessage(res, 'GET profile'));
  return res.json();
}

export async function revealPii(applicantId: string, fields: string[]): Promise<Record<string, string>> {
  const res = await authFetch(`${API_BASE}/api/applicants/${applicantId}/reveal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error(await apiErrorMessage(res, 'POST reveal'));
  return (await res.json()).revealed;
}

export async function transitionApplication(
  applicationId: string,
  toStage: string,
  reason: string,
): Promise<Application> {
  const res = await authFetch(`${API_BASE}/api/applications/${applicationId}/transition`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ toStage, reason }),
  });
  if (!res.ok) throw new Error(await apiErrorMessage(res, 'POST transition'));
  return res.json();
}

export async function downloadResumeFile(fileId: string, fileName: string): Promise<void> {
  const res = await authFetch(`${API_BASE}/api/resumes/files/${fileId}/download`);
  if (!res.ok) throw new Error(await apiErrorMessage(res, 'GET download'));
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function updateJob(jobId: string, patch: Record<string, unknown>): Promise<Job> {
  const res = await authFetch(`${API_BASE}/api/jobs/${jobId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await apiErrorMessage(res, 'PUT /api/jobs'));
  return res.json();
}

export interface BulkSendItem {
  applicationId: string;
  result: 'accepted' | 'skipped' | 'failed';
  reason?: string;
}

export async function sendAssessments(applicationIds: string[]): Promise<{
  items: BulkSendItem[];
  accepted: number;
  total: number;
}> {
  const res = await authFetch(`${API_BASE}/api/applications/send-assessments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ applicationIds }),
  });
  if (!res.ok) throw new Error(await apiErrorMessage(res, 'POST send-assessments'));
  return res.json();
}

export async function fetchEmailMode(): Promise<{ dryRun: boolean }> {
  const res = await authFetch(`${API_BASE}/api/email-mode`);
  if (!res.ok) throw new Error(await apiErrorMessage(res, 'GET email-mode'));
  return res.json();
}

export interface Diagnostics {
  dryRun: boolean;
  allowlistConfigured: boolean;
  outbox: Record<string, number>;
  failedOutbox: Record<string, any>[];
  deadJobs: Record<string, any>[];
}

export async function fetchDiagnostics(): Promise<Diagnostics> {
  const res = await authFetch(`${API_BASE}/api/diagnostics`);
  if (!res.ok) throw new Error(await apiErrorMessage(res, 'GET diagnostics'));
  return res.json();
}

export async function retryOutboxMessage(messageId: string): Promise<void> {
  const res = await authFetch(`${API_BASE}/api/diagnostics/outbox/${messageId}/retry`, { method: 'POST' });
  if (!res.ok) throw new Error(await apiErrorMessage(res, 'POST outbox retry'));
}

export async function retryJob(jobId: string): Promise<void> {
  const res = await authFetch(`${API_BASE}/api/diagnostics/jobs/${jobId}/retry`, { method: 'POST' });
  if (!res.ok) throw new Error(await apiErrorMessage(res, 'POST job retry'));
}
