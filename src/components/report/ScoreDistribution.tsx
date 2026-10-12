import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ResponsiveContainer } from 'recharts';
import { motion } from 'framer-motion';
import { getGrade } from '../../utils/normalizeReport';
import type { NormalizedOverall } from '../../utils/normalizeReport';

// SINGLE series only (candidate's own scores) — no batch-average bars,
// since that data does not exist in the JSON.
export default function ScoreDistribution({ overall, delay = 0 }: { overall: NormalizedOverall; delay?: number }) {
  const data = [
    { name: 'Technical', value: overall.overallScore ?? 0 },
    { name: 'Communication', value: overall.communication?.overall_score ?? overall.communication?.overallScore ?? 0 },
    { name: 'Presence', value: overall.confidenceScore ?? 0 },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4 }}
      className="min-w-0 bg-white border border-slate-200 rounded-2xl p-5 shadow-sm"
    >
      <p className="text-sm font-semibold text-slate-800 mb-1">Score Distribution</p>
      <p className="text-xs text-slate-500 mb-3">Scores on a 0–100 scale</p>
      <ResponsiveContainer width="100%" minWidth={0} height={260}>
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 32, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
          <XAxis type="number" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="name" width={110} interval={0} axisLine={false} tickLine={false} tick={({ x, y, payload }) => {
            const score = data.find(item => item.name === payload.value)?.value;
            return (
              <g transform={`translate(${Number(x) - 10}, ${y})`}>
                <text className="recharts-cartesian-axis-tick-value" textAnchor="end" y={-4} fill="#475569" fontSize={12} fontWeight={500}>{payload.value}</text>
                <text className="report-score-label" textAnchor="end" y={13} fill="#64748b" fontSize={11}>{score === undefined ? '' : Math.round(score * 10) / 10}</text>
              </g>
            );
          }} />
          <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0' }} />
          <Bar name="Score" dataKey="value" radius={[0, 6, 6, 0]} barSize={22} isAnimationActive={false}>
            {data.map((d, i) => (
              <Cell key={i} fill={getGrade(d.value).color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </motion.div>
  );
}
