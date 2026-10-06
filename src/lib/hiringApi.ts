import { authFetch } from './authFetch';

/** fetch rejection (offline / DNS / CORS) surfaces as a clear message
 * instead of the raw browser "Failed to fetch" TypeError. HTTP error
 * statuses keep their server-supplied detail messages. */
async function hiringFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    return await authFetch(input, init);
  } catch (err) {
    if (err instanceof TypeError) {
      throw new Error('Network unavailable. Check your connection and try again.');
    }
    throw err;
  }
}

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
  // PRD requisition fields (Slices 1–2; optional for older payloads).
  companyName?: string;
  jobRole?: string;
  department?: string;
  positionsTotal?: number;
  positionsFilled?: number;
  positionsRemaining?: number;
  keywords?: string[];
  workMode?: string | null;
  location?: string | null;
  openedAt?: string | null;
  closesAt?: string | null;
  assigneeUserId?: string | null;
  assigneeEmail?: string | null;
  jdHtml?: string;
  jdText?: string;
  jdTemplateVersion?: string | null;
  lifecycleStatus?: string;
  closedAt?: string | null;
  archivedAt?: string | null;
}

export interface CreateJobInput {
  jobKey: string;
  title: string;
  companyName: string;
  jobRole: string;
  department: string;
  minExperienceYears: number;
  maxExperienceYears: number;
  positionsTotal: number;
  keywords?: string[];
  openedAt?: string | null;
  closesAt: string;
  assigneeUserId: string;
  workMode?: string | null;
  location?: string | null;
  jdHtml: string;
  jdTemplateVersion?: string | null;
  description?: string;
  mustHaveSkills?: string[];
  niceToHaveSkills?: { skill: string; weight: number }[];
  matchThreshold?: number;
  lifecycleStatus?: string;
  assessmentJobId?: string | null;
  assessmentRoundType?: string;
  reuseAssessmentMonths?: number;
}

export interface DirectoryUser {
  userId: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
}

export interface ParsedJd {
  filename: string;
  kind: string;
  templateVersion: string;
  text: string;
  mapped: Record<string, unknown>;
  warnings: string[];
  // AI document-ingestion path (Phases 2–3). Absent on the template path
  // and when no AI extraction was available. Consumed by the Review UI.
  aiExtract?: Record<string, unknown> | null;
  missingFields?: string[];
  evidence?: Record<string, string>;
  review?: {
    values: Record<string, unknown>;
    missingFields: string[];
    needsReview: { field: string; reason: string }[];
    fieldErrors: { field: string; message: string }[];
    warnings: string[];
    resolvedAssignee: { userId: string; email: string; name: string } | null;
    evidence: Record<string, string>;
  } | null;
}

export class JdParseError extends Error {
  fieldErrors: { field: string; message: string }[];
  constructor(message: string, fieldErrors: { field: string; message: string }[] = []) {
    super(message);
    this.name = 'JdParseError';
    this.fieldErrors = fieldErrors;
  }
}

export interface JobApplicationSummary {
  applicationId: string;
  jobId: string;
  applicantId: string;
  currentStage: string;
  status: string;
  [key: string]: unknown;
}

export interface JobDetail {
  job: Job;
  applications: JobApplicationSummary[];
  counts: { total: number; active: number };
}

export interface JobQuery {
  q?: string;
  status?: string;
  company?: string;
  department?: string;
  assignee?: string;
  experience?: number;
  workMode?: string;
  openedFrom?: string;
  openedTo?: string;
  closesFrom?: string;
  closesTo?: string;
  sort?: string;
  order?: 'asc' | 'desc';
  skip?: number;
  limit?: number;
}

export interface JobPage {
  items: Job[];
  total: number;
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
  /** LLM dispatch state (L1 resilience): done | pending | failed | skipped. Absent on older docs. */
  llmStatus?: string | null;
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

export interface JobRules {
  jdMinChars: number;
  jdMaxChars: number;
  maxKeywords: number;
  keywordMinChars: number;
  keywordMaxChars: number;
  minExperienceYears: number;
  maxExperienceYears: number;
  positionsMin: number;
  positionsMax: number;
  companyNameMin: number;
  companyNameMax: number;
  jobRoleMin: number;
  jobRoleMax: number;
  jobTitleMin: number;
  jobTitleMax: number;
  departments: string[];
}

export async function fetchRules(): Promise<JobRules> {
  const res = await hiringFetch(`${API_BASE}/api/jobs/rules`);
  if (!res.ok) throw new Error(await apiErrorMessage(res, 'GET /api/jobs/rules'));
  return res.json();
}

export async function fetchJobs(): Promise<Job[]> {
  const res = await hiringFetch(`${API_BASE}/api/jobs?limit=100`);
  if (!res.ok) throw new Error(await apiErrorMessage(res, 'GET /api/jobs'));
  return res.json();
}

export async function fetchJobsPage(query: JobQuery = {}): Promise<JobPage> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  const res = await hiringFetch(`${API_BASE}/api/jobs${qs ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error(await apiErrorMessage(res, 'GET /api/jobs'));
  const items = (await res.json()) as Job[];
  return { items, total: Number(res.headers.get('X-Total-Count') ?? items.length) };
}

export async function fetchJobDetail(jobId: string): Promise<JobDetail> {
  const res = await hiringFetch(`${API_BASE}/api/jobs/${encodeURIComponent(jobId)}/detail`);
  if (!res.ok) throw new Error(await apiErrorMessage(res, `GET /api/jobs/${jobId}/detail`));
  return res.json();
}

export interface AuditEntry {
  auditId: string;
  orgId: string;
  actorUserId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  details: Record<string, unknown>;
  ipAddress: string;
  createdAt: string;
}

export async function fetchJobActivity(jobId: string): Promise<{ jobId: string; items: AuditEntry[]; count: number }> {
  const res = await hiringFetch(`${API_BASE}/api/jobs/${encodeURIComponent(jobId)}/activity`);
  if (!res.ok) throw new Error(await apiErrorMessage(res, `GET /api/jobs/${jobId}/activity`));
  return res.json();
}

export interface JobNotification {
  messageId: string;
  kind: string;
  status: 'pending' | 'sending' | 'sent' | 'failed' | string;
  toMasked?: string;
  toName?: string;
  subject?: string;
  attempts?: number;
  lastError?: string | null;
  sentVia?: string | null;
  sentAt?: string | null;
  createdAt?: string;
}

export async function fetchJobNotifications(jobId: string): Promise<{ jobId: string; items: JobNotification[]; count: number }> {
  const res = await hiringFetch(`${API_BASE}/api/jobs/${encodeURIComponent(jobId)}/notifications`);
  if (!res.ok) throw new Error(await apiErrorMessage(res, `GET /api/jobs/${jobId}/notifications`));
  return res.json();
}

export async function fetchApplicationCounts(): Promise<Record<string, number>> {
  const res = await hiringFetch(`${API_BASE}/api/jobs/application-counts`);
  if (!res.ok) throw new Error(await apiErrorMessage(res, 'GET /api/jobs/application-counts'));
  const body = await res.json();
  return (body?.counts ?? {}) as Record<string, number>;
}

export async function closeJob(jobId: string, reason?: string): Promise<Job> {
  const res = await hiringFetch(`${API_BASE}/api/jobs/${encodeURIComponent(jobId)}/close`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: reason ?? null }),
  });
  if (!res.ok) throw new Error(await apiErrorMessage(res, `POST /api/jobs/${jobId}/close`));
  return res.json();
}

export async function reopenJob(jobId: string, closesAt: string): Promise<Job> {
  const res = await hiringFetch(`${API_BASE}/api/jobs/${encodeURIComponent(jobId)}/reopen`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ closesAt }),
  });
  if (!res.ok) throw new Error(await apiErrorMessage(res, `POST /api/jobs/${jobId}/reopen`));
  return res.json();
}

export async function archiveJob(jobId: string): Promise<Job> {
  const res = await hiringFetch(`${API_BASE}/api/jobs/${encodeURIComponent(jobId)}/archive`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(await apiErrorMessage(res, `POST /api/jobs/${jobId}/archive`));
  return res.json();
}

export async function deleteJob(jobId: string): Promise<{ deleted: string }> {
  const res = await hiringFetch(`${API_BASE}/api/jobs/${encodeURIComponent(jobId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(await apiErrorMessage(res, `DELETE /api/jobs/${jobId}`));
  return res.json();
}

export async function assignJob(jobId: string, email: string): Promise<Job> {
  const res = await hiringFetch(`${API_BASE}/api/jobs/${encodeURIComponent(jobId)}/assign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error(await apiErrorMessage(res, `POST /api/jobs/${jobId}/assign`));
  return res.json();
}

export async function checkDuplicate(input: {
  companyName?: string;
  jobRole?: string;
  department?: string;
  location?: string;
  excludeJobId?: string;
}): Promise<{ similarJobs: Job[]; count: number }> {
  const res = await hiringFetch(`${API_BASE}/api/jobs/check-duplicate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await apiErrorMessage(res, 'POST /api/jobs/check-duplicate'));
  return res.json();
}

export type JdParseMode = 'template' | 'document';

export async function parseJd(file: File, mode: JdParseMode = 'template'): Promise<ParsedJd> {
  const form = new FormData();
  form.append('file', file, file.name);
  form.append('mode', mode);
  const res = await hiringFetch(`${API_BASE}/api/jobs/parse-jd`, { method: 'POST', body: form });
  if (!res.ok) {
    // Read the body ONCE: a Response stream cannot be re-read, so message
    // and fieldErrors are both derived from this single parse.
    let message = `POST /api/jobs/parse-jd failed with status ${res.status}`;
    let fieldErrors: { field: string; message: string }[] = [];
    try {
      const body: unknown = JSON.parse(await res.text());
      const detail = (body as { detail?: unknown })?.detail;
      if (Array.isArray(detail)) {
        // FastAPI request-validation shape: [{ loc, msg, ... }]
        const parts = (detail as { loc?: unknown; msg?: unknown }[]).map((d) => {
          const loc = Array.isArray(d.loc) ? d.loc.map(String) : [];
          const field = loc.length > 0 ? loc[loc.length - 1] : 'request';
          return { field, message: typeof d.msg === 'string' ? d.msg : JSON.stringify(d) };
        });
        if (parts.length > 0) {
          fieldErrors = parts;
          message = parts.map((p) => `${p.field}: ${p.message}`).join('; ');
        }
      } else if (detail && typeof detail === 'object') {
        const d = detail as { message?: unknown; errors?: unknown };
        if (typeof d.message === 'string') message = d.message;
        if (Array.isArray(d.errors)) {
          fieldErrors = (d.errors as { field?: unknown; message?: unknown }[])
            .filter((e) => typeof e.field === 'string')
            .map((e) => ({ field: e.field as string, message: String(e.message ?? '') }));
        }
      } else if (typeof detail === 'string' && detail) {
        message = detail;
      }
    } catch { /* fall through with default message */ }
    throw new JdParseError(message, fieldErrors);
  }
  return res.json();
}

export async function downloadJdTemplate(): Promise<Blob> {
  const res = await hiringFetch(`${API_BASE}/api/jobs/jd-template`);
  if (!res.ok) throw new Error(await apiErrorMessage(res, 'GET /api/jobs/jd-template'));
  return res.blob();
}

export async function fetchUserDirectory(): Promise<DirectoryUser[]> {
  const res = await hiringFetch(`${API_BASE}/api/users/directory`);
  if (!res.ok) throw new Error(await apiErrorMessage(res, 'GET /api/users/directory'));
  return res.json();
}

export async function createJob(input: CreateJobInput): Promise<Job> {
  const res = await hiringFetch(`${API_BASE}/api/jobs`, {
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
  const res = await hiringFetch(`${API_BASE}/api/resumes/upload`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(await apiErrorMessage(res, 'POST /api/resumes/upload'));
  return res.json();
}

export async function fetchBatches(): Promise<ResumeBatch[]> {
  const res = await hiringFetch(`${API_BASE}/api/resumes/batches?limit=50`);
  if (!res.ok) throw new Error(await apiErrorMessage(res, 'GET /api/resumes/batches'));
  return res.json();
}

export async function fetchBatch(batchId: string): Promise<{ batch: ResumeBatch; files: ResumeFile[] }> {
  const res = await hiringFetch(`${API_BASE}/api/resumes/batches/${batchId}`);
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
  const res = await hiringFetch(`${API_BASE}/api/applicants${qs}`);
  if (!res.ok) throw new Error(await apiErrorMessage(res, 'GET /api/applicants'));
  return res.json();
}

export async function fetchApplicantProfile(applicantId: string): Promise<{
  applicant: Applicant;
  applications: Application[];
  timeline: TimelineEntry[];
}> {
  const res = await hiringFetch(`${API_BASE}/api/applicants/${applicantId}/profile`);
  if (!res.ok) throw new Error(await apiErrorMessage(res, 'GET profile'));
  return res.json();
}

export async function revealPii(applicantId: string, fields: string[]): Promise<Record<string, string>> {
  const res = await hiringFetch(`${API_BASE}/api/applicants/${applicantId}/reveal`, {
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
  const res = await hiringFetch(`${API_BASE}/api/applications/${applicationId}/transition`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ toStage, reason }),
  });
  if (!res.ok) throw new Error(await apiErrorMessage(res, 'POST transition'));
  return res.json();
}

export async function downloadResumeFile(fileId: string, fileName: string): Promise<void> {
  const res = await hiringFetch(`${API_BASE}/api/resumes/files/${fileId}/download`);
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
  const res = await hiringFetch(`${API_BASE}/api/jobs/${jobId}`, {
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
  const res = await hiringFetch(`${API_BASE}/api/applications/send-assessments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ applicationIds }),
  });
  if (!res.ok) throw new Error(await apiErrorMessage(res, 'POST send-assessments'));
  return res.json();
}

export async function fetchEmailMode(): Promise<{ dryRun: boolean }> {
  const res = await hiringFetch(`${API_BASE}/api/email-mode`);
  if (!res.ok) throw new Error(await apiErrorMessage(res, 'GET email-mode'));
  return res.json();
}

export interface LlmHealth {
  providerModel: string;
  breaker: { state: string; failures: number };
  bucket: { tokens: number; capacity: number; rpm: number };
  queuedJobs: number;
  oldestWaitingSeconds: number | null;
  rateLimitedLastHour: number;
  lastError: {
    error: string;
    promptVersion: string;
    model: string;
    latencyMs: number;
    createdAt: string | null;
  } | null;
  fakeProvider: string;
}

export interface Diagnostics {
  dryRun: boolean;
  allowlistConfigured: boolean;
  outbox: Record<string, number>;
  failedOutbox: Record<string, any>[];
  deadJobs: Record<string, any>[];
  llm?: LlmHealth;
  deferredJobs?: Record<string, any>[];
}

export async function fetchDiagnostics(): Promise<Diagnostics> {
  const res = await hiringFetch(`${API_BASE}/api/diagnostics`);
  if (!res.ok) throw new Error(await apiErrorMessage(res, 'GET diagnostics'));
  return res.json();
}

export async function retryOutboxMessage(messageId: string): Promise<void> {
  const res = await hiringFetch(`${API_BASE}/api/diagnostics/outbox/${messageId}/retry`, { method: 'POST' });
  if (!res.ok) throw new Error(await apiErrorMessage(res, 'POST outbox retry'));
}

export async function retryJob(jobId: string): Promise<void> {
  const res = await hiringFetch(`${API_BASE}/api/diagnostics/jobs/${jobId}/retry`, { method: 'POST' });
  if (!res.ok) throw new Error(await apiErrorMessage(res, 'POST job retry'));
}

export async function retryFailedLlmJobs(): Promise<{ retried: number; cap: number }> {
  const res = await hiringFetch(`${API_BASE}/api/diagnostics/llm/retry-failed`, { method: 'POST' });
  if (!res.ok) throw new Error(await apiErrorMessage(res, 'POST LLM retry'));
  return res.json();
}
