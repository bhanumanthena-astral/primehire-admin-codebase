import { motion } from 'framer-motion';
import type { ReportTab } from '../../utils/reportConfig';

/** Compact scroll-to-section nav with animated active indicator. */
export default function ReportTabs({
  tabs,
  active,
  onChange,
}: {
  tabs: ReportTab[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <nav aria-label="Report sections" className="overflow-x-auto">
      <div role="tablist" className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm">
        {tabs.map((t) => {
          const selected = active === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={selected}
              type="button"
              onClick={() => onChange(t.id)}
              className={`relative whitespace-nowrap rounded-lg px-4 py-2 text-xs font-semibold transition-colors ${
                selected ? 'text-amber-700 font-bold' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {selected && (
                <motion.span
                  layoutId="report-tab-highlight"
                  className="absolute inset-0 rounded-lg bg-amber-50"
                  transition={{ type: 'spring', duration: 0.35, bounce: 0.15 }}
                />
              )}
              <span className="relative z-10">{t.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
