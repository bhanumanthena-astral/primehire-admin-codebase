import {Tabs as ShadcnTabs, TabsList, TabsTrigger} from '@/components/ui/tabs';
import { motion } from 'motion/react';

const TABS = ['Overview', 'Question Analysis', 'Detailed Feedback', 'Transcript', 'Proctoring', 'AI Summary'];

export default function Tabs({ active, onChange }: { active: string; onChange: (tab: string) => void }) {
  return (
    <ShadcnTabs value={active} onValueChange={value=>onChange(String(value))}><TabsList className="flex items-center gap-1 bg-card border border-border rounded-xl p-1.5 mb-6 overflow-x-auto">
      {TABS.map((tab) => (
        <TabsTrigger value={tab}
          key={tab}

          className="relative px-4 py-2 text-sm font-medium rounded-lg whitespace-nowrap transition-colors"
          style={{ color: active === tab ? 'var(--accent)' : 'var(--muted-foreground)' }}
        >
          {active === tab && (
            <motion.div
              layoutId="tab-highlight"
              className="absolute inset-0 bg-[var(--primary-soft)] rounded-lg"
              transition={{ type: 'spring', duration: 0.4 }}
            />
          )}
          <span className="relative z-10">{tab}</span>
        </TabsTrigger>
      ))}
    </TabsList></ShadcnTabs>
  );
}
