import { parseServerDate } from './dates';

// Temporary frontend workaround until the provider's expiry handling is fixed.
export const MIN_INTERVIEW_WINDOW_MS = 24 * 60 * 60 * 1000;
export const MIN_INTERVIEW_WINDOW_MESSAGE = 'A minimum 24-hour interview window is mandatory. Select an end date and time at least 24 hours after the start.';
export const INTERVIEW_WINDOW_NOTICE = 'Temporary scheduling requirement: a minimum 24-hour interview window is mandatory. The end must be at least 24 hours after the start.';

export function hasMinimumInterviewWindow(startTime: string, endTime: string): boolean {
  const start = parseServerDate(startTime);
  const end = parseServerDate(endTime);
  return !!start && !!end && end.getTime() - start.getTime() >= MIN_INTERVIEW_WINDOW_MS;
}

export function requireMinimumInterviewWindow(startTime: string, endTime: string): void {
  if (!hasMinimumInterviewWindow(startTime, endTime)) throw new Error(MIN_INTERVIEW_WINDOW_MESSAGE);
}
