import { RadialBarChart, RadialBar, PolarAngleAxis } from 'recharts';
import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import { getGrade } from '../../utils/normalizeReport';

export default function GaugeCard({
  icon: Icon,
  iconColor,
  title,
  subtitle,
  score,
  description,
  delay = 0,
}: {
  icon: LucideIcon;
  iconColor: string;
  title: string;
  subtitle: string;
  score: number | null | undefined;
  description: string;
  delay?: number;
}) {
  const grade = getGrade(score);
  const data = [{ value: score ?? 0, fill: grade.color }];

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4 }}
      className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm"
    >
      <div className="flex items-center gap-2 mb-1">
        <div
          className="h-8 w-8 rounded-lg flex items-center justify-center"
          style={{ background: `${iconColor}15`, color: iconColor }}
        >
          <Icon size={16} />
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-800">{title}</p>
        </div>
      </div>
      <p className="text-xs text-slate-400 mb-3 ml-10">{subtitle}</p>

      <div className="flex items-center gap-4">
        <div className="relative w-24 h-24 shrink-0">
          <RadialBarChart width={96} height={96} innerRadius="72%" outerRadius="100%" data={data} startAngle={90} endAngle={-270}>
            <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
            <RadialBar background={{ fill: '#f1f5f9' }} dataKey="value" cornerRadius={20} />
          </RadialBarChart>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-xl font-bold text-slate-900">{score ?? '—'}</span>
            <span className="text-[10px] text-slate-400">/100</span>
          </div>
        </div>
        <div>
          <span
            className="inline-block text-xs font-bold px-2 py-0.5 rounded-md mb-1.5"
            style={{ background: grade.bg, color: grade.color }}
          >
            {grade.letter}
          </span>
          <p className="text-xs text-slate-500 leading-snug">{description}</p>
        </div>
      </div>
    </motion.div>
  );
}
