import {Button} from '@/components/ui/button';
import { motion } from 'motion/react';
import { Calendar, Share2, Download, Loader2 } from 'lucide-react';
import { initialsFromId, shortId, formatDate, getGrade } from '../../utils/normalizeReport';
import type { NormalizedReport, Insights } from '../../utils/normalizeReport';

const roundStyles: Record<string, { bg: string; color: string; label: string }> = {
  TECHNICAL: { bg: '#eff6ff', color: '#1d4ed8', label: 'Technical Round' },
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
      className="bg-card border border-border rounded-2xl p-6 shadow-sm mb-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="flex min-w-0 items-start gap-4">
          <div
            className="h-16 w-16 rounded-2xl flex items-center justify-center text-xl font-bold shrink-0"
            style={{ background: roundStyle.bg, color: roundStyle.color }}
          >
            {initialsFromId(meta.candidateId)}
          </div>
          <div className="min-w-0 break-words">
            <h1 className="text-xl font-bold text-foreground">Candidate #{shortId(meta.candidateId, 10)}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Job ID: {shortId(meta.jobId, 14)}</p>
            <div className="flex flex-wrap items-center gap-4 mt-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Calendar size={14} /> {formatDate(meta.submittedAt)}
              </span>
              <span className="px-2.5 py-1 rounded-full font-medium" style={{ background: roundStyle.bg, color: roundStyle.color }}>
                {roundStyle.label}
              </span>
              <span
                className={`px-2.5 py-1 rounded-full font-medium ${
                  isEmpty ? 'bg-[var(--warning-soft)] text-warning' : 'bg-[var(--success-soft)] text-success'
                }`}
              >
                {isEmpty ? 'Not Evaluated' : 'Evaluated'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex max-w-full flex-wrap items-center gap-3">
          <Button variant="ghost" className="flex items-center gap-2 px-4 py-2 rounded-xl border border-border text-sm font-medium text-foreground hover:bg-background">
            <Share2 size={16} /> Share
          </Button>
          <Button variant="ghost"
            onClick={onExport}
            disabled={exporting}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary-glow disabled:opacity-60"
          >
            {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            {exporting ? 'Generating…' : 'Download PDF'}
          </Button>
        </div>
      </div>

      {!isEmpty && (
        <div className="flex flex-wrap items-center justify-between gap-4 mt-5 pt-5 border-t border-border">
          <div className="w-full min-w-0 flex-1 break-words bg-background rounded-xl p-4 text-sm text-muted-foreground italic">
            &ldquo;{insights.summary}&rdquo;
          </div>
          <div className="flex items-center gap-3 bg-background rounded-xl px-5 py-3">
            <span className="text-xs text-muted-foreground font-medium">Overall Grade</span>
            <span
              className="h-9 w-9 rounded-lg flex items-center justify-center font-bold text-sm"
              style={{ background: grade.bg, color: grade.color }}
            >
              {grade.letter}
            </span>
            <span className="text-2xl font-bold text-foreground">
              {overall.overallScore ?? '—'}
              <span className="text-sm text-muted-foreground font-normal">/100</span>
            </span>
          </div>
        </div>
      )}
    </motion.div>
  );
}
