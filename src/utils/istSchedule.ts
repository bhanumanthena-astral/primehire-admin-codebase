/**
 * IST scheduling helpers for the candidate bulk-upload redesign.
 *
 * All user-facing scheduling is Asia/Kolkata (IST, UTC+05:30).
 * The backend contract stays canonical UTC ISO 8601.
 * Conversion IST -> UTC happens exactly once at confirm time.
 *
 * No browser-timezone dependence: IST wall-clock math is done with
 * Date.UTC + the fixed +05:30 offset, so results are identical in any TZ.
 */

export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
export const IST_LABEL = 'IST';

const ISO_8601_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;

// Indian format: 15/10/2026 03:00 PM  (also accepts 15-10-2026, single-digit d/m/h)
const INDIAN_RE =
  /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})\s+(\d{1,2}):(\d{2})(?:\s*([AaPp][Mm]))?$/;

export interface ParsedCsvInstant {
  ok: boolean;
  /** Canonical UTC ISO string when ok. */
  utcIso: string;
}

function toUtcIsoString(d: Date): string {
  return d.toISOString();
}

/**
 * Parse one CSV scheduling cell.
 * - ISO 8601 (incl. legacy `...Z` UTC): interpreted as an exact instant
 *   (NEVER as IST wall time).
 * - Indian `DD/MM/YYYY hh:mm AM/PM`: interpreted as IST wall time.
 * Returns { ok:false } for empty/invalid input (caller preserves raw value).
 */
export function parseCsvScheduleCell(raw: string | null | undefined): ParsedCsvInstant {
  const s = (raw ?? '').trim();
  if (!s) return { ok: false, utcIso: '' };
  if (ISO_8601_RE.test(s)) {
    const ms = s.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(s)
      ? Date.parse(s)
      : Date.parse(`${s}Z`); // naive -> UTC (matches parseServerDate policy)
    if (isNaN(ms)) return { ok: false, utcIso: '' };
    return { ok: true, utcIso: new Date(ms).toISOString() };
  }
  const m = INDIAN_RE.exec(s);
  if (m) {
    const dd = Number(m[1]);
    const mm = Number(m[2]);
    const yyyy = Number(m[3]);
    let hh = Number(m[4]);
    const min = Number(m[5]);
    const ampm = (m[6] || '').toUpperCase();
    if (ampm === 'PM' && hh < 12) hh += 12;
    if (ampm === 'AM' && hh === 12) hh = 0;
    if (ampm && (hh < 0 || hh > 23 || min < 0 || min > 59)) return { ok: false, utcIso: '' };
    if (!ampm && (hh < 0 || hh > 23 || min < 0 || min > 59)) return { ok: false, utcIso: '' };
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return { ok: false, utcIso: '' };
    // Validate real calendar date (e.g. reject 31/02).
    const probe = new Date(Date.UTC(yyyy, mm - 1, dd));
    if (
      probe.getUTCFullYear() !== yyyy ||
      probe.getUTCMonth() !== mm - 1 ||
      probe.getUTCDate() !== dd
    ) {
      return { ok: false, utcIso: '' };
    }
    const utcMs = Date.UTC(yyyy, mm - 1, dd, hh, min, 0, 0) - IST_OFFSET_MS;
    return { ok: true, utcIso: toUtcIsoString(new Date(utcMs)) };
  }
  return { ok: false, utcIso: '' };
}

export interface IstParts {
  /** DD/MM/YYYY */
  date: string;
  /** hh:mm AM/PM (12-hour) */
  time: string;
  /** YYYY-MM-DD for native date inputs */
  isoDate: string;
  hour12: string;
  minute: string;
  ampm: 'AM' | 'PM';
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Split a canonical UTC ISO instant into IST date/time picker parts. */
export function utcIsoToIstParts(utcIso: string): IstParts | null {
  const ms = Date.parse(utcIso);
  if (isNaN(ms)) return null;
  const ist = new Date(ms + IST_OFFSET_MS);
  const dd = ist.getUTCDate();
  const mm = ist.getUTCMonth() + 1;
  const yyyy = ist.getUTCFullYear();
  const h24 = ist.getUTCHours();
  const min = ist.getUTCMinutes();
  const ampm: 'AM' | 'PM' = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const hour12 = pad2(h12);
  const minute = pad2(min);
  const time = `${hour12}:${minute} ${ampm}`;
  return {
    date: `${pad2(dd)}/${pad2(mm)}/${yyyy}`,
    time,
    isoDate: `${yyyy}-${pad2(mm)}-${pad2(dd)}`,
    hour12,
    minute,
    ampm,
  };
}

/**
 * Combine IST picker values into a canonical UTC ISO string (exactly once).
 * date: DD/MM/YYYY, time: hh:mm AM/PM.
 */
export function istDateTimeToUtc(dateStr: string, timeStr: string): string | null {
  const d = dateStr.trim();
  const t = timeStr.trim();
  if (!d || !t) return null;
  const parsed = parseCsvScheduleCell(`${d} ${t}`);
  if (!parsed.ok) return null;
  return parsed.utcIso;
}

/** DD/MM/YYYY + hh:mm AM/PM (IST) -> `YYYY-MM-DDTHH:mm` for datetime-local. */
export function istPartsToDatetimeLocal(dateStr: string, timeStr: string): string {
  const iso = displayToIsoDateInput(dateStr);
  const m = /^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/.exec(timeStr.trim());
  if (!iso || !m) return '';
  let h = Number(m[1]) % 12;
  if (m[3].toUpperCase() === 'PM') h += 12;
  return `${iso}T${pad2(h)}:${m[2]}`;
}

/** `YYYY-MM-DDTHH:mm` (datetime-local, IST wall time) -> date/time parts. */
export function datetimeLocalToIstParts(local: string): { date: string; time: string } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local.trim());
  if (!m) return null;
  const h24 = Number(m[4]);
  if (h24 > 23 || Number(m[5]) > 59) return null;
  const ampm: 'AM' | 'PM' = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return { date: `${m[3]}/${m[2]}/${m[1]}`, time: `${pad2(h12)}:${m[5]} ${ampm}` };
}

/** Native date-input value (YYYY-MM-DD) -> DD/MM/YYYY. */
export function isoDateInputToDisplay(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!m) return '';
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** DD/MM/YYYY -> native date-input value (YYYY-MM-DD). */
export function displayToIsoDateInput(display: string): string {
  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(display.trim());
  if (!m) return '';
  return `${m[3]}-${pad2(Number(m[2]))}-${pad2(Number(m[1]))}`;
}

/** Canonical UTC -> "15/10/2026 — 03:00 PM IST" for display. */
export function formatUtcAsIst(utcIso: string): string {
  const parts = utcIsoToIstParts(utcIso);
  if (!parts) return '';
  return `${parts.date} — ${parts.time} ${IST_LABEL}`;
}

/** Normalize 12h time pieces to "hh:mm AM/PM". Returns '' on invalid. */
export function normalizeTime12(hour12: string, minute: string, ampm: string): string {
  const h = Number(hour12);
  const mi = Number(minute);
  const ap = ampm.toUpperCase();
  if (!Number.isInteger(h) || h < 1 || h > 12) return '';
  if (!Number.isInteger(mi) || mi < 0 || mi > 59) return '';
  if (ap !== 'AM' && ap !== 'PM') return '';
  return `${pad2(h)}:${pad2(mi)} ${ap}`;
}
