import type React from 'react';
import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

/** Scroll-target section with consistent heading treatment. */
export default function Section({
  id,
  eyebrow,
  title,
  hint,
  action,
  children,
  delay = 0,
}: {
  id: string;
  eyebrow?: string;
  title?: string;
  hint?: string;
  action?: ReactNode;
  children: ReactNode;
  delay?: number;
}) {
  return (
    <section id={`report-section-${id}`} data-report-section={id} className="scroll-mt-3">
      {(eyebrow || title || action) && (
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            {eyebrow && (
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-amber-600">{eyebrow}</p>
            )}
            {title && <h3 className="text-base font-bold text-slate-900">{title}</h3>}
            {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
          </div>
          {action}
        </div>
      )}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay, duration: 0.3 }}
      >
        {children}
      </motion.div>
    </section>
  );
}
