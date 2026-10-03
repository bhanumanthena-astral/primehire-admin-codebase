import { useMemo, useState } from 'react';
import { Gauge, MessagesSquare, Brain, Activity } from 'lucide-react';
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
import {
  getAggregates,
  getCoverage,
  getRadarPoints,
  deriveTopic,
  formatScore,
} from '../../utils/reportMetrics';
import { TECHNICAL_RADAR_AXES, COMM_RADAR_AXES, TECHNICAL_KPIS } from '../../utils/reportConfig';

const KPI_ICONS = [Brain, MessagesSquare, Activity];

/** TECHNICAL round: recruiter decision-support, skill profile, depth, comms, evidence. */
export default function TechnicalReport({
  report,
  insights,
}: {
  report: NormalizedReport;
  insights: Insights;
}) {
  const { overall, questions, violations } = report;
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [commMetric, setCommMetric] = useState<string | null>(null);

  const radarPoints = useMemo(() => getRadarPoints(overall, TECHNICAL_RADAR_AXES), [overall]);
  const commPoints = useMemo(() => getRadarPoints(overall, COMM_RADAR_AXES), [overall]);
  const aggregates = useMemo(() => getAggregates(questions), [questions]);
  const coverage = useMemo(() => getCoverage(questions), [questions]);
  const comm = overall.communication || {};
  const commScore = comm.overall_score ?? comm.overallScore ?? null;

  const depthGroups = useMemo(() => {
    const map = new Map<string, typeof questions>();
    for (const q of questions) {
      const label = deriveTopic(q.question).label;
      if (!map.has(label)) map.set(label, []);
      map.get(label)!.push(q);
    }
    return [...map.entries()];
  }, [questions]);

  const kpiValues = TECHNICAL_KPIS.map((k) => ({ ...k, value: k.get(overall) ?? null }));

  return (
    <div className="space-y-6">
      {/* ── 1. Hiring Snapshot: Executive Summary & Performance Profile ── */}
      <Section id="overview" eyebrow="Hiring Snapshot" title="Executive Performance Overview">
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <InteractiveRadarChart
              title="Technical Skill Profile"
              points={radarPoints}
              expectedCount={TECHNICAL_RADAR_AXES.length}
              centerValue={overall.overallScore}
              centerLabel="Technical"
              emptyLabel="No scored dimensions are available in this report."
            />
            <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-800">Overall Technical Score</p>
                  <p className="mt-1 max-w-md text-xs leading-relaxed text-slate-500">{insights.summary}</p>
                </div>
                <ScoreGauge value={overall.overallScore} label="" hint="" size={120} stroke={11} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                {kpiValues.map((k, i) => {
                  const Icon = KPI_ICONS[i % KPI_ICONS.length];
                  return (
                    <MetricCard
                      key={k.key}
                      icon={Icon}
                      label={k.label}
                      value={k.value}
                      sub={k.hint}
                      delay={i * 0.05}
                    />
                  );
                })}
              </div>
              <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
                <Gauge size={12} />
                Official PrimeHire scores · {coverage.evaluated} of {coverage.total} questions evaluated
              </p>
            </div>
          </div>

          {/* Hiring Signals: Strengths, Risk Signals, Recruiter Verification Prompts */}
          <InsightPanels insights={insights} />
        </div>
      </Section>

      {/* ── 2. Competency Profile & Depth ── */}
      <Section
        id="profile"
        eyebrow="Competency Profile"
        title="Technical Depth & Question Topics"
        hint="Derived grouping from question text. Scores reflect actual per-question candidate evaluations."
        action={
          <div className="flex flex-wrap gap-1.5 text-[11px] font-semibold text-slate-500">
            <span className="rounded-full bg-slate-100 px-2.5 py-1">Evaluated {aggregates.evaluated}/{questions.length}</span>
            {aggregates.avg !== null && (
              <span className="rounded-full bg-slate-100 px-2.5 py-1">Derived avg {aggregates.avg}</span>
            )}
            {aggregates.high !== null && (
              <span className="rounded-full bg-slate-100 px-2.5 py-1">
                High {aggregates.high} · Low {aggregates.low}
              </span>
            )}
            {aggregates.weighted !== null && (
              <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-800">
                Derived weighted {aggregates.weighted}
              </span>
            )}
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {depthGroups.map(([topic, qs]) => (
              <div key={topic} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-semibold text-slate-800">{topic}</p>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                    Topic Grouping
                  </span>
                </div>
                <div className="space-y-3">
                  {qs.map((q) => (
                    <ScoreBar
                      key={q.key}
                      label={`Q${q.index} — ${q.question || 'Untitled question'}`}
                      value={q.percentage}
                      right={
                        q.isGenerated
                          ? `${formatScore(q.obtainedScore)} / ${q.maxScore} pts`
                          : 'Not evaluated'
                      }
                      compact
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Communication Profile */}
          {commPoints.length > 0 && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 pt-2">
              <InteractiveRadarChart
                title="Communication Competency Radar"
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
                <div className="col-span-2">
                  <ScoreBar label="Delivery Confidence" value={overall.confidenceScore} right="Assessment delivery score" />
                </div>
              </div>
            </div>
          )}
        </div>
      </Section>

      {/* ── 3. Question Performance & Interactive Review ── */}
      <Section id="questions" eyebrow="Question Performance" title="Detailed Question Analysis">
        <QuestionReview questions={questions} selectedIndex={selectedIndex} onSelect={setSelectedIndex} />
      </Section>

      {/* ── 4. Interview Evidence ── */}
      <Section
        id="evidence"
        eyebrow="Interview Evidence"
        title="Spoken Transcripts & Recordings"
        hint="Recorded candidate answers. Videos play in the question review above."
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

      {/* ── 5. Proctoring & Session Integrity ── */}
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
