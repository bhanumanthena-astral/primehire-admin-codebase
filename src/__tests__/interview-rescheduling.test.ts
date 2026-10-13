import { afterEach, describe, expect, test, vi } from 'vitest';
import type { Candidate } from '../types';
import { asInterviewId, asJobId, asLocalCandidateId } from '../lib/primehireIds';
import { primehireClient } from '../lib/primehireClient';
import { candidateToPayload, fetchCandidate, syncCandidateToServer } from '../lib/mongoApi';
import { InterviewUnavailableError, regenerateInterviewLink, updateInterviewSchedule } from '../lib/interviewOperations';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const startTime = '2026-10-22T12:00:00Z';
const endTime = '2026-10-23T12:00:00Z';
function candidate(): Candidate {
  return {
    id: asLocalCandidateId('CAND-stable'), mongoId: 'mongo-candidate', assessmentId: 'JOB-existing',
    name: 'Candidate', email: 'candidate@example.com', phone: '', status: 'ACTIVE',
    startTime: '2026-10-20T12:00:00Z', endTime: '2026-10-21T12:00:00Z',
    interviewId: asInterviewId('provider-existing'), link: 'https://elitehr.nxtagent.ai/auth/login/user/existing',
    password: 'existing-password', assignedDate: '2026-10-13T12:00:00Z', submittedDate: null, reportStatus: null,
  };
}
function document(c: Candidate): any {
  return { ...candidateToPayload(c), id: c.mongoId };
}
function database(c: Candidate, failSave = false) {
  let stored = document(c);
  const fetch = vi.fn(async (_url: string, options?: RequestInit) => {
    if (options?.method === 'PUT') {
      if (failSave) return new Response(JSON.stringify({ detail: 'Candidate save unavailable' }), { status: 503 });
      stored = { ...stored, ...JSON.parse(options.body as string) };
    }
    return new Response(JSON.stringify(stored), { status: 200 });
  });
  vi.stubGlobal('fetch', fetch);
  return { fetch, stored: () => stored };
}

describe('normal interview rescheduling', () => {
  test('uses durable interview linkage and persists dates so refreshing retains the selected window', async () => {
    const cached = candidate();
    const db = database({ ...cached, interviewId: asInterviewId('provider-current') });
    const reschedule = vi.spyOn(primehireClient, 'rescheduleInterview').mockResolvedValue({ status: 'SUCCESS' });
    const createInterview = vi.spyOn(primehireClient, 'createInterview');
    const createAssessment = vi.spyOn(primehireClient, 'createAssessment');
    const result = await updateInterviewSchedule(cached.id, [cached], startTime, endTime);
    expect(reschedule).toHaveBeenCalledWith('provider-current', startTime, endTime);
    expect(result.outcome).toBe('rescheduled');
    expect(result.persisted).toBe(true);
    const saved = JSON.parse(db.fetch.mock.calls[1][1]!.body as string);
    expect(saved).toMatchObject({ startTime, endTime, primehire: { interviewId: 'provider-current' } });
    expect(saved).not.toHaveProperty('questions');
    const refreshed = await fetchCandidate(cached.id);
    expect(Date.parse(refreshed.startTime)).toBe(Date.parse(startTime));
    expect(Date.parse(refreshed.endTime)).toBe(Date.parse(endTime));
    expect(refreshed.id).toBe(cached.id);
    expect(createInterview).not.toHaveBeenCalled();
    expect(createAssessment).not.toHaveBeenCalled();
  });

  test('legacy test credentials are not sent to the provider and are removed while saving the planned window', async () => {
    const old = { ...candidate(), interviewId: asInterviewId('int-old-test'), link: 'https://primehire-test.com/interview/test', password: 'PRIME-test' };
    const db = database(old);
    const provider = vi.spyOn(primehireClient, 'rescheduleInterview');
    const create = vi.spyOn(primehireClient, 'createInterview');
    const result = await updateInterviewSchedule(old.id, [old], startTime, endTime);
    expect(result.outcome).toBe('window_saved');
    expect(result.persisted).toBe(true);
    expect(result.candidate.link).toBeNull();
    expect(result.candidate.interviewId).toBeNull();
    expect(db.stored()).toMatchObject({ startTime, endTime, link: null, primehire: { interviewId: null } });
    expect(provider).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  test('provider failures do not change or persist the schedule', async () => {
    const c = candidate();
    const db = database(c);
    vi.spyOn(primehireClient, 'rescheduleInterview').mockRejectedValue(new Error('Provider rejected this window'));
    await expect(updateInterviewSchedule(c.id, [c], startTime, endTime)).rejects.toThrow('Provider rejected');
    expect(db.fetch).toHaveBeenCalledOnce();
    expect(db.stored().startTime).toBe(c.startTime);
    expect(c.startTime).toBe('2026-10-20T12:00:00Z');
  });

  test('a missing provider interview gives actionable recovery without automatically creating an interview', async () => {
    const c = candidate();
    const db = database(c);
    vi.spyOn(primehireClient, 'rescheduleInterview').mockRejectedValue(new Error('Invalid Interview ID or Interview not found'));
    const create = vi.spyOn(primehireClient, 'createInterview');
    await expect(updateInterviewSchedule(c.id, [c], startTime, endTime)).rejects.toBeInstanceOf(InterviewUnavailableError);
    expect(db.fetch).toHaveBeenCalledOnce();
    expect(create).not.toHaveBeenCalled();
  });

  test('an error envelope in a successful HTTP response does not become a successful reschedule', async () => {
    const c = candidate(); const db = database(c);
    vi.spyOn(primehireClient, 'rescheduleInterview').mockResolvedValue({ status: 'ERROR', message: 'Invalid Interview ID or Interview not found' });
    await expect(updateInterviewSchedule(c.id, [c], startTime, endTime)).rejects.toBeInstanceOf(InterviewUnavailableError);
    expect(db.fetch).toHaveBeenCalledOnce();
    expect(db.stored().startTime).toBe(c.startTime);
  });

  test('a provider change followed by a failed portal save is explicitly reported as unpersisted', async () => {
    const c = candidate();
    const db = database(c, true);
    vi.spyOn(primehireClient, 'rescheduleInterview').mockResolvedValue({ status: 'SUCCESS' });
    const result = await updateInterviewSchedule(c.id, [c], startTime, endTime);
    expect(result.outcome).toBe('rescheduled');
    expect(result.persisted).toBe(false);
    expect(result.candidate.startTime).toBe(startTime);
    expect(db.stored().startTime).toBe(c.startTime);
  });

  test('failure to save an unscheduled candidate does not return a false saved result', async () => {
    const c = { ...candidate(), interviewId: null, link: null, password: null };
    const db = database(c, true);
    const provider = vi.spyOn(primehireClient, 'rescheduleInterview');
    await expect(updateInterviewSchedule(c.id, [c], startTime, endTime)).rejects.toThrow('Candidate save unavailable');
    expect(db.stored().startTime).toBe(c.startTime);
    expect(provider).not.toHaveBeenCalled();
  });

  test('authentication failures do not offer missing-interview recovery', async () => {
    const c = candidate(); database(c);
    vi.spyOn(primehireClient, 'rescheduleInterview').mockRejectedValue(new Error('PrimeHire authentication failed'));
    await expect(updateInterviewSchedule(c.id, [c], startTime, endTime)).rejects.not.toBeInstanceOf(InterviewUnavailableError);
  });

  test.each(['int-test', 'INT-test', 'CAND-stable', 'JOB-existing', 'res-test', 'https://example.com/user/login'])('invalid interview identifier %s is rejected before any request', async id => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(primehireClient.rescheduleInterview(asInterviewId(id), startTime, endTime)).rejects.toThrow('valid provider interview ID');
    expect(fetch).not.toHaveBeenCalled();
  });

  test('a stale browser cannot reschedule a candidate that was deactivated on the server', async () => {
    const c = candidate(); database({ ...c, status: 'INACTIVE' });
    const provider = vi.spyOn(primehireClient, 'rescheduleInterview');
    await expect(updateInterviewSchedule(c.id, [c], startTime, endTime)).rejects.toThrow('inactive candidate');
    expect(provider).not.toHaveBeenCalled();
  });
});

describe('replacement linkage remains reschedulable', () => {
  function createReplacement() {
    return vi.spyOn(primehireClient, 'createInterview').mockImplementation(async (_job, _round, candidates) => ({
      status: 'SUCCESS', data: { interviews: [{
        candidateId: candidates[0].candidate_id, id: 'provider-replacement',
        url: 'https://elitehr.nxtagent.ai/auth/login/user/replacement', password: 'replacement-password',
      }] },
    }));
  }

  test('regenerating credentials preserves the local key and writes the replacement interview to the existing candidate row', async () => {
    const c = candidate(); const db = database(c); const create = createReplacement();
    const updated = await regenerateInterviewLink(c.id, [c], 'TECHNICAL', asJobId(c.assessmentId));
    expect(create.mock.calls[0][2][0].candidate_id).not.toBe(c.id);
    expect(updated[0].id).toBe(c.id);
    expect(updated[0].mongoId).toBe(c.mongoId);
    expect(await syncCandidateToServer(updated[0])).toBe('ok');
    expect(db.fetch.mock.calls[0][0]).toContain(`/api/candidates/${c.id}`);
    expect((await fetchCandidate(c.id)).interviewId).toBe('provider-replacement');
  });

  test('explicit missing-interview recovery uses the selected window, saves the new linkage, and reschedules that linkage after reload', async () => {
    const c = candidate(); const db = database(c); const create = createReplacement();
    const assessmentCreate = vi.spyOn(primehireClient, 'createAssessment');
    const result = await updateInterviewSchedule(c.id, [c], startTime, endTime, { roundType: 'TECHNICAL', jobId: asJobId(c.assessmentId) });
    expect(result.outcome).toBe('new_interview');
    expect(result.persisted).toBe(true);
    expect(result.candidate.id).toBe(c.id);
    expect(result.candidate.password).toBe('replacement-password');
    expect(create.mock.calls[0][2][0]).toMatchObject({ start_time: startTime, end_time: endTime });
    expect(db.stored().primehire.interviewId).toBe('provider-replacement');
    const reloaded = await fetchCandidate(c.id);
    const reschedule = vi.spyOn(primehireClient, 'rescheduleInterview').mockResolvedValue({ status: 'SUCCESS' });
    await updateInterviewSchedule(c.id, [reloaded], '2026-10-24T12:00:00Z', '2026-10-25T12:00:00Z');
    expect(reschedule).toHaveBeenCalledWith('provider-replacement', '2026-10-24T12:00:00Z', '2026-10-25T12:00:00Z');
    expect(assessmentCreate).not.toHaveBeenCalled();
  });
});
