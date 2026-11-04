import { describe, it, expect } from 'vitest';
import { jobLocalInput, jobUtcInput, setJobTimezone, jobDateBoundary } from './jobTimezone';
describe('organization date inputs', () => {
  it('uses IST independently of browser timezone and round trips', () => {
    setJobTimezone('Asia/Kolkata');
    expect(jobLocalInput('2026-10-13T09:00:00Z')).toBe('2026-10-13T14:30');
    expect(jobUtcInput('2026-10-13T14:30')).toBe('2026-10-13T09:00:00.000Z');
  });
  it('filters the whole organization-local date', () => {
    setJobTimezone('Asia/Kolkata');
    expect(jobDateBoundary('2026-10-13')).toBe('2026-10-12T18:30:00.000Z');
    expect(jobDateBoundary('2026-10-13',true)).toBe('2026-10-13T18:29:59.999Z');
  });
});
