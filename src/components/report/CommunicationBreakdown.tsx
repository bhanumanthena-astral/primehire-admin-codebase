import { motion } from 'framer-motion';
import { Mic, PenLine, Waves, BookOpen } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const METRICS: { key: string; label: string; icon: LucideIcon; color: string }[] = [
  { key: 'fluency', label: 'Fluency', icon: Mic, color: '#f59e0b' },
  { key: 'grammar', label: 'Grammar', icon: PenLine, color: '#ef4444' },
  { key: 'pronunciation', label: 'Pronunciation', icon: Waves, color: '#f97316' },
  { key: 'vocabulary', label: 'Vocabulary', icon: BookOpen, color: '#eab308' },
];

export default function CommunicationBreakdown({
  communication,
  delay = 0,
}: {
  communication: Record<string, any> | null | undefined;
  delay?: number;
}) {
  if (!communication) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4 }}
      className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm"
    >
      <p className="text-sm font-semibold text-slate-800 mb-4">Communication Breakdown</p>
      <div className="space-y-4">
        {METRICS.map((m, i) => {
          const Icon = m.icon;
          const value = communication[m.key] ?? 0;
          return (
            <div key={m.key}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="flex items-center gap-2 text-sm text-slate-600">
                  <Icon size={14} style={{ color: m.color }} /> {m.label}
                </span>
                <span className="text-sm font-semibold text-slate-800">{value}</span>
              </div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${value}%` }}
                  transition={{ delay: delay + i * 0.1, duration: 0.6 }}
                  className="h-full rounded-full"
                  style={{ background: m.color }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}
