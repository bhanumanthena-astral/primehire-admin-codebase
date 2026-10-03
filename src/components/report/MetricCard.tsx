import type React from 'react';
import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { formatScore } from '../../utils/reportMetrics';

export default function MetricCard({
  icon: Icon,
  label,
  value,
  suffix = '/ 100',
  sub,
  onClick,
  delay = 0,
  selected = false,
}: {
  key?: React.Key;
  icon?: LucideIcon;
  label: string;
  value: number | null | undefined;
  suffix?: string;
  sub?: string;
  onClick?: () => void;
  delay?: number;
  selected?: boolean;
}) {
  const Body = (
    <>
      <div className="flex items-center gap-1.5 min-w-0">
        {Icon && <Icon size={14} className="text-slate-400 shrink-0" aria-hidden />}
        <span className="text-xs font-medium text-slate-500 truncate">{label}</span>
      </div>
      <div className="mt-1.5 flex items-baseline flex-wrap gap-x-1.5 gap-y-0.5 tnum" aria-label={`${label}: ${formatScore(value)} out of 100`}>
        <span className="text-2xl font-bold text-slate-900 leading-tight">
          {formatScore(value)}
        </span>
        {value !== null && value !== undefined && suffix && (
          <span className="text-xs font-medium text-slate-400 whitespace-nowrap">{suffix}</span>
        )}
      </div>
      {sub && <p className="mt-1 text-[11px] text-slate-400 line-clamp-1">{sub}</p>}
    </>
  );
  const cls = `rounded-xl border bg-white p-3.5 text-left shadow-sm transition-colors ${
    selected ? 'border-amber-500 ring-1 ring-amber-500' : 'border-slate-200'
  } ${onClick ? 'cursor-pointer hover:border-amber-300' : ''}`;
  if (onClick) {
    return (
      <motion.button
        type="button"
        onClick={onClick}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay, duration: 0.25 }}
        className={cls}
        aria-pressed={selected}
      >
        {Body}
      </motion.button>
    );
  }
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.25 }} className={cls}>
      {Body}
    </motion.div>
  );
}

export function MetricGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{children}</div>;
}
