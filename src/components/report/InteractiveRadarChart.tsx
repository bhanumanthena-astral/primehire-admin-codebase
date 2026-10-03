import type React from 'react';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import type { RadarPoint } from '../../utils/reportMetrics';
import { REPORT_ACCENT, REPORT_GRID, REPORT_TICK } from '../../utils/reportConfig';

export type RadarState = 'complete' | 'partial' | 'no-data';

/**
 * Interactive radar built ONLY from supplied non-null metrics.
 * Supports complete / partial / no-data states — never plots 0 for missing.
 */
export default function InteractiveRadarChart({
  title,
  points,
  expectedCount,
  centerValue,
  centerLabel,
  emptyLabel,
  emptyAction,
  onSelect,
  delay = 0,
}: {
  title: string;
  points: RadarPoint[];
  expectedCount: number;
  centerValue?: number | null;
  centerLabel?: string;
  emptyLabel: string;
  emptyAction?: ReactNode;
  onSelect?: (key: string | null) => void;
  delay?: number;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const state: RadarState =
    points.length === 0 ? 'no-data' : points.length < expectedCount ? 'partial' : 'complete';

  const data = useMemo(
    () =>
      points.map((p) => ({
        metric: p.label,
        value: Math.max(0, Math.min(100, p.value ?? 0)),
        key: p.key,
      })),
    [points],
  );

  const summary = useMemo(
    () => points.map((p) => `${p.label} ${Math.round(p.value ?? 0)}`).join(', '),
    [points],
  );

  const pick = (key: string) => {
    const next = selected === key ? null : key;
    setSelected(next);
    onSelect?.(next);
  };

  if (state === 'no-data') {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm font-semibold text-slate-800">{title}</p>
        <div className="flex flex-col items-center py-8 text-center">
          <p className="text-sm font-semibold text-slate-500">Evaluation data unavailable</p>
          <p className="mt-1 max-w-xs text-xs text-slate-400">{emptyLabel}</p>
          {emptyAction && <div className="mt-4">{emptyAction}</div>}
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.3 }}
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-slate-800">{title}</p>
        {state === 'partial' && (
          <span className="shrink-0 text-[11px] font-medium text-slate-400">
            {points.length} of {expectedCount} available
          </span>
        )}
      </div>

      <div className="relative" role="img" aria-label={`Radar chart. ${summary}`}>
        <ResponsiveContainer width="100%" height={280}>
          <RadarChart data={data} outerRadius="72%">
            <PolarGrid stroke={REPORT_GRID} />
            <PolarAngleAxis dataKey="metric" tick={{ fill: REPORT_TICK, fontSize: 12 }} />
            <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fill: '#cbd5e1', fontSize: 10 }} />
            <Tooltip
              contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }}
              formatter={(value: any) => [`${Math.round(Number(value))} / 100`, 'Score']}
            />
            <Radar
              dataKey="value"
              stroke={REPORT_ACCENT}
              fill={REPORT_ACCENT}
              fillOpacity={0.25}
              strokeWidth={2}
              isAnimationActive
              animationDuration={600}
            />
          </RadarChart>
        </ResponsiveContainer>
        {centerValue !== null && centerValue !== undefined && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="bg-white/80 px-2 text-2xl font-bold text-slate-900 tnum">
              {Math.round(centerValue)}
            </span>
            {centerLabel && (
              <span className="bg-white/80 px-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {centerLabel}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label={`${title} metrics`}>
        {points.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => pick(p.key)}
            aria-pressed={selected === p.key}
            className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
              selected === p.key
                ? 'border-amber-600 bg-amber-600 text-white'
                : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-amber-300'
            }`}
          >
            {p.label} · {Math.round(p.value ?? 0)}
          </button>
        ))}
      </div>
      {state === 'partial' && (
        <p className="mt-2 text-[11px] text-slate-400">
          Missing dimensions are omitted, not plotted as zero.
        </p>
      )}
    </motion.div>
  );
}
