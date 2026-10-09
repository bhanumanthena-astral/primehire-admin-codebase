import { describe, expect, test } from 'vitest';
import { hasMinimumInterviewWindow, requireMinimumInterviewWindow, MIN_INTERVIEW_WINDOW_MESSAGE } from '../utils/interviewSchedulePolicy';

describe('temporary minimum 24-hour interview window', () => {
  const start = '2026-10-08T17:35:00+05:30';

  test('accepts exactly 24 hours and longer', () => {
    expect(hasMinimumInterviewWindow(start, '2026-10-09T17:35:00+05:30')).toBe(true);
    expect(hasMinimumInterviewWindow(start, '2026-10-10T17:35:00+05:30')).toBe(true);
  });

  test('rejects same-day, overnight under 24 hours, and one millisecond too short', () => {
    for (const end of ['2026-10-08T20:02:00+05:30', '2026-10-09T12:00:00+05:30', '2026-10-09T17:34:59.999+05:30']) {
      expect(hasMinimumInterviewWindow(start, end)).toBe(false);
      expect(() => requireMinimumInterviewWindow(start, end)).toThrow(MIN_INTERVIEW_WINDOW_MESSAGE);
    }
  });

  test('measures elapsed time across different offsets rather than calendar labels', () => {
    expect(hasMinimumInterviewWindow(start, '2026-10-09T12:05:00Z')).toBe(true);
    expect(hasMinimumInterviewWindow(start, '2026-10-09T12:04:00Z')).toBe(false);
  });

  test('missing, malformed, equal, and reversed times are blocked', () => {
    for (const [s, e] of [['', start], ['bad', start], [start, ''], [start, start], [start, '2026-10-07T17:35:00+05:30']]) {
      expect(hasMinimumInterviewWindow(s, e)).toBe(false);
    }
  });
});
