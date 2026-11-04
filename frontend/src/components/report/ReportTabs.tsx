import {Tabs as ShadcnTabs, TabsList, TabsTrigger} from '@/components/ui/tabs';
import { motion } from 'motion/react';
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
      <ShadcnTabs value={active} onValueChange={value=>onChange(String(value))}><TabsList className="flex items-center gap-1 rounded-xl border border-border bg-card p-1.5 shadow-sm">
        {tabs.map((t) => {
          const selected = active === t.id;
          return (
            <TabsTrigger value={t.id}
              key={t.id}
              role="tab"
              aria-selected={selected}
              type="button"

              className={`relative whitespace-nowrap rounded-lg px-4 py-2 text-xs font-semibold transition-colors ${
                selected ? 'text-accent font-bold' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {selected && (
                <motion.span
                  layoutId="report-tab-highlight"
                  className="absolute inset-0 rounded-lg bg-[var(--primary-soft)]"
                  transition={{ type: 'spring', duration: 0.35, bounce: 0.15 }}
                />
              )}
              <span className="relative z-10">{t.label}</span>
            </TabsTrigger>
          );
        })}
      </TabsList></ShadcnTabs>
    </nav>
  );
}
