import type { Candidate } from '../types';
import { primehireClient } from './primehireClient';
import { fetchLiveReport, fetchCandidate, updateCandidate, candidateToPayload } from './mongoApi';
import { sanitizeCandidateData } from './candidateData';
import { requireMinimumInterviewWindow } from '../utils/interviewSchedulePolicy';
import { cacheCandidateReport, candidateReportKey } from './candidateReportCache';
import {
  type JobId, type LocalCandidateId, asLocalCandidateId, asInterviewId,
  asResponseId, asJobId, toVerifiedCandidateUUID, generate32BitId, isRealInterviewId,
} from './primehireIds';

function candidateWithInterview(candidateId: LocalCandidateId, candidates: Candidate[]): Candidate {
  const candidate = candidates.find(c => c.id === candidateId);
  if (!candidate) throw new Error('Candidate not found.');
  if (!isRealInterviewId(candidate.interviewId)) {
    throw new Error('No provider interview is linked to this candidate. Generate an interview link first.');
  }
  return candidate;
}

function extractInterviews(response: any): any[] {
  if (Array.isArray(response?.data?.interviews)) return response.data.interviews;
  if (Array.isArray(response?.interviews)) return response.interviews;
  if (Array.isArray(response?.candidates)) return response.candidates;
  return Array.isArray(response) ? response : [];
}

/** Persist only credentials and identifiers actually returned by the provider. */
function mapInterviewResults(data: any[], ids: LocalCandidateId[], candidates: Candidate[]): Candidate[] {
  const updates = new Map<LocalCandidateId, Candidate>();
  for (const id of ids) {
    const candidate = candidates.find(c => c.id === id)!;
    const result = data.find(row => row.candidateId === id || row.candidate_id === id || row.email === candidate.email);
    const link = result?.url || result?.link || result?.interviewUrl;
    const password = result?.password || result?.accessCode;
    const interviewId = result?.id || result?.interviewId;
    if (!link || !password || !isRealInterviewId(interviewId) || /primehire-test\.com/i.test(link)) {
      throw new Error(`The provider did not return complete interview credentials for ${candidate.name || id}. Refresh status before retrying.`);
    }
    let verifiedCandidateUUID = null;
    const uuid = result.candidateUUID || result.candidateUuid || result.candidate_uuid || result.candidateId || result.candidate_id;
    if (uuid) {
      try { verifiedCandidateUUID = toVerifiedCandidateUUID(uuid); }
      catch { /* The documented candidate_id can be a local key, not a UUID. */ }
    }
    const responseId = result.responseId || result.response_id;
    updates.set(id, {
      ...candidate,
      link,
      password,
      interviewId: asInterviewId(interviewId),
      responseId: responseId && !responseId.startsWith('res-') ? asResponseId(responseId) : null,
      verifiedCandidateUUID,
      assignedDate: result.assignedDate || new Date().toISOString(),
      linkGenerated: true,
      linkValue: link,
      candidateStatus: candidate.status,
      assessmentStatus: candidate.submittedDate ? 'COMPLETED' : 'NOT_STARTED',
      mailStatus: candidate.mailStatus || 'Not Sent',
      rowLoading: false,
    });
  }
  return candidates.map(c => updates.get(c.id) || c);
}

export async function generateInterviewLinks(
  ids: LocalCandidateId[], candidates: Candidate[], roundType: string, jobId?: JobId,
): Promise<Candidate[]> {
  if (!ids.length) throw new Error('Select at least one candidate.');
  const selected = ids.map(id => {
    const candidate = candidates.find(c => c.id === id);
    if (!candidate) throw new Error('Candidate not found.');
    requireMinimumInterviewWindow(candidate.startTime, candidate.endTime);
    return candidate;
  });
  const resolvedJobId = jobId || asJobId(selected[0].assessmentId);
  if (!resolvedJobId || selected.some(c => c.assessmentId !== selected[0].assessmentId)) {
    throw new Error('Select candidates from one assessment to generate interview links.');
  }
  const response = await primehireClient.createInterview(resolvedJobId, roundType, selected.map(c => ({
    candidate_id: c.id, start_time: c.startTime, end_time: c.endTime,
  })));
  return mapInterviewResults(extractInterviews(response), ids, candidates);
}

/** A new provider candidate key is used only for the provider request.
 * The application's stable candidate key must keep its existing Mongo row. */
export async function regenerateInterviewLink(
  candidateId: LocalCandidateId, candidates: Candidate[], roundType: string, jobId?: JobId,
): Promise<Candidate[]> {
  if (!candidates.some(c => c.id === candidateId)) throw new Error('Candidate not found.');
  const newId = asLocalCandidateId('CAND-' + generate32BitId());
  const rotated = candidates.map(c => c.id === candidateId ? { ...c, id: newId } : c);
  const result = await generateInterviewLinks([newId], rotated, roundType, jobId);
  return result.map(c => c.id !== newId ? c : {
    ...c, id: candidateId, submittedDate: null, reportStatus: null, assessmentStatus: 'NOT_STARTED',
    mailStatus: 'Not Sent', inviteSent: false, inviteSentAt: null,
    lastInviteSentAt: undefined, lastReminderSentAt: null, reminderCount: 0,
  });
}

export class InterviewUnavailableError extends Error {
  constructor(public providerMessage: string) {
    super('PrimeHire could not find the linked interview. Create a new interview for the selected window and send its new link to the candidate.');
    this.name = 'InterviewUnavailableError';
  }
}

export async function rescheduleInterview(
  candidateId: LocalCandidateId, candidates: Candidate[], startTime: string, endTime: string,
): Promise<Candidate[]> {
  const candidate = candidateWithInterview(candidateId, candidates);
  try {
    const response = await primehireClient.rescheduleInterview(candidate.interviewId!, startTime, endTime);
    if (/^(error|failed|failure)$/i.test(response?.status || '')) {
      throw new Error(response.message || 'The provider rejected the reschedule request.');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/invalid\s+interview\s*id|interview\s*(?:was\s*)?not\s*found/i.test(message)) {
      throw new InterviewUnavailableError(message);
    }
    throw error;
  }
  return candidates.map(c => c.id !== candidateId ? c : {
    ...c, startTime, endTime, submittedDate: null, reportStatus: null,
    assessmentStatus: 'NOT_STARTED', mailStatus: 'Not Sent', inviteSent: false,
    inviteSentAt: null, lastInviteSentAt: undefined, lastReminderSentAt: null, reminderCount: 0,
  });
}

export interface InterviewScheduleUpdate {
  candidate: Candidate;
  outcome: 'rescheduled' | 'window_saved' | 'new_interview';
  persisted: boolean;
}

/** Only changes candidate scheduling/linkage. It never publishes assessment content. */
export async function updateInterviewSchedule(
  candidateId: LocalCandidateId, candidates: Candidate[], startTime: string, endTime: string,
  replacement?: { roundType: string; jobId: JobId },
): Promise<InterviewScheduleUpdate> {
  requireMinimumInterviewWindow(startTime, endTime);
  const cached = candidates.find(c => c.id === candidateId);
  if (!cached) throw new Error('Candidate not found. Reload the candidate list.');
  let candidate = sanitizeCandidateData(cached);
  if (cached.mongoId) {
    const fresh = await fetchCandidate(candidateId);
    if (fresh.id !== candidateId) throw new Error('Candidate linkage changed. Reload the candidate list.');
    candidate = { ...fresh, password: fresh.link === candidate.link ? candidate.password : null };
  }
  if (candidate.status !== 'ACTIVE') throw new Error('Cannot reschedule an inactive candidate.');
  let updated: Candidate;
  let outcome: InterviewScheduleUpdate['outcome'];
  if (replacement) {
    [updated] = await regenerateInterviewLink(candidateId, [{ ...candidate, startTime, endTime }], replacement.roundType, replacement.jobId);
    outcome = 'new_interview';
  } else if (isRealInterviewId(candidate.interviewId)) {
    [updated] = await rescheduleInterview(candidateId, [candidate], startTime, endTime);
    outcome = 'rescheduled';
  } else {
    updated = { ...candidate, startTime, endTime };
    outcome = 'window_saved';
  }
  if (!updated.mongoId) return { candidate: updated, outcome, persisted: false };
  const payload = candidateToPayload(updated);
  try {
    await updateCandidate(candidateId, {
      startTime: payload.startTime, endTime: payload.endTime,
      link: payload.link, assignedDate: payload.assignedDate,
      primehire: payload.primehire, syncState: payload.syncState,
    });
  } catch (error) {
    // Without a provider write there is no remote change to reconcile: fail
    // before the UI is allowed to present a locally updated schedule as saved.
    if (outcome === 'window_saved') throw error;
    return { candidate: updated, outcome, persisted: false };
  }
  return { candidate: updated, outcome, persisted: true };
}

export async function resetCandidatePassword(
  candidateId: LocalCandidateId, candidates: Candidate[], password: string,
): Promise<Candidate[]> {
  const candidate = candidates.find(c => c.id === candidateId);
  if (!candidate) throw new Error('Candidate not found.');
  let uuid;
  try { uuid = toVerifiedCandidateUUID(candidate.verifiedCandidateUUID || candidate.id); }
  catch { throw new Error('A verified provider candidate UUID is required to reset the password. Refresh candidate details first.'); }
  await primehireClient.resetCandidatePassword(uuid, password);
  return candidates.map(c => c.id === candidateId ? { ...c, password } : c);
}

async function lookupResponseId(interviewId: string): Promise<string | null> {
  try {
    const result = await primehireClient.getReportsNotGenerated();
    const match = (result?.data?.responses || []).find((r: any) =>
      r.interviewId === interviewId || r.interview_id === interviewId);
    const id = match?.id || match?.responseId || match?.response_id;
    return id && !id.startsWith('res-') ? id : null;
  } catch {
    // Response linkage is optional; the actual interview status remains usable.
    return null;
  }
}

export async function getInterviewStatus(candidateId: LocalCandidateId, candidates: Candidate[]): Promise<Candidate[]> {
  const candidate = candidateWithInterview(candidateId, candidates);
  const response = await primehireClient.getInterviewStatus(candidate.interviewId!);
  const status = response?.data?.interviewStatus;
  if (!status) throw new Error('The provider did not return an interview status.');
  const submitted = !!status.isInterviewSubmitted;
  const existingResponseId = candidate.responseId && !candidate.responseId.startsWith('res-') ? candidate.responseId : null;
  const resolvedResponseId = submitted && !existingResponseId ? await lookupResponseId(candidate.interviewId!) : existingResponseId;
  return candidates.map(c => c.id !== candidateId ? c : {
    ...c,
    submittedDate: submitted ? status.submittedAt || c.submittedDate || null : null,
    assessmentStatus: submitted ? 'COMPLETED' : 'NOT_STARTED',
    reportStatus: submitted ? (status.isReportAvailable ? 'GENERATED' : 'GENERATING') : null,
    responseId: resolvedResponseId ? asResponseId(resolvedResponseId) : null,
  });
}

/** Both retrieval routes contact the provider; neither manufactures report data. */
export async function getCandidateReport(candidateId: LocalCandidateId, candidates: Candidate[] = []) {
  const candidate = candidateWithInterview(candidateId, candidates);
  const key = candidateReportKey(candidate);
  let response;
  try { response = await fetchLiveReport(candidate.assessmentId, candidate.id); }
  catch { response = await primehireClient.getInterviewReport(candidate.interviewId!); }
  const raw = response?.data ?? response;
  if (!raw || (response?.status && response.status !== 'SUCCESS')) {
    throw new Error(response?.message || 'No evaluation report is available for this candidate.');
  }
  const report = { ...raw, candidateId, _isRealReport: true };
  cacheCandidateReport(candidate, report, key);
  return report;
}
