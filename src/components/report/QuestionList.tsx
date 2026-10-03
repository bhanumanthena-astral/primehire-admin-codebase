import { motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import { getGrade, relevancyColor } from '../../utils/normalizeReport';
import { formatScore } from '../../utils/reportMetrics';
import type { NormalizedQuestion } from '../../utils/normalizeReport';

export default function QuestionList({
  questions,
  selectedIndex,
  onSelect,
  delay = 0,
}: {
  questions: NormalizedQuestion[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4 }}
      className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm"
    >
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm font-semibold text-slate-800">Question Analysis</p>
        <span className="text-xs text-slate-400">{questions.length} Questions</span>
      </div>

      <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
        {questions.map((q, i) => {
          const grade = getGrade(q.percentage);
          const isActive = i === selectedIndex;
          const rel = q.relevancy ? relevancyColor[q.relevancy] : null;
          return (
            <button
              key={q.key}
              onClick={() => onSelect(i)}
              className={`w-full text-left p-3 rounded-xl border transition-colors ${
                isActive ? 'border-amber-400 bg-amber-50/80 shadow-xs ring-1 ring-amber-300' : 'border-slate-100 hover:bg-slate-50'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-400 mb-0.5">Q{q.index}</p>
                  <p className="text-sm text-slate-700 line-clamp-2">{q.question}</p>
                  {rel && (
                    <span
                      className="inline-block mt-1.5 text-[10px] font-medium px-2 py-0.5 rounded-full"
                      style={{ background: rel.bg, color: rel.color }}
                    >
                      {q.relevancy} relevancy
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0 tnum">
                  {q.isGenerated ? (
                    <>
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-700 whitespace-nowrap">
                        {formatScore(q.obtainedScore)} / {q.maxScore}
                      </span>
                      <span
                        className="flex h-6 min-w-6 items-center justify-center rounded-md px-1.5 text-xs font-bold"
                        style={{ background: grade.bg, color: grade.color }}
                      >
                        {grade.letter}
                      </span>
                    </>
                  ) : (
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-400 italic whitespace-nowrap">
                      Pending eval
                    </span>
                  )}
                  <ChevronRight size={14} className="text-slate-300 shrink-0" />
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </motion.div>
  );
}
