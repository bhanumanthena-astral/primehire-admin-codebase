import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer } from 'recharts';
import { motion } from 'motion/react';
import type { NormalizedOverall } from '../../utils/normalizeReport';

export default function SkillRadar({ overall, delay = 0 }: { overall: NormalizedOverall; delay?: number }) {
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
      className="bg-card border border-border rounded-2xl p-5 shadow-sm"
    >
      <p className="text-sm font-semibold text-foreground mb-3">Skill Profile</p>
      <ResponsiveContainer width="100%" height={280}>
        <RadarChart data={data} outerRadius="75%">
          <PolarGrid stroke="var(--border)" />
          <PolarAngleAxis dataKey="metric" tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }} />
          <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fill: 'var(--border)', fontSize: 10 }} />
          <Radar dataKey="value" stroke="var(--accent)" fill="var(--accent)" fillOpacity={0.25} strokeWidth={2} />
        </RadarChart>
      </ResponsiveContainer>
    </motion.div>
  );
}
