import type React from 'react';
import { motion } from 'framer-motion';
import { getGrade } from '../../utils/normalizeReport';

/** Circular 0–100 gauge. Null renders an explicit N/A state (never 0). */
export default function ScoreGauge({
  value,
  label,
  hint,
  size = 148,
  stroke = 13,
  delay = 0,
}: {
  key?: React.Key;
  value: number | null | undefined;
  label: string;
  hint?: string;
  size?: number;
  stroke?: number;
  delay?: number;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = value === null || value === undefined ? null : Math.max(0, Math.min(100, value));
  const grade = getGrade(value ?? undefined);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.3 }}
      className="flex flex-col items-center text-center"
      role="img"
      aria-label={pct === null ? `${label}: not available` : `${label}: ${Math.round(pct)} out of 100`}
    >
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f1f5f9" strokeWidth={stroke} />
          {pct !== null && (
            <motion.circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={grade.color}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={c}
              initial={{ strokeDashoffset: c }}
              animate={{ strokeDashoffset: c - (pct / 100) * c }}
              transition={{ delay: delay + 0.1, duration: 0.7, ease: 'easeOut' }}
            />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center p-1 text-center">
          <span
            className={`font-bold text-slate-900 tnum leading-none ${
              size < 100 ? 'text-lg' : size <= 130 ? 'text-2xl' : 'text-3xl'
            }`}
          >
            {pct === null ? 'N/A' : Math.round(pct)}
          </span>
          <span className={`font-semibold text-slate-400 mt-1 leading-none ${size <= 130 ? 'text-[10px]' : 'text-xs'}`}>
            / 100
          </span>
        </div>
      </div>
      <p className="mt-2 text-sm font-semibold text-slate-800">{label}</p>
      {hint && <p className="text-xs text-slate-400">{hint}</p>}
    </motion.div>
  );
}
