import { describe, expect, test } from 'vitest';
import { interviewWindowState } from '../utils/dates';

describe('existing interview availability', () => {
  const start = '2026-10-08T16:50:00.000+05:30';
  const end = '2026-10-08T17:00:00.000+05:30';
  const at = (time: string) => Date.parse(`2026-10-08T${time}+05:30`);

  test('the reported 4:50–5:00 PM IST window is open at 4:55 PM', () => {
    expect(interviewWindowState(start, end, at('16:55:00'))).toBe('open');
  });
  test('opens at the start and expires at the completion deadline', () => {
    expect(interviewWindowState(start, end, at('16:49:59'))).toBe('scheduled');
    expect(interviewWindowState(start, end, at('16:50:00'))).toBe('open');
    expect(interviewWindowState(start, end, at('16:59:59'))).toBe('open');
    expect(interviewWindowState(start, end, at('17:00:00'))).toBe('expired');
  });
  test('UTC and IST timestamps represent the same window', () => {
    expect(interviewWindowState('2026-10-08T11:20:00.000Z', '2026-10-08T11:30:00.000Z', at('16:55:00'))).toBe('open');
    expect(interviewWindowState('2026-10-08T11:20:00', '2026-10-08T11:30:00', at('16:55:00'))).toBe('open');
  });
  test('rejects missing, malformed, equal, or reversed windows', () => {
    for (const [s, e] of [['', end], ['bad', end], [start, start], [end, start]]) {
      expect(interviewWindowState(s, e, at('16:55:00'))).toBe('invalid');
    }
  });
});
