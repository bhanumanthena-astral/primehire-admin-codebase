import { useMemo, useState } from 'react';
import Section from './Section';
import ScoreGauge from './ScoreGauge';
import MetricCard from './MetricCard';
import ScoreBar from './ScoreBar';
import InteractiveRadarChart from './InteractiveRadarChart';
import ProctoringAudit from './ProctoringAudit';
import QuestionReview from './QuestionReview';
import TranscriptPanel from './TranscriptPanel';
import InsightPanels from './InsightPanels';
import RecruiterDecisionContext from './RecruiterDecisionContext';
import type { NormalizedReport, Insights } from '../../utils/normalizeReport';
import { getAggregates, getCoverage, getRadarPoints, formatScore } from '../../utils/reportMetrics';
import { COMM_RADAR_AXES, BASIC_KPIS } from '../../utils/reportConfig';

/** BASIC round: recruiter decision-support, overall + communication-first visualization. */
export default function BasicReport({
  report,
  insights,
}: {
  report: NormalizedReport;
  insights: Insights;
}) {
  const { overall, questions, violations } = report;
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [commMetric, setCommMetric] = useState<string | null>(null);

  const commPoints = useMemo(() => getRadarPoints(overall, COMM_RADAR_AXES), [overall]);
  const aggregates = useMemo(() => getAggregates(questions), [questions]);
  const coverage = useMemo(() => getCoverage(questions), [questions]);
  const comm = overall.communication || {};
  const commScore = comm.overall_score ?? comm.overallScore ?? null;
  const kpis = BASIC_KPIS.map((k) => ({ ...k, value: k.get(overall) ?? null }));

  return (
    <div className="space-y-6">
      {/* ── 1. Hiring Snapshot ── */}
      <Section id="overview" eyebrow="Hiring Snapshot" title="Executive Performance Overview">
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="flex items-center justify-around gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              {kpis.map((k, i) => (
                <ScoreGauge key={k.key} value={k.value} label={k.label} hint={k.hint} delay={i * 0.05} />
              ))}
            </div>
            <div className="flex flex-col justify-center gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-sm font-semibold text-slate-800">Executive Summary</p>
              <p className="text-xs leading-relaxed text-slate-500">{insights.summary}</p>
              <p className="text-[11px] text-slate-400">
                Official PrimeHire scores · {coverage.evaluated} of {coverage.total} questions evaluated
              </p>
            </div>
          </div>

          {commPoints.length > 0 && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <InteractiveRadarChart
                title="Communication Radar"
                points={commPoints}
                expectedCount={COMM_RADAR_AXES.length}
                centerValue={commScore}
                centerLabel="Communication"
                emptyLabel="No communication sub-metrics in this report."
                onSelect={setCommMetric}
              />
              <div className="grid grid-cols-2 content-start gap-3">
                {[
                  { label: 'Fluency', value: comm.fluency ?? null },
                  { label: 'Grammar', value: comm.grammar ?? null },
                  { label: 'Pronunciation', value: comm.pronunciation ?? null },
                  { label: 'Vocabulary', value: comm.vocabulary ?? null },
                ]
                  .filter((m) => m.value !== null)
                  .map((m, i) => (
                    <MetricCard
                      key={m.label}
                      label={m.label}
                      value={m.value}
                      delay={i * 0.05}
                      selected={commMetric === m.label.toLowerCase()}
                      onClick={() => setCommMetric((s) => (s === m.label.toLowerCase() ? null : m.label.toLowerCase()))}
                    />
                  ))}
              </div>
            </div>
          )}

          <InsightPanels insights={insights} />
        </div>
      </Section>

      {/* ── 2. Question Performance ── */}
      <Section
        id="questions"
        eyebrow="Question Performance"
        title="Interactive Question Analysis"
        action={
          aggregates.avg !== null ? (
            <div className="flex flex-wrap gap-1.5 text-[11px] font-semibold text-slate-500">
              <span className="rounded-full bg-slate-100 px-2.5 py-1">Derived avg {aggregates.avg}</span>
              <span className="rounded-full bg-slate-100 px-2.5 py-1">
                High {aggregates.high} · Low {aggregates.low}
              </span>
            </div>
          ) : undefined
        }
      >
        <div className="space-y-4">
          <QuestionReview questions={questions} selectedIndex={selectedIndex} onSelect={setSelectedIndex} />

          {questions.length > 0 && (
            <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold text-slate-500 mb-2">Question Score Summary</p>
              {questions.map((q) => (
                <ScoreBar
                  key={q.key}
                  label={`Q${q.index} — ${q.question || 'Untitled question'}`}
                  value={q.percentage}
                  right={q.isGenerated ? `${formatScore(q.obtainedScore)} / ${q.maxScore} pts` : 'Not evaluated'}
                  compact
                />
              ))}
            </div>
          )}
        </div>
      </Section>

      {/* ── 3. Evidence ── */}
      <Section id="evidence" eyebrow="Interview Evidence" title="Transcripts & Recordings">
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

      {/* ── 4. Proctoring ── */}
      {violations && (
        <Section id="proctoring" eyebrow="Session Integrity" title="Proctoring & Anti-Cheating Audit">
          <ProctoringAudit violations={violations} />
        </Section>
      )}

      {/* ── 5. Recruiter Decision Support ── */}
      <Section id="decision" eyebrow="Decision Support" title="Recruiter Decision Context & Follow-up Checklist">
        <RecruiterDecisionContext report={report} insights={insights} />
      </Section>
    </div>
  );
}
