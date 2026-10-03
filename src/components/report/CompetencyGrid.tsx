import { motion } from 'framer-motion';
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
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      {note && <p className="mt-0.5 text-xs text-slate-400">{note}</p>}
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {blocks.map((b, i) => (
          <motion.div
            key={b.key}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: delay + i * 0.05, duration: 0.25 }}
            className="rounded-xl border border-slate-100 p-3.5"
          >
            <p className="text-xs font-semibold text-slate-700">{b.label}</p>
            <BlockValue value={b.value} />
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}

function BlockValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <p className="mt-1.5 text-xs italic text-slate-400">Not supplied in this report.</p>;
  }
  if (typeof value === 'number') {
    return (
      <p className="mt-1 text-2xl font-bold text-slate-900 tnum">
        {formatScore(value)}
        <span className="ml-1 text-xs font-medium text-slate-400">/ 100</span>
      </p>
    );
  }
  if (typeof value === 'string') {
    return <p className="mt-1.5 text-xs leading-relaxed text-slate-600">{value}</p>;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) =>
      ['number', 'string'].includes(typeof v),
    );
    if (entries.length === 0) {
      return <p className="mt-1.5 text-xs italic text-slate-400">No displayable metrics in this block.</p>;
    }
    return (
      <dl className="mt-2 space-y-1.5">
        {entries.slice(0, 8).map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-2 text-xs">
            <dt className="capitalize text-slate-500">{k.replace(/_/g, ' ')}</dt>
            <dd className="font-semibold text-slate-800 tnum">
              {typeof v === 'number' ? formatScore(v) : String(v)}
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  return null;
}
