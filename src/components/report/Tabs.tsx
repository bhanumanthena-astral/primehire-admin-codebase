import { motion } from 'framer-motion';

const TABS = ['Overview', 'Question Analysis', 'Detailed Feedback', 'Transcript', 'Proctoring', 'AI Summary'];

export default function Tabs({ active, onChange }: { active: string; onChange: (tab: string) => void }) {
  return (
    <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl p-1.5 mb-6 overflow-x-auto">
      {TABS.map((tab) => (
        <button
          key={tab}
          onClick={() => onChange(tab)}
          className="relative px-4 py-2 text-sm font-medium rounded-lg whitespace-nowrap transition-colors"
          style={{ color: active === tab ? '#4338ca' : '#64748b' }}
        >
          {active === tab && (
            <motion.div
              layoutId="tab-highlight"
              className="absolute inset-0 bg-indigo-50 rounded-lg"
              transition={{ type: 'spring', duration: 0.4 }}
            />
          )}
          <span className="relative z-10">{tab}</span>
        </button>
      ))}
    </div>
  );
}
