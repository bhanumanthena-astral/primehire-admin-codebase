import { useMemo, useState } from 'react';
import { RefreshCw, Video, CheckCircle2, Clock } from 'lucide-react';
import Section from './Section';
import ScoreGauge from './ScoreGauge';
import MetricCard from './MetricCard';
import InteractiveRadarChart from './InteractiveRadarChart';
import EvaluationCoverage from './EvaluationCoverage';
import CompetencyGrid from './CompetencyGrid';
import ProctoringAudit from './ProctoringAudit';
import QuestionReview from './QuestionReview';
import TranscriptPanel from './TranscriptPanel';
import InsightPanels from './InsightPanels';
import RecruiterDecisionContext from './RecruiterDecisionContext';
import type { NormalizedReport, Insights } from '../../utils/normalizeReport';
import { getCoverage, getRadarPoints } from '../../utils/reportMetrics';
import { TECHNICAL_RADAR_AXES, HR_COMPETENCY_BLOCKS } from '../../utils/reportConfig';

function rawBlock(raw: any, camel: string, snake: string): unknown {
  const report = raw?.report ?? raw ?? {};
  const overall = report?.overall_result ?? report?.overallResult ?? {};
  return overall?.[camel] ?? overall?.[snake] ?? null;
}

/**
 * HR round: recruiter decision-support, coverage-first.
 * Scores/radar render ONLY from actually-present metrics — unevaluated reports
 * show an explicit pending state, never zeros.
 */
export default function HRReport({
  report,
  insights,
  onRefresh,
  onRegenerate,
  regenerating = false,
}: {
  report: NormalizedReport;
  insights: Insights;
  onRefresh: () => void;
  onRegenerate: () => void;
  regenerating?: boolean;
}) {
  const { overall, questions, violations } = report;
  const [selectedIndex, setSelectedIndex] = useState(0);

  const coverage = useMemo(() => getCoverage(questions), [questions]);
  const radarPoints = useMemo(() => getRadarPoints(overall, TECHNICAL_RADAR_AXES), [overall]);
  const blocks = useMemo(
    () =>
      HR_COMPETENCY_BLOCKS.map((b) => ({
        ...b,
        value: rawBlock(report.raw, b.key, b.key.replace(/([A-Z])/g, (m) => `_${m.toLowerCase()}`)),
      })),
    [report.raw],
  );
  const hasScores = radarPoints.length > 0;
  const showInsights = coverage.evaluated > 0;

  const refreshBtn = (
    <button
      type="button"
      onClick={onRefresh}
      className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
    >
      <RefreshCw size={13} /> Refresh evaluation
    </button>
  );
  const regenBtn = (
    <button
      type="button"
      onClick={onRegenerate}
      disabled={regenerating}
      className="inline-flex items-center gap-1.5 rounded-full bg-amber-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50 cursor-pointer"
    >
      <RefreshCw size={13} className={regenerating ? 'animate-spin' : ''} />
      {regenerating ? 'Regenerating…' : 'Regenerate evaluation'}
    </button>
  );

  return (
    <div className="space-y-6">
      {/* ── 1. Hiring Snapshot & Coverage ── */}
      <Section id="overview" eyebrow="Hiring Snapshot" title="Evaluation Status & Coverage">
        <div className="space-y-4">
          <EvaluationCoverage title="Response Coverage & Pipeline Status" coverage={coverage} />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <InteractiveRadarChart
              title="HR Competency Profile"
              points={radarPoints}
              expectedCount={TECHNICAL_RADAR_AXES.length}
              centerValue={overall.overallScore}
              centerLabel="Overall"
              emptyLabel="The candidate responses were recorded, but automated evaluation metrics are not currently available for this report."
              emptyAction={
                <div className="flex flex-wrap justify-center gap-2">
                  {refreshBtn}
                  {regenBtn}
                </div>
              }
            />
            <div className="flex flex-col justify-center gap-3">
              {hasScores ? (
                <div className="grid grid-cols-2 gap-3">
                  <ScoreGauge value={overall.overallScore} label="Overall HR Score" size={120} stroke={11} />
                  <ScoreGauge value={overall.confidenceScore} label="Confidence Score" size={120} stroke={11} delay={0.05} />
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center">
                  <p className="text-sm font-semibold text-slate-500">Evaluation Metrics In Progress</p>
                  <p className="mx-auto mt-1 max-w-xs text-xs text-slate-400">
                    Candidate answers are recorded. PrimeHire evaluation engine will populate competency scores upon completion.
                  </p>
                  <div className="mt-3 flex flex-wrap justify-center gap-2">
                    {refreshBtn}
                    {regenBtn}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-3 gap-3">
                <MetricCard label="Attempted" value={coverage.attempted} suffix={`of ${coverage.total}`} />
                <MetricCard label="Evaluated" value={coverage.evaluated} suffix={`of ${coverage.total}`} />
                <MetricCard label="Recordings" value={coverage.recordings} suffix={`of ${coverage.total}`} />
              </div>
            </div>
          </div>

          {showInsights && <InsightPanels insights={insights} />}
        </div>
      </Section>

      {/* ── 2. Competency Framework ── */}
      <Section
        id="competencies"
        eyebrow="Competency Profile"
        title="Behavioral Dimensions & Competency Framework"
        hint="As supplied by PrimeHire evaluation engine. Unavailable blocks are not scored — never inferred."
      >
        <CompetencyGrid title="Competency Blocks" blocks={blocks} />
      </Section>

      {/* ── 3. Behavioral Question Performance ── */}
      <Section id="questions" eyebrow="Question Performance" title="Behavioral Question Review">
        <div className="space-y-4">
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <ul className="divide-y divide-slate-100">
              {questions.map((q) => (
                <li key={q.key}>
                  <button
                    type="button"
                    onClick={() => setSelectedIndex(q.index - 1)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 cursor-pointer"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xs font-bold text-slate-600 tnum">
                      {q.index}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700">
                      {q.question || 'Untitled question'}
                    </span>
                    <span className="hidden shrink-0 items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 sm:inline-flex">
                      {q.isAttempted ? <CheckCircle2 size={11} /> : <Clock size={11} />}
                      {q.isAttempted ? 'Attempted' : q.isAttempted === false ? 'Not attempted' : 'Attempt unknown'}
                    </span>
                    <span className="hidden shrink-0 items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 md:inline-flex">
                      <Video size={11} />
                      {q.videoUrl ? 'Video available' : 'No video'}
                    </span>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        q.isGenerated ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                      }`}
                    >
                      {q.isGenerated
                        ? q.percentage !== null
                          ? `Evaluated · ${q.percentage}%`
                          : 'Evaluated'
                        : 'Evaluation pending'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <QuestionReview questions={questions} selectedIndex={selectedIndex} onSelect={setSelectedIndex} />
        </div>
      </Section>

      {/* ── 4. Interview Evidence ── */}
      <Section
        id="evidence"
        eyebrow="Interview Evidence"
        title="Transcripts & Recordings"
        hint="Candidate verbal responses. Videos play in the response review above."
      >
        <div className="space-y-3">
          {questions.map((q) =>
            q.transcript ? (
              <div key={q.key} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="mb-2 text-xs font-semibold text-slate-500">
                  Q{q.index}. {q.question}
                </p>
                <TranscriptPanel text={q.transcript} />
              </div>
            ) : null,
          )}
          {!questions.some((q) => q.transcript) && (
            <p className="rounded-2xl border border-slate-200 bg-white p-5 text-sm italic text-slate-400 shadow-sm">
              No transcripts in this report.
            </p>
          )}
        </div>
      </Section>

      {/* ── 5. Proctoring Audit ── */}
      {violations && (
        <Section id="proctoring" eyebrow="Session Integrity" title="Proctoring & Anti-Cheating Audit">
          <ProctoringAudit violations={violations} />
        </Section>
      )}

      {/* ── 6. Recruiter Decision Support ── */}
      <Section id="decision" eyebrow="Decision Support" title="Recruiter Decision Context & Follow-up Checklist">
        <RecruiterDecisionContext report={report} insights={insights} />
      </Section>
    </div>
  );
}
