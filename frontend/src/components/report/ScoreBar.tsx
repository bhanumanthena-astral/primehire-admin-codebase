import type React from 'react';
import { motion } from 'motion/react';
import { getGrade } from '../../utils/normalizeReport';
import { formatScore } from '../../utils/reportMetrics';

/** Compact labeled 0–100 bar. Null renders a "not evaluated" track (never 0). */
export default function ScoreBar({
  label,
  value,
  right,
  delay = 0,
  compact = false,
}: {
  key?: React.Key;
  label: string;
  value: number | null | undefined;
  right?: string;
  delay?: number;
  compact?: boolean;
}) {
  const grade = getGrade(value ?? undefined);
  const hasValue = value !== null && value !== undefined;

  return (
    <div role="img" aria-label={`${label}: ${formatScore(value)} out of 100`}>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <span className={`min-w-0 flex-1 truncate font-medium text-foreground ${compact ? 'text-xs' : 'text-sm'}`}>
          {label}
        </span>
        <div className="flex shrink-0 items-center gap-1.5 text-right tnum">
          {hasValue ? (
            <>
              <span className={`font-bold text-foreground ${compact ? 'text-xs' : 'text-sm'}`}>
                {Math.round(value as number)}%
              </span>
              {right && (
                <span className="rounded bg-muted px-1.5 py-0.5 text-[0.6875rem] font-medium text-muted-foreground">
                  {right}
                </span>
              )}
            </>
          ) : (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[0.6875rem] font-medium text-muted-foreground">
              {right || 'N/A'}
            </span>
          )}
        </div>
      </div>
      <div className={`overflow-hidden rounded-full bg-muted ${compact ? 'h-1.5' : 'h-2'}`}>
        {hasValue && (
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${Math.max(0, Math.min(100, value as number))}%` }}
            transition={{ delay, duration: 0.5, ease: 'easeOut' }}
            className="h-full rounded-full"
            style={{ background: grade.color }}
          />
        )}
      </div>
    </div>
  );
}
