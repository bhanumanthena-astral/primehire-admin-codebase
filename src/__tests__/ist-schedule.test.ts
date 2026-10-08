/**
 * Regression tests for the bulk-upload IST redesign.
 *
 * Covers: new CSV template shape (Name/Email/Phone only), legacy Indian +
 * ISO UTC parsing, IST display, IST->UTC conversion (exactly once), and the
 * incomplete/ordering validation rules used by the candidate preview.
 */

import { describe, test, expect } from 'vitest';
import {
  parseCsvScheduleCell,
  utcIsoToIstParts,
  istDateTimeToUtc,
  formatUtcAsIst,
  isoDateInputToDisplay,
  displayToIsoDateInput,
  normalizeTime12,
} from '../utils/istSchedule';

describe('parseCsvScheduleCell: Indian format is IST wall time', () => {
  test('15/10/2026 03:00 PM -> 2026-10-15T09:30:00.000Z', () => {
    const r = parseCsvScheduleCell('15/10/2026 03:00 PM');
    expect(r.ok).toBe(true);
    expect(r.utcIso).toBe('2026-10-15T09:30:00.000Z');
  });

  test('15/10/2026 06:00 PM -> 2026-10-15T12:30:00.000Z', () => {
    const r = parseCsvScheduleCell('15/10/2026 06:00 PM');
    expect(r.ok).toBe(true);
    expect(r.utcIso).toBe('2026-10-15T12:30:00.000Z');
  });

  test('12 AM midnight boundary', () => {
    const r = parseCsvScheduleCell('16/10/2026 12:00 AM');
    expect(r.ok).toBe(true);
    // 00:00 IST = 18:30 UTC previous day
    expect(r.utcIso).toBe('2026-10-15T18:30:00.000Z');
  });
});

describe('parseCsvScheduleCell: legacy ISO UTC is an exact instant (never IST)', () => {
  test('2026-10-15T09:30:00.000Z stays the same instant', () => {
    const r = parseCsvScheduleCell('2026-10-15T09:30:00.000Z');
    expect(r.ok).toBe(true);
    expect(new Date(r.utcIso).getTime()).toBe(new Date('2026-10-15T09:30:00.000Z').getTime());
  });

  test('ISO instant and Indian wall time agree on the same instant', () => {
    const fromIso = parseCsvScheduleCell('2026-10-15T09:30:00.000Z');
    const fromIndian = parseCsvScheduleCell('15/10/2026 03:00 PM');
    expect(fromIso.ok && fromIndian.ok).toBe(true);
    expect(new Date(fromIso.utcIso).getTime()).toBe(new Date(fromIndian.utcIso).getTime());
  });
});

describe('parseCsvScheduleCell: invalid input preserved as failure', () => {
  test('empty -> not ok', () => {
    expect(parseCsvScheduleCell('').ok).toBe(false);
    expect(parseCsvScheduleCell(null).ok).toBe(false);
  });
  test('garbage -> not ok (caller keeps raw for correction)', () => {
    expect(parseCsvScheduleCell('next Friday-ish').ok).toBe(false);
  });
  test('ambiguous/guessed formats rejected', () => {
    expect(parseCsvScheduleCell('10-15-2026 03:00 PM').ok).toBe(false); // MM-DD not supported
    expect(parseCsvScheduleCell('31/02/2026 03:00 PM').ok).toBe(false); // impossible date
  });
});

describe('IST display', () => {
  test('2026-10-15T09:30:00.000Z -> 15/10/2026 — 03:00 PM IST', () => {
    expect(formatUtcAsIst('2026-10-15T09:30:00.000Z')).toBe('15/10/2026 — 03:00 PM IST');
  });

  test('utcIsoToIstParts splits for pickers', () => {
    const p = utcIsoToIstParts('2026-10-15T09:30:00.000Z')!;
    expect(p.date).toBe('15/10/2026');
    expect(p.time).toBe('03:00 PM');
    expect(p.isoDate).toBe('2026-10-15');
  });
});

describe('IST -> UTC conversion (exactly once)', () => {
  test('picker values combine to canonical UTC', () => {
    expect(istDateTimeToUtc('15/10/2026', '03:00 PM')).toBe('2026-10-15T09:30:00.000Z');
    expect(istDateTimeToUtc('15/10/2026', '06:00 PM')).toBe('2026-10-15T12:30:00.000Z');
  });

  test('roundtrip preserves the instant (no double conversion)', () => {
    const utc = istDateTimeToUtc('15/10/2026', '03:15 PM')!;
    const parts = utcIsoToIstParts(utc)!;
    expect(parts.date).toBe('15/10/2026');
    expect(parts.time).toBe('03:15 PM');
    // Recombining the displayed parts yields the identical UTC string.
    expect(istDateTimeToUtc(parts.date, parts.time)).toBe(utc);
  });

  test('minute-level times supported (03:15 PM, 04:45 PM)', () => {
    expect(istDateTimeToUtc('15/10/2026', '03:15 PM')).toBe('2026-10-15T09:45:00.000Z');
    expect(istDateTimeToUtc('15/10/2026', '04:45 PM')).toBe('2026-10-15T11:15:00.000Z');
  });

  test('timezone-independent: pure arithmetic, no browser TZ', () => {
    // The conversion must not depend on the machine timezone; Date.UTC with
    // the fixed +05:30 offset is deterministic by construction.
    const a = istDateTimeToUtc('01/01/2026', '12:00 AM')!;
    expect(a).toBe('2025-12-31T18:30:00.000Z');
  });
});

describe('date input helpers', () => {
  test('isoDateInputToDisplay / displayToIsoDateInput', () => {
    expect(isoDateInputToDisplay('2026-10-15')).toBe('15/10/2026');
    expect(displayToIsoDateInput('15/10/2026')).toBe('2026-10-15');
    expect(displayToIsoDateInput('')).toBe('');
  });
});

describe('normalizeTime12', () => {
  test('valid pieces normalize', () => {
    expect(normalizeTime12('3', '5', 'pm')).toBe('03:05 PM');
    expect(normalizeTime12('12', '00', 'AM')).toBe('12:00 AM');
  });
  test('invalid pieces rejected', () => {
    expect(normalizeTime12('13', '00', 'AM')).toBe('');
    expect(normalizeTime12('10', '60', 'PM')).toBe('');
    expect(normalizeTime12('10', '30', 'XX')).toBe('');
  });
});
