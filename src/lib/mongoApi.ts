import { AssessmentProfile, Candidate, MailTemplate } from '../types';
import { asUtcIso } from '../utils/dates';

/**
 * FastAPI read client (Phase 3C read cutover).
 *
 * MongoDB (via FastAPI) is the preferred source of truth for business reads.
 * localStorage remains as a temporary fallback when the API is unreachable.
 *
 * ID discipline: the UI `id` stays the application candidateKey/jobId.
 * The Mongo ObjectId is exposed separately as `mongoId` and must never
 * replace UI identifiers.
 */

const rawApiUrl = (import.meta as any).env?.VITE_API_URL as string | undefined;
const isProd = Boolean((import.meta as any).env?.PROD);

if (isProd) {
  if (!rawApiUrl || rawApiUrl.includes('localhost') || rawApiUrl.includes('127.0.0.1')) {
    throw new Error(
      `[Production Misconfiguration] VITE_API_URL must be configured and point to a production endpoint (not localhost). Current: "${rawApiUrl || ''}"`
    );
  }
}

export const API_BASE = (rawApiUrl || 'http://localhost:8000').replace(/\/+$/, '');

export interface HealthInfo {
  status: string;
  app: string;
  mongo: string;
  database?: string | null;
  counts?: Record<string, number>;
}

export async function fetchHealth(): Promise<HealthInfo> {
  return getJson<HealthInfo>('/api/health');
}

export function isApiConfigured(): boolean {
  return API_BASE.length > 0;
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { signal });
  if (!res.ok) {
    throw await toApiError(res, `GET ${path}`);
  }
  return res.json() as Promise<T>;
}

/** Structured API error carrying HTTP status + server code for friendly UI. */
export class ApiError extends Error {
  status: number;
  code: string | null;
  current: unknown;
  constructor(status: number, message: string, code: string | null = null, current: unknown = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.current = current;
  }
}

async function toApiError(res: Response, fallback: string): Promise<Error> {
  const message = await apiErrorMessage(res, fallback);
  let code: string | null = null;
  let current: unknown = null;
  try {
    const body = await res.clone().json();
    const detail = (body as any)?.detail;
    if (detail && typeof detail === 'object') {
      if (typeof detail.code === 'string') code = detail.code;
      if (detail.current !== undefined) current = detail.current;
      if (typeof detail.message === 'string') {
        if (res.status === 409 && code === 'VERSION_CONFLICT') {
          return new ApiError(res.status, 'This was changed by someone else, reload to see the latest version.', code, current);
        }
        return new ApiError(res.status, detail.message, code, current);
      }
    }
  } catch { /* fall through to generic message */ }
  if (res.status === 409) {
    return new ApiError(res.status, 'This was changed by someone else, reload to see the latest version.', code, current);
  }
  return new ApiError(res.status, message, code, current);
}

async function apiErrorMessage(res: Response, fallback: string): Promise<string> {
  let detail: unknown = null;
  try {
    const body = await res.json();
    detail = (body as any)?.detail ?? body;
  } catch {
    try { detail = await res.text(); } catch { detail = null; }
  }
  if (typeof detail === 'string' && detail) return `FastAPI ${res.status}: ${detail}`;
  if (Array.isArray(detail)) {
    const first = detail.map((d: any) => d.msg || d.message || JSON.stringify(d)).join(', ');
    if (first) return `FastAPI ${res.status}: ${first}`;
  } else if (detail && typeof detail === 'object') {
    const d = detail as any;
    if (d.message || d.code) return `FastAPI ${res.status}: ${d.message || d.code}`;
  }
  return `FastAPI ${res.status} on ${fallback}`;
}

async function sendJson<T>(method: string, path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(extraHeaders || {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    throw await toApiError(res, `${method} ${path}`);
  }
  return res.json() as Promise<T>;
}

/** Fresh idempotency key per submit attempt (reused only on auto-retry). */
export function newIdempotencyKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

interface Page<T> {
  items: T[];
  total: number;
}

/** Map a Mongo assessment document (to_public shape) to the UI profile shape. */
export function mapMongoAssessment(doc: any): AssessmentProfile {
  return {
    id: doc.jobId,
    jobId: doc.jobId,
    jobTitle: doc.jobTitle ?? '',
    jobDescription: doc.jobDescription ?? '',
    language: doc.language ?? 'ENGLISH',
    roundType: doc.roundType,
    questions: Array.isArray(doc.questions) ? doc.questions.map((q: any) => ({
      id: q.id ?? '',
      text: q.text ?? q.question ?? '',
      type: q.type,
      maxDuration: q.maxDuration ?? q.max_duration ?? 120,
      referenceAnswer: q.referenceAnswer ?? q.answer,
      criteria: q.criteria,
      options: q.options,
      correctOption: q.correctOption ?? q.correct_option,
      maxScore: q.maxScore ?? q.max_score,
      weightage: q.weightage,
    })) : [],
    isActive: doc.isActive ?? true,
    createdAt: asUtcIso(doc.createdAt ?? new Date().toISOString()),
    updatedAt: asUtcIso(doc.updatedAt),
    deactivatedAt: asUtcIso(doc.deactivatedAt ?? null),
    startDate: asUtcIso(doc.startDateIso ?? doc.startDate),
    endDate: asUtcIso(doc.endDateIso ?? doc.endDate),
    mongoId: doc.id,
    version: doc.version ?? 1,
    syncState: doc.syncState,
  } as AssessmentProfile;
}

/** Map a Mongo candidate document (to_public shape) to the UI candidate shape. */
export function mapMongoCandidate(doc: any): Candidate {
  const prime = doc.primehire ?? {};
  const sync = doc.syncState ?? {};
  return {
    id: doc.candidateKey,
    assessmentId: doc.assessmentId,
    name: doc.name ?? '',
    email: doc.email ?? '',
    phone: doc.phone ?? '',
    startTime: asUtcIso(doc.startTime ?? ''),
    endTime: asUtcIso(doc.endTime ?? ''),
    link: doc.link ?? null,
    password: null,
    assignedDate: asUtcIso(doc.assignedDate ?? null),
    submittedDate: asUtcIso(sync.submittedDate ?? null),
    status: doc.status ?? 'ACTIVE',
    reportStatus: sync.reportStatus ?? null,
    lastInviteSentAt: asUtcIso(sync.lastInviteSentAt),
    interviewId: prime.interviewId ?? null,
    responseId: prime.responseId ?? null,
    verifiedCandidateUUID: prime.candidateUUID ?? null,
    linkGenerated: doc.link ? true : undefined,
    inviteSent: sync.inviteSent,
    inviteSentAt: asUtcIso(sync.inviteSentAt ?? null),
    lastReminderSentAt: asUtcIso(sync.lastReminderSentAt ?? null),
    reminderCount: sync.reminderCount ?? 0,
    assessmentStatus: sync.assessmentStatus,
    mailStatus: sync.mailStatus,
    mongoId: doc.id,
  } as Candidate;
}

export interface AssessmentListParams {
  search?: string;
  roundType?: string;
  isActive?: boolean;
  since?: string;
  signal?: AbortSignal;
}

export async function fetchAssessments(params: AssessmentListParams = {}): Promise<AssessmentProfile[]> {
  const qs = new URLSearchParams({ limit: '200' });
  if (params.search) qs.set('search', params.search);
  if (params.roundType) qs.set('roundType', params.roundType);
  if (params.isActive !== undefined) qs.set('isActive', String(params.isActive));
  if (params.since) qs.set('since', params.since);
  const body = await getJson<Page<any>>(`/api/assessments?${qs.toString()}`, params.signal);
  return (body.items ?? []).map(mapMongoAssessment);
}

/** Outbound assessment payload (app-shaped; the backend maps to PrimeHire). */
export interface AssessmentWritePayload {
  jobId: string;
  jobTitle: string;
  jobDescription: string;
  language: string;
  roundType: string;
  questions: Array<{
    id: string;
    text: string;
    type: string;
    maxDuration: number;
    referenceAnswer?: string;
    criteria?: string;
    options?: string[];
    correctOption?: string;
    maxScore?: number;
    weightage?: number;
  }>;
  startDate?: string | null;
  endDate?: string | null;
}

export function assessmentToPayload(a: {
  jobId: string; jobTitle: string; jobDescription: string; language: string;
  roundType: string; questions: AssessmentProfile['questions'];
  startDate?: string; endDate?: string;
}): AssessmentWritePayload {
  return {
    jobId: a.jobId,
    jobTitle: a.jobTitle,
    jobDescription: a.jobDescription,
    language: a.language,
    roundType: a.roundType,
    questions: (a.questions ?? []).map((q) => ({
      id: q.id,
      text: q.text,
      type: q.type,
      maxDuration: q.maxDuration ?? 120,
      referenceAnswer: q.referenceAnswer,
      criteria: q.criteria,
      options: q.options,
      correctOption: q.correctOption,
      maxScore: q.maxScore,
      weightage: q.weightage,
    })),
    startDate: a.startDate ?? null,
    endDate: a.endDate ?? null,
  };
}

export async function createAssessment(
  input: AssessmentWritePayload, idempotencyKey?: string,
): Promise<AssessmentProfile> {
  const headers = idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined;
  const doc = await sendJson<any>('POST', '/api/assessments', input, headers);
  return mapMongoAssessment(doc);
}

export async function putAssessment(
  jobId: string, input: AssessmentWritePayload & { version: number },
): Promise<AssessmentProfile> {
  const doc = await sendJson<any>('PUT', `/api/assessments/${encodeURIComponent(jobId)}`, input);
  return mapMongoAssessment(doc);
}

export async function patchAssessment(
  jobId: string, patch: Record<string, unknown> & { version: number },
): Promise<AssessmentProfile> {
  const doc = await sendJson<any>('PATCH', `/api/assessments/${encodeURIComponent(jobId)}`, patch);
  return mapMongoAssessment(doc);
}

export async function setAssessmentActive(
  jobId: string, active: boolean, version: number,
): Promise<AssessmentProfile> {
  const action = active ? 'activate' : 'deactivate';
  const doc = await sendJson<any>(
    'PATCH', `/api/assessments/${encodeURIComponent(jobId)}/${action}`, { version },
  );
  return mapMongoAssessment(doc);
}

export async function retryAssessmentSync(jobId: string): Promise<AssessmentProfile> {
  const doc = await sendJson<any>('POST', `/api/assessments/${encodeURIComponent(jobId)}/retry`);
  return mapMongoAssessment(doc);
}

export async function fetchCandidates(assessmentId?: string): Promise<Candidate[]> {
  const qs = assessmentId ? `?assessment_id=${encodeURIComponent(assessmentId)}&limit=500` : '?limit=500';
  const body = await getJson<Page<any>>(`/api/candidates${qs}`);
  return (body.items ?? []).map(mapMongoCandidate);
}

/**
 * Shared mail templates (server-truth so every user sees the same list).
 * localStorage remains as an offline cache/fallback only.
 */

/** Map a Mongo template document to the UI MailTemplate shape. */
export function mapMongoTemplate(doc: any): MailTemplate {
  return {
    id: String(doc.id ?? ''),
    name: doc.name ?? '',
    type: doc.type ?? 'CUSTOM',
    subject: doc.subject ?? '',
    body: doc.body ?? '',
  };
}

export async function fetchTemplates(): Promise<MailTemplate[]> {
  const body = await getJson<{ items: any[] }>('/api/templates');
  return (body.items ?? []).map(mapMongoTemplate);
}

export async function createTemplate(t: MailTemplate): Promise<MailTemplate> {
  const doc = await sendJson<any>('POST', '/api/templates', {
    id: t.id,
    name: t.name,
    type: t.type,
    subject: t.subject,
    body: t.body,
  });
  return mapMongoTemplate(doc);
}

export async function deleteTemplate(id: string): Promise<void> {
  await sendJson<unknown>('DELETE', `/api/templates/${encodeURIComponent(id)}`);
}

export async function updateTemplate(
  id: string, patch: Partial<MailTemplate>,
): Promise<MailTemplate> {
  const body: Record<string, unknown> = {};
  if (patch.name !== undefined) body.name = patch.name;
  if (patch.type !== undefined) body.type = patch.type;
  if (patch.subject !== undefined) body.subject = patch.subject;
  if (patch.body !== undefined) body.body = patch.body;
  const doc = await sendJson<any>(
    'PUT', `/api/templates/${encodeURIComponent(id)}`, body,
  );
  return mapMongoTemplate(doc);
}

/**
 * Live View Report via the application backend (secure proxy).
 *
 * The browser sends ONLY the Job ID + Candidate ID it already knows, using
 * the existing app session. The backend resolves the PrimeHire interview
 * identifier from its own records, injects the PrimeHire API key
 * server-side, and relays the upstream report. The PrimeHire key is never
 * sent to, stored in, or returned to the browser — pass no credentials here.
 *
 * Returns the upstream report envelope verbatim (same shape the View Report
 * UI already renders: `{ status, message, data }` or the unwrapped report).
 */
export async function fetchLiveReport(jobId: string, candidateKey: string): Promise<any> {
  return getJson<any>(
    `/api/reports/jobs/${encodeURIComponent(jobId)}/candidates/${encodeURIComponent(candidateKey)}`,
  );
}

/** Outbound payload. Allowlist-built: password/rowLoading/answers/
 *  simulatedReport and other UI-only fields can never be sent. */
export interface CandidateWritePayload {
  candidateKey?: string;
  assessmentId: string;
  name: string;
  email: string;
  phone?: string;
  startTime?: string;
  endTime?: string;
  link?: string | null;
  assignedDate?: string | null;
  status?: 'ACTIVE' | 'INACTIVE';
  primehire?: {
    interviewId?: string | null;
    responseId?: string | null;
    candidateUUID?: string | null;
  };
  syncState?: {
    submittedDate?: string | null;
    assessmentStatus?: string | null;
    reportStatus?: 'GENERATING' | 'GENERATED' | 'FAILED' | null;
    inviteSent?: boolean | null;
    inviteSentAt?: string | null;
    lastInviteSentAt?: string | null;
    lastReminderSentAt?: string | null;
    reminderCount?: number | null;
    mailStatus?: string | null;
  };
}

export function candidateToPayload(c: Candidate): CandidateWritePayload {
  const reportStatus = (['GENERATING', 'GENERATED', 'FAILED'] as const).includes(
    c.reportStatus as any,
  )
    ? (c.reportStatus as 'GENERATING' | 'GENERATED' | 'FAILED')
    : null;
  return {
    candidateKey: c.id,
    assessmentId: c.assessmentId,
    name: c.name,
    email: c.email,
    phone: c.phone ?? '',
    startTime: c.startTime ?? '',
    endTime: c.endTime ?? '',
    link: c.link ?? null,
    assignedDate: c.assignedDate ?? null,
    status: c.status,
    primehire: {
      interviewId: c.interviewId ?? null,
      responseId: c.responseId ?? null,
      candidateUUID: c.verifiedCandidateUUID ?? null,
    },
    syncState: {
      submittedDate: c.submittedDate ?? null,
      assessmentStatus: c.assessmentStatus ?? null,
      reportStatus,
      inviteSent: c.inviteSent ?? null,
      inviteSentAt: c.inviteSentAt ?? null,
      lastInviteSentAt: c.lastInviteSentAt ?? null,
      lastReminderSentAt: c.lastReminderSentAt ?? null,
      reminderCount: c.reminderCount ?? 0,
      mailStatus: c.mailStatus ?? null,
    },
  };
}

export interface BulkResult {
  items: Candidate[];
  errors: Array<{ index: number; code: string; message: string }>;
}

export async function createCandidate(
  input: CandidateWritePayload,
): Promise<Candidate> {
  const doc = await sendJson<any>('POST', '/api/candidates', input);
  return mapMongoCandidate(doc);
}

export async function createCandidatesBulk(
  inputs: CandidateWritePayload[],
): Promise<BulkResult> {
  const body = await sendJson<{
    items: any[];
    errors: BulkResult['errors'];
  }>('POST', '/api/candidates/bulk', { items: inputs });
  return {
    items: (body.items ?? []).map(mapMongoCandidate),
    errors: body.errors ?? [],
  };
}

export async function updateCandidate(
  candidateKey: string,
  patch: Partial<CandidateWritePayload>,
): Promise<Candidate> {
  const doc = await sendJson<any>(
    'PUT',
    `/api/candidates/${encodeURIComponent(candidateKey)}`,
    patch,
  );
  return mapMongoCandidate(doc);
}

export async function deleteCandidate(candidateKey: string): Promise<void> {
  await sendJson<unknown>(
    'DELETE',
    `/api/candidates/${encodeURIComponent(candidateKey)}`,
  );
}

/**
 * Best-effort mirror of fresh UI state to MongoDB (link identifiers,
 * invite/reminder flags, status). Never throws: returns 'skipped' when the
 * candidate was never persisted (no mongoId), 'failed' with a console
 * warning when the server write fails. Callers decide whether to toast.
 */
export async function syncCandidateToServer(
  c: Candidate,
): Promise<'ok' | 'skipped' | 'failed'> {
  if (!c.mongoId) return 'skipped';
  try {
    const payload = candidateToPayload(c);
    await sendJson<unknown>('PUT', `/api/candidates/${encodeURIComponent(c.id)}`, {
      link: payload.link,
      assignedDate: payload.assignedDate,
      status: payload.status,
      primehire: payload.primehire,
      syncState: payload.syncState,
    });
    return 'ok';
  } catch (err) {
    console.warn('[mongoApi] server sync failed for', c.id, err);
    return 'failed';
  }
}
