import { afterEach, describe, expect, test, vi } from 'vitest';
import type { Candidate } from '../types';
import { primehireClient } from '../lib/primehireClient';
import { asInterviewId, asJobId, asLocalCandidateId, toVerifiedCandidateUUID } from '../lib/primehireIds';
import { generateInterviewLinks, getCandidateReport, getInterviewStatus, resetCandidatePassword, rescheduleInterview } from '../lib/interviewOperations';
import { sanitizeCandidateData } from '../lib/candidateData';
import { mapMongoCandidate } from '../lib/mongoApi';
import { getCachedCandidateReport } from '../lib/candidateReportCache';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const candidate = (id = 'CAND-real'): Candidate => ({
  id: asLocalCandidateId(id), assessmentId: 'JOB-real', name: 'Candidate', email: 'candidate@example.com', phone: '',
  startTime: '2026-10-20T12:00:00Z', endTime: '2026-10-21T12:00:00Z',
  link: null, password: null, assignedDate: null, submittedDate: null, status: 'ACTIVE', reportStatus: null,
});
const credentials = (c: Candidate) => ({
  id: 'provider-interview', candidateId: c.id, url: 'https://elitehr.nxtagent.ai/auth/login/user/provider-user', password: 'provider-password',
});

describe('production scheduling never fabricates success', () => {
  test('a provider error leaves candidates unchanged and is not retried with fabricated IDs', async () => {
    const c = candidate();
    const before = structuredClone(c);
    const api = vi.spyOn(primehireClient, 'createInterview').mockRejectedValue(new Error('Duplicate Candidate IDs found'));
    await expect(generateInterviewLinks([c.id], [c], 'BASIC', asJobId('JOB-real'))).rejects.toThrow('Duplicate Candidate IDs');
    expect(api).toHaveBeenCalledOnce();
    expect(c).toEqual(before);
  });

  test('complete provider credentials are used verbatim without fallback UUIDs or response IDs', async () => {
    const c = candidate();
    vi.spyOn(primehireClient, 'createInterview').mockResolvedValue({ status: 'SUCCESS', data: { interviews: [credentials(c)] } });
    const [result] = await generateInterviewLinks([c.id], [c], 'BASIC');
    expect(result.link).toBe(credentials(c).url);
    expect(result.password).toBe('provider-password');
    expect(result.interviewId).toBe('provider-interview');
    expect(result.responseId).toBeNull();
    expect(result.verifiedCandidateUUID).toBeNull();
    expect(c.link).toBeNull();
  });

  test('an incomplete bulk response cannot manufacture credentials for omitted candidates', async () => {
    const first = candidate(), second = { ...candidate('CAND-second'), email: 'second@example.com' };
    vi.spyOn(primehireClient, 'createInterview').mockResolvedValue({ data: { interviews: [credentials(first)] } });
    await expect(generateInterviewLinks([first.id, second.id], [first, second], 'BASIC')).rejects.toThrow('complete interview credentials');
    expect(first.link).toBeNull();
    expect(second.link).toBeNull();
  });

  test('a provider failure while rescheduling never changes the displayed window', async () => {
    const c = { ...candidate(), interviewId: asInterviewId('provider-interview') };
    vi.spyOn(primehireClient, 'rescheduleInterview').mockRejectedValue(new Error('Schedule rejected'));
    await expect(rescheduleInterview(c.id, [c], '2026-10-22T12:00:00Z', '2026-10-23T12:00:00Z')).rejects.toThrow('Schedule rejected');
    expect(c.startTime).toBe('2026-10-20T12:00:00Z');
  });

  test.each([undefined, 'c3a7db8e-0f2c-473d-82ba-aaaaaaaaaaaa'])('password reset does not invent or reuse a fallback UUID: %s', async uuid => {
    const c = { ...candidate(), verifiedCandidateUUID: uuid } as Candidate;
    const api = vi.spyOn(primehireClient, 'resetCandidatePassword');
    await expect(resetCandidatePassword(c.id, [c], 'new-password')).rejects.toThrow('verified provider candidate UUID');
    expect(api).not.toHaveBeenCalled();
  });

  test('a verified provider UUID is sent for password reset', async () => {
    const c = { ...candidate(), verifiedCandidateUUID: toVerifiedCandidateUUID('11111111-2222-3333-4444-555555555555') };
    const api = vi.spyOn(primehireClient, 'resetCandidatePassword').mockResolvedValue({ status: 'SUCCESS' });
    const [result] = await resetCandidatePassword(c.id, [c], 'new-password');
    expect(api).toHaveBeenCalledWith(c.verifiedCandidateUUID, 'new-password');
    expect(result.password).toBe('new-password');
  });
});

describe('only live statuses and reports are used', () => {
  test('a failed status request surfaces the error and does not alter completion', async () => {
    const c = { ...candidate(), interviewId: asInterviewId('provider-status'), submittedDate: '2026-10-21T12:00:00Z', reportStatus: 'GENERATED' as const };
    vi.spyOn(primehireClient, 'getInterviewStatus').mockRejectedValue(new Error('Status unavailable'));
    await expect(getInterviewStatus(c.id, [c])).rejects.toThrow('Status unavailable');
    expect(c.reportStatus).toBe('GENERATED');
  });

  test('submission time is not fabricated when the provider omits it', async () => {
    const c = { ...candidate(), interviewId: asInterviewId('provider-submitted') };
    vi.spyOn(primehireClient, 'getInterviewStatus').mockResolvedValue({ data: { interviewStatus: { isInterviewSubmitted: true, isReportAvailable: true } } });
    vi.spyOn(primehireClient, 'getReportsNotGenerated').mockResolvedValue({ data: { responses: [] } });
    const [result] = await getInterviewStatus(c.id, [c]);
    expect(result.assessmentStatus).toBe('COMPLETED');
    expect(result.submittedDate).toBeNull();
    expect(result.responseId).toBeNull();
  });

  test('old simulator reports and fake interview IDs cannot be opened or cached', async () => {
    const c = { ...candidate('CAND-old-simulator'), interviewId: asInterviewId('int-test'), simulatedReport: { overallScore: 88 } };
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(getCandidateReport(c.id, [c])).rejects.toThrow('No provider interview');
    expect(fetch).not.toHaveBeenCalled();
    expect(getCachedCandidateReport(c)).toBeUndefined();
  });

  test('both failed real retrieval routes produce an error rather than a sample report', async () => {
    const c = { ...candidate('CAND-report-failure'), interviewId: asInterviewId('provider-report') };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'Report unavailable' }), { status: 503 })));
    vi.spyOn(primehireClient, 'getInterviewReport').mockRejectedValue(new Error('Provider report unavailable'));
    await expect(getCandidateReport(c.id, [c])).rejects.toThrow('Provider report unavailable');
    expect(getCachedCandidateReport(c)).toBeUndefined();
  });
});

describe('historical test data cannot restore simulation state', () => {
  test('cached testing credentials, results, and expiry overrides are discarded without removing the candidate', () => {
    const c = { ...candidate(), interviewId: asInterviewId('int-old'), link: 'https://primehire-test.com/interview/old', password: 'PRIME-old',
      submittedDate: '2026-10-21T12:00:00Z', reportStatus: 'GENERATED' as const, interviewExpired: true, simulatedReport: { overallScore: 88 }, answers: { q: 'test' } };
    const clean = sanitizeCandidateData(c);
    expect(clean.id).toBe(c.id);
    expect(clean.endTime).toBe(c.endTime);
    expect(clean.link).toBeNull();
    expect(clean.password).toBeNull();
    expect(clean.reportStatus).toBeNull();
    expect(clean.submittedDate).toBeNull();
    for (const field of ['simulatedReport', 'answers', 'interviewExpired']) expect(clean).not.toHaveProperty(field);
  });

  test('genuine candidate credentials and results are preserved', () => {
    const c = { ...candidate(), interviewId: asInterviewId('provider-real'), link: credentials(candidate()).url,
      submittedDate: '2026-10-21T12:00:00Z', reportStatus: 'GENERATED' as const };
    expect(sanitizeCandidateData(c)).toEqual(c);
  });

  test('server-loaded simulator payloads also cannot become generated reports', () => {
    const clean = mapMongoCandidate({ candidateKey: 'CAND-server-old', assessmentId: 'JOB-real', primehire: { interviewId: 'provider-real' },
      syncState: { reportStatus: 'GENERATED', submittedDate: '2026-10-21T12:00:00Z' }, simulatedReport: { overallScore: 88 } });
    expect(clean.reportStatus).toBeNull();
    expect(clean).not.toHaveProperty('simulatedReport');
  });
});
