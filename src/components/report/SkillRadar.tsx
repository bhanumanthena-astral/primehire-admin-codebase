import { useState, useRef, useEffect } from 'react';
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip } from 'recharts';
import { motion } from 'framer-motion';
import type { NormalizedOverall } from '../../utils/normalizeReport';

export default function SkillRadar({ overall, delay = 0 }: { overall: NormalizedOverall; delay?: number }) {
  const [chartWidth, setChartWidth] = useState(320);
  const chartRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = chartRef.current;
    if (!element) return;
    setChartWidth(element.clientWidth);
    const observer = new ResizeObserver(([entry]) => setChartWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // Reserve room for the full side labels, including "Pronunciation".
  const radius = Math.max(24, Math.min(98, (chartWidth / 2 - 96) / Math.cos(Math.PI / 6)));
  const comm = overall.communication || {};
  // Built ONLY from real fields — no invented categories.
  const data = [
    { metric: 'Technical', value: overall.overallScore ?? 0 },
    { metric: 'Confidence', value: overall.confidenceScore ?? 0 },
    { metric: 'Fluency', value: comm.fluency ?? 0 },
    { metric: 'Grammar', value: comm.grammar ?? 0 },
    { metric: 'Vocabulary', value: comm.vocabulary ?? 0 },
    { metric: 'Pronunciation', value: comm.pronunciation ?? 0 },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4 }}
      className="min-w-0 bg-white border border-slate-200 rounded-2xl p-5 shadow-sm"
    >
      <p className="text-sm font-semibold text-slate-800 mb-1">Skill Profile</p>
      <p className="text-xs text-slate-500 mb-3">Scores on a 0–100 scale</p>
      <div ref={chartRef} className="min-w-0">
        {chartWidth < 280 ? (
          <div className="space-y-3 py-2">
            {data.map(({ metric, value }) => (
              <div key={metric}>
                <div className="flex items-center justify-between gap-3 text-xs mb-1.5">
                  <span className="text-slate-600 font-medium">{metric}</span>
                  <span className="text-slate-800 tabular-nums">{Math.round(value * 10) / 10}</span>
                </div>
                <div role="meter" aria-label={metric} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full rounded-full bg-indigo-500" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <ResponsiveContainer width="100%" minWidth={0} height={260}>
            <RadarChart data={data} outerRadius={radius}>
              <PolarGrid stroke="#e2e8f0" />
              <PolarAngleAxis dataKey="metric" tick={{ fill: '#475569', fontSize: 12, fontWeight: 500 }} />
              <PolarRadiusAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={false} axisLine={false} />
              <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0' }} />
              <Radar name="Score" dataKey="value" stroke="#4f46e5" fill="#4f46e5" fillOpacity={0.25} strokeWidth={2} isAnimationActive={false} />
            </RadarChart>
          </ResponsiveContainer>
        )}
      </div>
    </motion.div>
  );
}
