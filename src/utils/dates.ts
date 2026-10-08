/**
 * Server-date helpers (QA #12).
 *
 * The backend used to return naive datetimes (`2026-10-07T12:39:05.464000`,
 * no suffix) which browsers parse as LOCAL time — a +5:30 shift in IST.
 * The backend now always returns TZ-aware UTC (`+00:00`), but rows stored
 * before the fix are still naive. Treat any suffix-less string as UTC.
 */

/** True when the string already carries a timezone (Z or ±hh:mm / ±hhmm). */
export function hasTimezoneSuffix(v: string): boolean {
  const s = v.trim();
  return /[Zz]$/.test(s) || /[+-]\d{2}:?\d{2}$/.test(s);
}

/**
 * Normalize a server datetime string to an unambiguous UTC ISO string.
 * Suffix-less input is assumed UTC and gets a `Z` appended.
 * Non-strings / empty pass through untouched.
 */
export function asUtcIso<T>(v: T): T {
  if (typeof v !== 'string') return v;
  const s = v.trim();
  if (!s) return v;
  if (hasTimezoneSuffix(s)) return v;
  // Space-separated datetimes (`2026-10-07 12:39:05`) are also treated as UTC.
  return (`${s}Z` as unknown) as T;
}

/** Parse a server datetime defensively (naive => UTC). Null on unparseable. */
export function parseServerDate(v: string | null | undefined): Date | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  const d = new Date(hasTimezoneSuffix(s) ? s : `${s}Z`);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Minimum buffer required between now and startTime when generating a link.
 * PrimeHire rejects windows that have already started. A 1-minute buffer
 * accounts for request latency without masking genuinely stale windows.
 */
export const MIN_GENERATE_BUFFER_MS = 60_000; // 1 minute

/**
 * Minimum buffer required between now and new startTime when rescheduling.
 * Gives the operator a safe operational margin.
 */
export const MIN_RESCHEDULE_BUFFER_MS = 5 * 60_000; // 5 minutes

/**
 * @deprecated Use MIN_GENERATE_BUFFER_MS or MIN_RESCHEDULE_BUFFER_MS instead.
 * Retained for backward compatibility with upload validation warnings.
 */
export const SCHEDULE_GRACE_MS = 5 * 60 * 1000;

/** Human-readable UTC instant for error messages (`2026-10-07 12:39 UTC`). */
export function formatUtcInstant(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
  );
}

/**
 * Human-readable LOCAL instant for operator-facing messages.
 * E.g. "07 Oct 2026, 6:36 PM IST"
 *
 * Uses the browser's `Intl.DateTimeFormat` so it adapts to the operator's
 * locale/timezone without manual offset math.
 */
export function formatLocalInstant(d: Date): string {
  return d.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  });
}

/**
 * Compact interview window display for the candidate detail panel.
 * Same-day:  "07 Oct 2026, 6:36 PM – 9:00 PM IST"
 * Different: "07 Oct 2026, 6:36 PM IST – 08 Oct 2026, 9:00 PM IST"
 */
export function formatInterviewWindow(start: Date, end: Date): string {
  const sameDay =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate();

  if (sameDay) {
    const datePart = start.toLocaleDateString(undefined, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
    const startTime = start.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    const endTime = end.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZoneName: 'short',
    });
    return `${datePart}, ${startTime} – ${endTime}`;
  }

  return `${formatLocalInstant(start)} – ${formatLocalInstant(end)}`;
}

/**
 * Convert an ISO string to a `datetime-local` input value using browser-local
 * getters (getFullYear, getMonth, etc.) — NOT manual offset math.
 * Returns '' on invalid/missing input.
 */
export function formatToDatetimeLocal(isoStr?: string | null): string {
  if (!isoStr) return '';
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return '';
    const pad = (num: number) => num.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return '';
  }
}
