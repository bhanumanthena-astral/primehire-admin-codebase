import type React from 'react';
import { motion } from 'motion/react';
import { CheckCircle2, Clock, Video } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Coverage } from '../../utils/reportMetrics';

/** Evaluation coverage dashboard — counts only, no invented scores. */
export default function EvaluationCoverage({
  title,
  coverage,
  delay = 0,
}: {
  title: string;
  coverage: Coverage;
  delay?: number;
}) {
  const complete = coverage.total > 0 && coverage.pending === 0;
  const noneEvaluated = coverage.evaluated === 0;
  const cells: Array<{ label: string; value: string; icon?: ReactNode }> = [
    { label: 'Total questions', value: String(coverage.total) },
    ...(coverage.attempted !== null
      ? [{ label: 'Attempted', value: String(coverage.attempted) }]
      : []),
    { label: 'Evaluated', value: String(coverage.evaluated) },
    { label: 'Pending / unavailable', value: String(coverage.pending) },
    {
      label: 'Recordings available',
      value: String(coverage.recordings),
      icon: <Video size={13} className="text-muted-foreground" />,
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.3 }}
      className="rounded-2xl border border-border bg-card p-5 shadow-sm"
    >
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.6875rem] font-semibold ${
            complete
              ? 'bg-[var(--success-soft)] text-success'
              : noneEvaluated
                ? 'bg-[var(--warning-soft)] text-warning'
                : 'bg-[var(--warning-soft)] text-warning'
          }`}
        >
          {complete ? <CheckCircle2 size={12} /> : <Clock size={12} />}
          {complete ? 'Fully evaluated' : noneEvaluated ? 'Evaluation unavailable' : 'Partially evaluated'}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {cells.map((c) => (
          <div key={c.label} className="rounded-xl border border-border bg-background/60 p-3">
            <p className="flex items-center gap-1.5 text-[0.6875rem] font-medium text-muted-foreground">
              {c.icon}
              {c.label}
            </p>
            <p className="mt-1 text-2xl font-bold text-foreground tnum">{c.value}</p>
          </div>
        ))}
      </div>
      {noneEvaluated && coverage.total > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          Responses were recorded, but evaluation metrics are not currently available for this report.
        </p>
      )}
    </motion.div>
  );
}
