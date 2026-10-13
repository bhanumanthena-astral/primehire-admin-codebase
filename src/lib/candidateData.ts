import type { Candidate } from '../types';
import { isRealInterviewId, toVerifiedCandidateUUID } from './primehireIds';

/** Remove retired testing fields when reading older browser or server records. */
export function sanitizeCandidateData(candidate: Candidate): Candidate {
  const { simulatedReport, answers, interviewExpired, ...clean } = candidate as Candidate & {
    simulatedReport?: unknown; answers?: unknown; interviewExpired?: unknown;
  };
  const fakeInterview = !!clean.interviewId && !isRealInterviewId(clean.interviewId);
  const fakeLink = !!clean.link && /primehire-test\.com/i.test(clean.link);
  if (fakeInterview || fakeLink) {
    clean.interviewId = null;
    clean.link = null;
    clean.password = null;
    clean.assignedDate = null;
    clean.linkGenerated = false;
    clean.linkValue = null;
    clean.inviteSent = false;
    clean.inviteSentAt = null;
    clean.lastInviteSentAt = undefined;
    clean.lastReminderSentAt = null;
    clean.reminderCount = 0;
    clean.mailStatus = 'Not Sent';
  }
  if (simulatedReport || fakeInterview || fakeLink) {
    clean.submittedDate = null;
    clean.reportStatus = null;
    clean.assessmentStatus = 'NOT_STARTED';
  }
  if (clean.responseId?.startsWith('res-')) clean.responseId = null;
  if (clean.verifiedCandidateUUID) {
    try { clean.verifiedCandidateUUID = toVerifiedCandidateUUID(clean.verifiedCandidateUUID); }
    catch { clean.verifiedCandidateUUID = null; }
  }
  return clean;
}
