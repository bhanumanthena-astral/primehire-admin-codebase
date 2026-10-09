import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Candidate } from '../types';
import { mockGetReport } from '../mockData';
import { candidateReportKey, getCachedCandidateReport, subscribeCandidateReports, candidateReportsVersion } from '../lib/candidateReportCache';

const pending = new Map<string, Promise<any>>();

export function loadCandidateFilterReport(candidate: Candidate): Promise<any> {
  const key = candidateReportKey(candidate);
  const cached = getCachedCandidateReport(candidate);
  if (cached) return Promise.resolve(cached);
  if (!candidate.simulatedReport && (!candidate.interviewId || candidate.interviewId.startsWith('int-'))) {
    return Promise.reject(new Error('No evaluation report is available for this candidate.'));
  }
  const existing = pending.get(key);
  if (existing) return existing;
  const request = mockGetReport(candidate.id, [candidate]);
  pending.set(key, request);
  request.then(() => pending.delete(key), () => pending.delete(key));
  return request;
}

/** Fetches report scores only when an evaluation filter is active. */
export function useCandidateReports(candidates: Candidate[], enabled: boolean) {
  useSyncExternalStore(subscribeCandidateReports, candidateReportsVersion, candidateReportsVersion);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(0);
  const [retry, setRetry] = useState(0);
  const eligible = candidates.filter(c => c.reportStatus !== 'GENERATING' && c.reportStatus !== 'FAILED' &&
    (c.reportStatus === 'GENERATED' || c.submittedDate || c.simulatedReport));
  const requestKey = eligible.map(candidateReportKey).join('|');

  useEffect(() => {
    if (!enabled) { setLoading(false); setFailed(0); return; }
    let cancelled = false;
    const todo = eligible.filter(c => !getCachedCandidateReport(c));
    setLoading(todo.length > 0);
    setFailed(0);
    let index = 0;
    let errors = 0;
    const worker = async () => {
      while (!cancelled && index < todo.length) {
        const candidate = todo[index++];
        try { await loadCandidateFilterReport(candidate); }
        catch { errors++; }
      }
    };
    void Promise.all(Array.from({ length: Math.min(3, todo.length) }, worker)).then(() => {
      if (!cancelled) { setLoading(false); setFailed(errors); }
    });
    return () => { cancelled = true; };
  }, [enabled, requestKey, retry]);

  return { getReport: getCachedCandidateReport, loading, failed, retry: () => setRetry(value => value + 1) };
}
