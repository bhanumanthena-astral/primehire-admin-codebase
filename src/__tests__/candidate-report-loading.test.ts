import { afterEach, describe, expect, test, vi } from 'vitest';
import type { Candidate } from '../types';
import { asInterviewId, asLocalCandidateId } from '../lib/primehireIds';
import { loadCandidateFilterReport } from '../hooks/useCandidateReports';
import { candidateReportKey, cacheCandidateReport, getCachedCandidateReport, invalidateCandidateReport } from '../lib/candidateReportCache';
import { mockGetReport } from '../mockData';
import { checkScoreFilter, getCandidateScore } from '../utils/reportScoreFilters';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const report = { status: 'SUCCESS', data: { interview_details: { round_type: 'BASIC' }, report: { overall_score: 82 } } };
const candidate = (name: string) => ({ id: asLocalCandidateId(`CAND-${name}`), assessmentId: 'JOB-grade', interviewId: asInterviewId(`interview-${name}`), reportStatus: 'GENERATED' } as Candidate);
const response = () => new Response(JSON.stringify(report), { status: 200 });

describe('candidate filters load actual reports', () => {
  test('filters work before View Report is opened, sharing duplicate loads', async () => {
    const c = candidate('load');
    const fetchMock = vi.fn().mockImplementation(async () => response());
    vi.stubGlobal('fetch', fetchMock);
    await Promise.all([loadCandidateFilterReport(c), loadCandidateFilterReport(c)]);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toContain('/api/reports/jobs/JOB-grade/candidates/CAND-load');
    const score = getCandidateScore(c, 'BASIC', 'Overall Score', null, null, 'BASIC', getCachedCandidateReport(c));
    expect(checkScoreFilter(score, 'scale5', 'A')).toBe(true);
    expect(checkScoreFilter(score, 'scale5', 'B+')).toBe(false);
    await loadCandidateFilterReport(c);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  test('opening View Report updates the same cache used by grade filters', async () => {
    const c = candidate('view');
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => response()));
    const viewed = await mockGetReport(c.id, [c]);
    expect(getCachedCandidateReport(c)).toBe(viewed);
    expect(getCandidateScore(c, 'BASIC', 'Overall Score', null, null, 'BASIC', viewed)).toBe(82);
  });

  test('missing provider identifiers never fall back to a fabricated report', async () => {
    const c = { ...candidate('missing'), interviewId: null };
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(loadCandidateFilterReport(c)).rejects.toThrow('No evaluation report');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getCachedCandidateReport(c)).toBeUndefined();
  });

  test('failed loads stay unmatched and can be retried', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const c = candidate('retry');
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ message: 'Report unavailable' }), { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(loadCandidateFilterReport(c)).rejects.toThrow();
    expect(getCachedCandidateReport(c)).toBeUndefined();
    fetchMock.mockImplementation(async () => response());
    await loadCandidateFilterReport(c);
    expect(getCachedCandidateReport(c)).toBeDefined();
  });

  test('invalidation discards old grades and ignores late responses from before regeneration', () => {
    const c = candidate('invalidate');
    const oldKey = candidateReportKey(c);
    cacheCandidateReport(c, report, oldKey);
    expect(getCachedCandidateReport(c)).toBe(report);
    invalidateCandidateReport(c);
    expect(getCachedCandidateReport(c)).toBeUndefined();
    cacheCandidateReport(c, report, oldKey);
    expect(getCachedCandidateReport(c)).toBeUndefined();
    const fresh = { overallScore: 95 };
    cacheCandidateReport(c, fresh);
    expect(getCachedCandidateReport(c)).toBe(fresh);
  });
});
