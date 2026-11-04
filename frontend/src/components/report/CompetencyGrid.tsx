import { motion } from 'motion/react';
import { formatScore } from '../../utils/reportMetrics';

export interface CompetencyBlock {
  key: string;
  label: string;
  value: unknown;
}

/**
 * Flexible renderer for supplier competency blocks. Present values render as
 * score/metric cards; null renders a compact unavailable state. The UI grows
 * richer automatically when PrimeHire starts supplying these fields.
 */
export default function CompetencyGrid({
  title,
  note,
  blocks,
  delay = 0,
}: {
  title: string;
  note?: string;
  blocks: CompetencyBlock[];
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.3 }}
      className="rounded-2xl border border-border bg-card p-5 shadow-sm"
    >
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {note && <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>}
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {blocks.map((b, i) => (
          <motion.div
            key={b.key}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: delay + i * 0.05, duration: 0.25 }}
            className="rounded-xl border border-border p-3.5"
          >
            <p className="text-xs font-semibold text-foreground">{b.label}</p>
            <BlockValue value={b.value} />
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}

function BlockValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <p className="mt-1.5 text-xs italic text-muted-foreground">Not supplied in this report.</p>;
  }
  if (typeof value === 'number') {
    return (
      <p className="mt-1 text-2xl font-bold text-foreground tnum">
        {formatScore(value)}
        <span className="ml-1 text-xs font-medium text-muted-foreground">/ 100</span>
      </p>
    );
  }
  if (typeof value === 'string') {
    return <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{value}</p>;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) =>
      ['number', 'string'].includes(typeof v),
    );
    if (entries.length === 0) {
      return <p className="mt-1.5 text-xs italic text-muted-foreground">No displayable metrics in this block.</p>;
    }
    return (
      <dl className="mt-2 space-y-1.5">
        {entries.slice(0, 8).map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-2 text-xs">
            <dt className="capitalize text-muted-foreground">{k.replace(/_/g, ' ')}</dt>
            <dd className="font-semibold text-foreground tnum">
              {typeof v === 'number' ? formatScore(v) : String(v)}
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  return null;
}
