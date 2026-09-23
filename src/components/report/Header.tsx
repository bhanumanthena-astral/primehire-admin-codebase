import { motion } from 'framer-motion';
import { Calendar, Share2, Download, Loader2 } from 'lucide-react';
import { initialsFromId, shortId, formatDate, getGrade } from '../../utils/normalizeReport';
import type { NormalizedReport, Insights } from '../../utils/normalizeReport';

const roundStyles: Record<string, { bg: string; color: string; label: string }> = {
  TECHNICAL: { bg: '#eef2ff', color: '#4338ca', label: 'Technical Round' },
  BASIC: { bg: '#ecfeff', color: '#0e7490', label: 'Basic Round' },
  HR: { bg: '#fdf2f8', color: '#be185d', label: 'HR Round' },
  UNKNOWN: { bg: '#f1f5f9', color: '#475569', label: 'Interview Round' },
};

export default function Header({
  report,
  insights,
  onExport,
  exporting,
}: {
  report: NormalizedReport;
  insights: Insights;
  onExport: () => void;
  exporting: boolean;
}) {
  const { meta, overall, isEmpty } = report;
  const roundStyle = roundStyles[meta.roundType] || roundStyles.UNKNOWN;
  const grade = getGrade(overall.overallScore);

  return (
    <motion.div
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm mb-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="flex items-start gap-4">
          <div
            className="h-16 w-16 rounded-2xl flex items-center justify-center text-xl font-bold shrink-0"
            style={{ background: roundStyle.bg, color: roundStyle.color }}
          >
            {initialsFromId(meta.candidateId)}
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Candidate #{shortId(meta.candidateId, 10)}</h1>
            <p className="text-sm text-slate-500 mt-0.5">Job ID: {shortId(meta.jobId, 14)}</p>
            <div className="flex flex-wrap items-center gap-4 mt-3 text-xs text-slate-500">
              <span className="flex items-center gap-1.5">
                <Calendar size={14} /> {formatDate(meta.submittedAt)}
              </span>
              <span className="px-2.5 py-1 rounded-full font-medium" style={{ background: roundStyle.bg, color: roundStyle.color }}>
                {roundStyle.label}
              </span>
              <span
                className={`px-2.5 py-1 rounded-full font-medium ${
                  isEmpty ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'
                }`}
              >
                {isEmpty ? 'Not Evaluated' : 'Evaluated'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button className="flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <Share2 size={16} /> Share
          </button>
          <button
            onClick={onExport}
            disabled={exporting}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 disabled:opacity-60"
          >
            {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            {exporting ? 'Generating…' : 'Download PDF'}
          </button>
        </div>
      </div>

      {!isEmpty && (
        <div className="flex flex-wrap items-center justify-between gap-4 mt-5 pt-5 border-t border-slate-100">
          <div className="flex-1 min-w-[280px] bg-slate-50 rounded-xl p-4 text-sm text-slate-600 italic">
            &ldquo;{insights.summary}&rdquo;
          </div>
          <div className="flex items-center gap-3 bg-slate-50 rounded-xl px-5 py-3">
            <span className="text-xs text-slate-500 font-medium">Overall Grade</span>
            <span
              className="h-9 w-9 rounded-lg flex items-center justify-center font-bold text-sm"
              style={{ background: grade.bg, color: grade.color }}
            >
              {grade.letter}
            </span>
            <span className="text-2xl font-bold text-slate-900">
              {overall.overallScore ?? '—'}
              <span className="text-sm text-slate-400 font-normal">/100</span>
            </span>
          </div>
        </div>
      )}
    </motion.div>
  );
}
