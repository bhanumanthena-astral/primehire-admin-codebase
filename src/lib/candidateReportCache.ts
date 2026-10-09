import type { Candidate } from '../types';

const reports = new Map<string, any>();
const listeners = new Set<() => void>();
let version = 0;

export function candidateReportKey(candidate: Candidate): string {
  return JSON.stringify([candidate.id, candidate.assessmentId, candidate.interviewId, candidate.responseId,
    candidate.submittedDate, candidate.startTime, candidate.endTime, candidate.reportStatus]);
}

export function getCachedCandidateReport(candidate: Candidate): any {
  return reports.get(candidateReportKey(candidate));
}

export function cacheCandidateReport(candidate: Candidate, report: any, expectedKey = candidateReportKey(candidate)): any {
  // A late fetch for an old interview or report status must not populate the current cache entry.
  if (candidateReportKey(candidate) !== expectedKey) return report;
  reports.set(expectedKey, report);
  version++;
  listeners.forEach(listener => listener());
  return report;
}

export function subscribeCandidateReports(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export const candidateReportsVersion = () => version;
