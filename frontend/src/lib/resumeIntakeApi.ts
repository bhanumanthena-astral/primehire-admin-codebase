import {authFetch} from './authFetch';

const BASE = `${((import.meta as any).env?.VITE_API_URL || '').replace(/\/+$/, '')}/api/resume-intake`;
export type Profile = {name: string; email: string; phone: string; skills: string[]; experienceYears: number | null; [field: string]: string | number | null | string[]};
export type Limits = {resumeMaxMb: number; zipMaxMb: number; zipMaxFiles: number; expandedMaxMb: number; excelMaxMb: number; excelMaxRows: number; excellentAt: number; goodAt: number; moderateAt: number; viewerDownloads: boolean};
export type Capabilities = {enabled: boolean; limits: Limits; settingsRevision: number; canUpload: boolean; canAdmin: boolean; canAssign: boolean; canDownload: boolean; queuePending: number; workerReady?: boolean; scannerReady?: boolean; ocrConfigured: boolean; docConversionConfigured: boolean};
export type Ats = {overall: number; category: string; breakdown: Record<string, number | null>; matchedSkills: string[]; missingSkills: string[]; strengths: string[]; gaps: string[]; method: string; note: string; localOverall?: number; llmScore?: number|null; llmStatus?: string; llmReasons?: string[]; needsReview?: boolean};
export type AtsRange = {minimum: number; maximum: number};
export type AtsSelection = {range: AtsRange | null; rangeRevision: number; eligible: boolean; state: 'range_required'|'within'|'below'|'above'|'pending'|'score_failed'|'already_created'; score?: number};
export type IntakeItem = {atsSelection?: AtsSelection; atsState?: string; atsError?: string; itemId: string; batchId: string; fileName: string; status: string; revision: number; profile: Partial<Profile>; error?: string; warnings?: string[]; ats?: Ats | null; atsStale?: boolean; rawText?: string; hasResume?: boolean; canEdit?: boolean; applicantId?: string; applicationId?: string; assignedUserId?: string; confidence?: Record<string, string>; matches?: {candidateId: string; name: string; email: string; phone: string}[]; notes?: {text: string; createdAt: string; actorUserId: string}[]};
export type IntakeBatch = {atsRange?: AtsRange; atsRangeRevision?: number; canSetAtsRange?: boolean; atsStats?: {within: number; below: number; above: number; pending: number}; atsPending?: number; batchId: string; jobId: string; jobKey: string; jobTitle: string; mode: string; source: string; status: string; counts: Record<string, number>; createdAt: string; importComplete: boolean; bulkApprovalRunning?: boolean; bulkApprovalResult?: {queued: number; skipped: number}; error?: string};
export type BatchPage = {batch: IntakeBatch; items: IntakeItem[]; total: number; skip: number};
export type CandidateRow = {candidateId: string; applicationId: string; name: string; email: string; phone: string; stage: string; score: number | null; ats: Ats | null; itemId?: string; applicationDate: string};

async function checked(path: string, init?: RequestInit) {
  const response = await authFetch(`${BASE}${path}`, init);
  if (!response.ok) {
    let message = `Request failed (${response.status}). Please retry.`;
    try {
      const body = await response.json();
      if (typeof body.detail === 'string') message = body.detail;
      else if (Array.isArray(body.detail)) message = body.detail.map((e: any) => `${e.loc?.slice(1).join('.') || 'Input'}: ${e.msg}`).join('; ');
    } catch { /* retain safe status-only error */ }
    throw new Error(message);
  }
  return response;
}

export async function intakeGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  return (await checked(path, {signal})).json();
}
export async function intakeMutate<T>(path: string, body: unknown, method = 'POST'): Promise<T> {
  return (await checked(path, {method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)})).json();
}
export async function intakeUpload(jobId: string, mode: string, source: string, files: File[], companion: File | null, key: string, signal: AbortSignal): Promise<IntakeBatch> {
  const body = new FormData();
  body.append('jobId', jobId); body.append('mode', mode); body.append('source', source); body.append('consent', 'true');
  files.forEach(file => body.append('files', file, file.name));
  if (companion) body.append('resumeArchive', companion, companion.name);
  return (await checked('/upload', {method: 'POST', body, signal, headers: {'Idempotency-Key': key}})).json();
}
export async function intakeBlob(path: string) {
  return (await checked(path)).blob();
}
export async function intakeDownload(path: string, name: string) {
  const blob = await intakeBlob(path);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = name;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
