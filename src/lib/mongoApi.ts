import { AssessmentProfile, Candidate } from '../types';

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

const API_BASE = (
  (import.meta as any).env?.VITE_API_URL as string | undefined || 'http://localhost:8000'
).replace(/\/+$/, '');

export function isApiConfigured(): boolean {
  return API_BASE.length > 0;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    throw new Error(await apiErrorMessage(res, `GET ${path}`));
  }
  return res.json() as Promise<T>;
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

async function sendJson<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(await apiErrorMessage(res, `${method} ${path}`));
  }
  return res.json() as Promise<T>;
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
    language: doc.language ?? 'en',
    roundType: doc.roundType,
    questions: Array.isArray(doc.questions) ? doc.questions : [],
    isActive: doc.isActive ?? true,
    createdAt: doc.createdAt ?? new Date().toISOString(),
    deactivatedAt: doc.deactivatedAt ?? null,
    startDate: doc.startDate,
    endDate: doc.endDate,
    mongoId: doc.id,
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
    startTime: doc.startTime ?? '',
    endTime: doc.endTime ?? '',
    link: doc.link ?? null,
    password: null,
    assignedDate: doc.assignedDate ?? null,
    submittedDate: sync.submittedDate ?? null,
    status: doc.status ?? 'ACTIVE',
    reportStatus: sync.reportStatus ?? null,
    lastInviteSentAt: sync.lastInviteSentAt,
    interviewId: prime.interviewId ?? null,
    responseId: prime.responseId ?? null,
    verifiedCandidateUUID: prime.candidateUUID ?? null,
    linkGenerated: doc.link ? true : undefined,
    inviteSent: sync.inviteSent,
    inviteSentAt: sync.inviteSentAt ?? null,
    lastReminderSentAt: sync.lastReminderSentAt ?? null,
    reminderCount: sync.reminderCount ?? 0,
    assessmentStatus: sync.assessmentStatus,
    mailStatus: sync.mailStatus,
    mongoId: doc.id,
  } as Candidate;
}

export async function fetchAssessments(): Promise<AssessmentProfile[]> {
  const body = await getJson<Page<any>>('/api/assessments?limit=200');
  return (body.items ?? []).map(mapMongoAssessment);
}

export async function fetchCandidates(assessmentId?: string): Promise<Candidate[]> {
  const qs = assessmentId ? `?assessment_id=${encodeURIComponent(assessmentId)}&limit=500` : '?limit=500';
  const body = await getJson<Page<any>>(`/api/candidates${qs}`);
  return (body.items ?? []).map(mapMongoCandidate);
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
