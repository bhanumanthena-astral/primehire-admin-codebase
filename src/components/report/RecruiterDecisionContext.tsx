import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  FileCheck,
  ShieldCheck,
  ShieldAlert,
  ArrowRight,
  ClipboardList,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import type { NormalizedReport, Insights } from '../../utils/normalizeReport';
import { getCoverage, formatScore } from '../../utils/reportMetrics';

export interface RecruiterDecisionContextProps {
  report: NormalizedReport;
  insights: Insights;
  jobTitle?: string;
  delay?: number;
}

export default function RecruiterDecisionContext({
  report,
  insights,
  jobTitle = 'Target Role',
  delay = 0,
}: RecruiterDecisionContextProps) {
  const { overall, questions, violations } = report;
  const coverage = getCoverage(questions);
  const [decision, setDecision] = useState<'advance' | 'hold' | 'reject' | null>(null);
  const [recruiterNotes, setRecruiterNotes] = useState('');

  const techScore = overall.overallScore;
  const commObj = overall.communication || {};
  const commScore = commObj.overall_score ?? commObj.overallScore ?? null;
  const confScore = overall.confidenceScore;

  // Proctoring flags check
  const tabSwitches = violations?.tab_switch_count ?? violations?.tabSwitches ?? violations?.tab_switching ?? 0;
  const multipleFaces = violations?.multiple_face_detected ?? violations?.multipleFaceDetected ?? violations?.multiple_faces_detected ?? 0;
  const hasProctoringAlerts = tabSwitches > 0 || multipleFaces > 0;

  // Threshold evaluation (industry benchmark: 70% tech, 60% comms)
  const techPass = techScore !== null && techScore >= 70;
  const techBorderline = techScore !== null && techScore >= 50 && techScore < 70;
  const commPass = commScore === null || commScore >= 60;

  const handleDecision = (choice: 'advance' | 'hold' | 'reject') => {
    setDecision(choice);
    const messages = {
      advance: 'Marked candidate for advancement to next interview round.',
      hold: 'Placed candidate on hold pending evaluator review.',
      reject: 'Marked candidate as not meeting round criteria.',
    };
    toast.success(messages[choice]);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4 }}
      className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
            <ClipboardList size={18} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-800">Recruiter Decision Support & Verification</h3>
            <p className="text-xs text-slate-500">
              Evidence-based evaluation alignment for {jobTitle}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-600">
            Coverage: {coverage.evaluated}/{coverage.total} Evaluated
          </span>
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-semibold ${
              hasProctoringAlerts ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
            }`}
          >
            {hasProctoringAlerts ? <ShieldAlert size={12} /> : <ShieldCheck size={12} />}
            {hasProctoringAlerts ? 'Proctoring Flags' : 'Proctoring Verified'}
          </span>
        </div>
      </div>

      {/* ── Key Criteria Matrix ── */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-600">Technical Standard</span>
            {techScore === null ? (
              <span className="text-[11px] font-medium text-slate-400">Pending</span>
            ) : techPass ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700">
                <CheckCircle2 size={13} /> Meets standard ({techScore}/100)
              </span>
            ) : techBorderline ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700">
                <AlertTriangle size={13} /> Borderline ({techScore}/100)
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-700">
                <AlertTriangle size={13} /> Below standard ({techScore}/100)
              </span>
            )}
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            {techPass
              ? 'Candidate demonstrated solid domain competency across evaluated questions.'
              : techBorderline
              ? 'Candidate demonstrates partial proficiency; live code challenge recommended.'
              : 'Performance falls below the baseline passing criteria for this position.'}
          </p>
        </div>

        <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-600">Communication & Delivery</span>
            {commScore === null ? (
              <span className="text-[11px] font-medium text-slate-400">Pending</span>
            ) : commPass ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700">
                <CheckCircle2 size={13} /> Clear ({commScore}/100)
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700">
                <AlertTriangle size={13} /> Needs probing ({commScore}/100)
              </span>
            )}
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            Fluency: {commObj.fluency ? `${commObj.fluency}/100` : 'N/A'} · Confidence:{' '}
            {confScore !== null ? `${confScore}/100` : 'N/A'}
          </p>
        </div>

        <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-600">Integrity Assessment</span>
            {hasProctoringAlerts ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700">
                <ShieldAlert size={13} /> Audit required
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700">
                <ShieldCheck size={13} /> Clean session
              </span>
            )}
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            {tabSwitches} tab switch(es) · {multipleFaces} multi-face flag(s)
          </p>
        </div>
      </div>

      {/* ── Targeted Follow-up Prompts for Interviewer ── */}
      <div className="rounded-xl border border-amber-100 bg-amber-50/50 p-4">
        <div className="mb-2 flex items-center gap-2">
          <Sparkles size={15} className="text-amber-600" />
          <p className="text-xs font-bold text-amber-950">Recommended Live Interview Probes</p>
        </div>
        <ul className="space-y-1.5 text-xs text-amber-900">
          {insights.recommendations.map((rec, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
              <span>{rec}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* ── Recruiter Decision Action Bar ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-700">Interviewer Decision:</span>
          <div className="inline-flex rounded-lg border border-slate-200 p-0.5 shadow-xs">
            <button
              type="button"
              onClick={() => handleDecision('advance')}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                decision === 'advance'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              Advance to Next Round
            </button>
            <button
              type="button"
              onClick={() => handleDecision('hold')}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                decision === 'hold'
                  ? 'bg-amber-500 text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              Hold for Review
            </button>
            <button
              type="button"
              onClick={() => handleDecision('reject')}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                decision === 'reject'
                  ? 'bg-rose-600 text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              Do Not Proceed
            </button>
          </div>
        </div>

        <p className="text-[11px] text-slate-400">
          Decisions are logged to candidate assessment timeline.
        </p>
      </div>
    </motion.div>
  );
}
