import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ResponsiveContainer } from 'recharts';
import { motion } from 'motion/react';
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
      className="bg-card border border-border rounded-2xl p-5 shadow-sm"
    >
      <p className="text-sm font-semibold text-foreground mb-3">Score Distribution</p>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--muted)" vertical={false} />
          <XAxis dataKey="name" tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }} axisLine={false} tickLine={false} />
          <YAxis domain={[0, 100]} tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid var(--border)' }} />
          <Bar dataKey="value" radius={[8, 8, 0, 0]} barSize={48}>
            {data.map((d, i) => (
              <Cell key={i} fill={getGrade(d.value).color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </motion.div>
  );
}
