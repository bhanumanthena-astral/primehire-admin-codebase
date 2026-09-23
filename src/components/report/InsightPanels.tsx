import { motion } from 'framer-motion';
import { CheckCircle2, AlertTriangle, Lightbulb } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Insights } from '../../utils/normalizeReport';

export default function InsightPanels({ insights, delay = 0 }: { insights: Insights; delay?: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
      <Panel icon={CheckCircle2} iconColor="#16a34a" title="Strengths" items={insights.strengths} delay={delay} />
      <Panel
        icon={AlertTriangle}
        iconColor="#dc2626"
        title="Areas for Improvement"
        items={insights.improvements}
        delay={delay + 0.1}
      />
      <Panel
        icon={Lightbulb}
        iconColor="#2563eb"
        title="Recommendations"
        items={insights.recommendations}
        delay={delay + 0.2}
      />
    </div>
  );
}

function Panel({
  icon: Icon,
  iconColor,
  title,
  items,
  delay,
}: {
  icon: LucideIcon;
  iconColor: string;
  title: string;
  items: string[];
  delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4 }}
      className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm"
    >
      <div className="flex items-center gap-2 mb-3">
        <Icon size={16} style={{ color: iconColor }} />
        <p className="text-sm font-semibold text-slate-800">{title}</p>
      </div>
      <ul className="space-y-2">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-slate-600">
            <span className="mt-1.5 h-1.5 w-1.5 rounded-full shrink-0" style={{ background: iconColor }} />
            {item}
          </li>
        ))}
      </ul>
    </motion.div>
  );
}
