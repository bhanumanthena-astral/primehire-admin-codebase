import { afterEach, describe, expect, test, vi } from 'vitest';
import { primehireClient } from '../lib/primehireClient';
import { asInterviewId, asJobId, asLocalCandidateId } from '../lib/primehireIds';
import { istDateTimeToUtc, istDatetimeLocalToUtc, utcToIstDatetimeLocal } from '../utils/istSchedule';
import { renderTemplate, mockGenerateLink } from '../mockData';
import type { Candidate, AssessmentProfile } from '../types';

afterEach(() => vi.unstubAllGlobals());

describe('IST schedule through the actual API client', () => {
  test('invitation times include IST and do not depend on the sender timezone', () => {
    const result = renderTemplate({ id: 'test', name: 'test', type: 'STANDARD_INVITATION', subject: 'Interview', body: '{{start_time}} to {{end_time}}' }, {
      startTime: '2026-10-08T11:35:00.000Z', endTime: '2026-10-08T14:32:00.000Z',
    } as Candidate, {} as AssessmentProfile);
    expect(result.body).toBe('08/10/2026 — 05:05 PM IST to 08/10/2026 — 08:02 PM IST');
  });
  function captureRequest() {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'SUCCESS' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  test('a window longer than 24 hours reaches POST /interview with the documented UTC offsets', async () => {
    const fetchMock = captureRequest();
    await primehireClient.createInterview(asJobId('JOB-test'), 'BASIC', [{
      candidate_id: asLocalCandidateId('CAND-test'),
      start_time: istDateTimeToUtc('08/10/2026', '05:05 PM')!,
      end_time: istDateTimeToUtc('09/10/2026', '08:02 PM')!,
    }]);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/backend/interview');
    expect(JSON.parse(options.body)).toEqual({
      job_id: 'JOB-test', round_type: 'BASIC', candidates: [{
        candidate_id: 'CAND-test',
        start_time: '2026-10-08T11:35:00.000+00:00',
        end_time: '2026-10-09T14:32:00.000+00:00',
      }],
    });
  });

  test('reschedule roundtrips through IST picker and PUT without browser timezone conversion', async () => {
    const fetchMock = captureRequest();
    const startInput = utcToIstDatetimeLocal('2026-10-08T11:35:00.000Z');
    const endInput = utcToIstDatetimeLocal('2026-10-09T14:32:00.000Z');
    expect(startInput).toBe('2026-10-08T17:05');
    expect(endInput).toBe('2026-10-09T20:02');
    await primehireClient.rescheduleInterview(asInterviewId('interview-test'), istDatetimeLocalToUtc(startInput)!, istDatetimeLocalToUtc(endInput)!);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/backend/interview/interview-test/reschedule');
    expect(JSON.parse(options.body)).toEqual({
      start_time: '2026-10-08T11:35:00.000+00:00',
      end_time: '2026-10-09T14:32:00.000+00:00',
    });
  });

  test('explicit IST offsets are normalized without shifting the instant twice', async () => {
    const fetchMock = captureRequest();
    await primehireClient.rescheduleInterview(asInterviewId('interview-test'), '2026-10-08T17:05:00+05:30', '2026-10-09T20:02:00+05:30');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).end_time).toBe('2026-10-09T14:32:00.000+00:00');
  });

  test('short windows cannot create, reschedule, or fall back to simulated links', async () => {
    const fetchMock = captureRequest();
    const candidate = { id: asLocalCandidateId('CAND-test'), startTime: '2026-10-08T11:35:00Z', endTime: '2026-10-08T14:32:00Z' } as Candidate;
    await expect(primehireClient.createInterview(asJobId('JOB-test'), 'BASIC', [{ candidate_id: candidate.id, start_time: candidate.startTime, end_time: candidate.endTime }])).rejects.toThrow('24-hour');
    await expect(primehireClient.rescheduleInterview(asInterviewId('interview-test'), candidate.startTime, candidate.endTime)).rejects.toThrow('24-hour');
    await expect(mockGenerateLink([candidate.id], [candidate], 'BASIC', asJobId('JOB-test'))).rejects.toThrow('24-hour');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('a mixed bulk request is blocked before any candidate is scheduled', async () => {
    const fetchMock = captureRequest();
    await expect(primehireClient.createInterview(asJobId('JOB-test'), 'BASIC', [
      { candidate_id: asLocalCandidateId('CAND-valid'), start_time: '2026-10-08T12:05:00Z', end_time: '2026-10-09T12:05:00Z' },
      { candidate_id: asLocalCandidateId('CAND-short'), start_time: '2026-10-08T12:05:00Z', end_time: '2026-10-09T06:30:00Z' },
    ])).rejects.toThrow('24-hour');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('invalid times do not reach the API', async () => {
    const fetchMock = captureRequest();
    await expect(primehireClient.rescheduleInterview(asInterviewId('interview-test'), 'invalid', '')).rejects.toThrow('Invalid interview timestamp');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(istDatetimeLocalToUtc('2026-02-31T17:05')).toBeNull();
    expect(istDatetimeLocalToUtc('2026-10-08T25:05')).toBeNull();
  });
});
