/**
 * IST date+time pickers for candidate bulk-upload scheduling.
 * Each instant uses a date field and the shared time picker.
 * Values are stored as IST wall time
 * (DD/MM/YYYY + hh:mm AM/PM parts); conversion to UTC happens once at
 * confirm time.
 */
import React from 'react';
import { Calendar } from 'lucide-react';
import DateTimeInput from './ui/DateTimeInput';
import { istPartsToDatetimeLocal, datetimeLocalToIstParts, istDateTimeToUtc } from '../utils/istSchedule';
import { hasMinimumInterviewWindow, INTERVIEW_WINDOW_NOTICE, MIN_INTERVIEW_WINDOW_MESSAGE } from '../utils/interviewSchedulePolicy';

interface DateTimeFieldProps {
  label: string;
  date: string; // DD/MM/YYYY or ''
  time: string; // hh:mm AM/PM or ''
  onChange: (date: string, time: string) => void;
  invalid?: boolean;
  testId?: string;
}

/**
 * Shared date and time picker, matching assessment creation. Values stay in the
 * row's DD/MM/YYYY + hh:mm AM/PM IST parts; UTC conversion still
 * happens once at confirm time.
 */
export function ScheduleDateTimeField({ label, date, time, onChange, invalid, testId }: DateTimeFieldProps) {
  const value = istPartsToDatetimeLocal(date, time);
  return (
    <div className="space-y-1 min-w-0">
      <label className="flex items-center gap-1 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
        <Calendar className="w-3 h-3" aria-hidden /> {label} <span className="text-[8px] font-bold text-sky-700 bg-sky-50 border border-sky-200 rounded px-1">IST</span>
      </label>
      <DateTimeInput
        label={label}
        testId={testId}
        value={value}
        onChange={(next) => {
          const parts = datetimeLocalToIstParts(next);
          if (parts) onChange(parts.date, parts.time);
          else onChange('', '');
        }}
        invalid={invalid}
      />
      <div className="text-[10px] font-mono text-muted-foreground" aria-live="polite">
        {date && time ? `${date} — ${time} IST` : '—'}
      </div>
    </div>
  );
}

export interface SchedulePair {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
}

/**
 * Combined start/end IST pickers used in the bulk modal.
 */
export function SchedulePairFields({
  value,
  onChange,
  invalidStart,
  invalidEnd,
}: {
  value: SchedulePair;
  onChange: (next: SchedulePair) => void;
  invalidStart?: boolean;
  invalidEnd?: boolean;
  compact?: boolean;
}) {
  const startUtc = istDateTimeToUtc(value.startDate, value.startTime);
  const endUtc = istDateTimeToUtc(value.endDate, value.endTime);
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-semibold text-amber-700">{INTERVIEW_WINDOW_NOTICE}</p>
      <div className="rounded-lg border border-border/60 bg-muted/40/40 p-2 space-y-2">
        <div className="text-[9px] font-bold uppercase tracking-wider text-sky-700">Start (IST)</div>
        <ScheduleDateTimeField label="Start" date={value.startDate} time={value.startTime} onChange={(d, t) => onChange({ ...value, startDate: d, startTime: t })} invalid={invalidStart} />
      </div>
      <div className="rounded-lg border border-border/60 bg-muted/40/40 p-2 space-y-2">
        <div className="text-[9px] font-bold uppercase tracking-wider text-sky-700">End (IST)</div>
        <ScheduleDateTimeField label="End" date={value.endDate} time={value.endTime} onChange={(d, t) => onChange({ ...value, endDate: d, endTime: t })} invalid={invalidEnd} />
      </div>
      {startUtc && endUtc && !hasMinimumInterviewWindow(startUtc, endUtc) && (
        <p role="alert" className="text-[10px] font-semibold text-destructive">{MIN_INTERVIEW_WINDOW_MESSAGE}</p>
      )}
    </div>
  );
}
