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
    throw new Error(`FastAPI ${res.status} on GET ${path}`);
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
