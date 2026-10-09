import type { Candidate } from '../types';

const reports = new Map<string, any>();
const generations = new Map<string, number>();
const listeners = new Set<() => void>();
let version = 0;

export function candidateReportKey(candidate: Candidate): string {
  return JSON.stringify([candidate.id, candidate.assessmentId, candidate.interviewId, candidate.responseId,
    candidate.submittedDate, candidate.startTime, candidate.endTime, candidate.reportStatus, generations.get(candidate.id) ?? 0]);
}

export function getCachedCandidateReport(candidate: Candidate): any {
  return reports.get(candidateReportKey(candidate));
}

export function cacheCandidateReport(candidate: Candidate, report: any, expectedKey = candidateReportKey(candidate)): any {
  // A late fetch from before regeneration must not replace the refreshed report.
  if (candidateReportKey(candidate) !== expectedKey) return report;
  reports.set(expectedKey, report);
  version++;
  listeners.forEach(listener => listener());
  return report;
}

export function invalidateCandidateReport(candidate: Candidate): void {
  reports.delete(candidateReportKey(candidate));
  generations.set(candidate.id, (generations.get(candidate.id) ?? 0) + 1);
  version++;
  listeners.forEach(listener => listener());
}

export function subscribeCandidateReports(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export const candidateReportsVersion = () => version;
