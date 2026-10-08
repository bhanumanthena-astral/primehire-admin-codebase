import { useRef, useState, useMemo } from 'react';
import { toast } from 'sonner';
import { Brain, MessageSquare, Activity, Award, Mic, Copy, Video } from 'lucide-react';
import { normalizeReport, generateInsights, getGrade, relevancyColor } from '../../utils/normalizeReport';
import { exportReportToPdf } from '../../utils/exportReportPdf';
import Header from './Header';
import Tabs from './Tabs';
import GaugeCard from './GaugeCard';
import SkillRadar from './SkillRadar';
import CommunicationBreakdown from './CommunicationBreakdown';
import ScoreDistribution from './ScoreDistribution';
import ProctoringAudit from './ProctoringAudit';
import QuestionList from './QuestionList';
import VideoReview from './VideoReview';
import InsightPanels from './InsightPanels';
import EmptyReportState from './EmptyReportState';
import ReportPrintView from './print/ReportPrintView';

export default function ReportView({ data, roundType }: { data: unknown; roundType?: string }) {
  const normalized = useMemo(() => normalizeReport(data), [data]);
  // Mock/simulated candidates carry no round_type — fall back to the
  // assessment's round type so the header badge stays accurate.
  const report =
    normalized && roundType && normalized.meta.roundType === 'UNKNOWN'
      ? { ...normalized, meta: { ...normalized.meta, roundType } }
      : normalized;
  const insights = useMemo(() => generateInsights(report), [report]);
  const [activeTab, setActiveTab] = useState('Overview');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [exporting, setExporting] = useState(false);
  const printRef = useRef<HTMLDivElement | null>(null);

  if (!report) return null;
  const { overall, questions, violations, isEmpty } = report;
  const commScore = overall.communication?.overall_score ?? overall.communication?.overallScore ?? null;

  const handleExport = async () => {
    setExporting(true);
    try {
      await exportReportToPdf(printRef, `interview-report-${report.meta.roundType}.pdf`);
    } catch (err: any) {
      toast.error(`PDF export failed: ${err?.message || 'could not render report'}`);
    } finally {
      setExporting(false);
    }
  };

  const navigateQuestion = (dir: number) => {
    setSelectedIndex((i) => Math.min(Math.max(i + dir, 0), questions.length - 1));
  };

  return (
    <div className="bg-slate-50 py-6 px-4 sm:px-6 rounded-2xl">
      <div className="max-w-7xl mx-auto">
        <Header report={report} insights={insights} onExport={handleExport} exporting={exporting} />

        {isEmpty ? (
          <EmptyReportState status={report.meta.status} />
        ) : (
          <>
            <Tabs active={activeTab} onChange={setActiveTab} />

            {activeTab === 'Overview' && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                  <GaugeCard
                    icon={Brain}
                    iconColor="#4f46e5"
                    title="Technical Proficiency"
                    subtitle="Domain knowledge & problem solving"
                    score={overall.overallScore}
                    description="Reflects understanding of core technical concepts across all questions."
                    delay={0}
                  />
                  {overall.communication && (
                    <GaugeCard
                      icon={MessageSquare}
                      iconColor="#0891b2"
                      title="Communication"
                      subtitle="Fluency, grammar & articulation"
                      score={commScore}
                      description="Clarity and structure of verbal responses."
                      delay={0.05}
                    />
                  )}
                  {overall.confidenceScore !== null && (
                    <GaugeCard
                      icon={Activity}
                      iconColor="#9333ea"
                      title="Interview Presence"
                      subtitle="Confidence & delivery"
                      score={overall.confidenceScore}
                      description="Composure and engagement throughout the interview."
                      delay={0.1}
                    />
                  )}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                  <SkillRadar overall={overall} delay={0.15} />
                  {overall.communication && <CommunicationBreakdown communication={overall.communication} delay={0.2} />}
                  <ScoreDistribution overall={overall} delay={0.25} />
                </div>

                <ProctoringAudit violations={violations} delay={0.3} />

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                  <QuestionList questions={questions} selectedIndex={selectedIndex} onSelect={setSelectedIndex} delay={0.35} />
                  <VideoReview questions={questions} selectedIndex={selectedIndex} onNavigate={navigateQuestion} delay={0.4} />
                </div>

                <InsightPanels insights={insights} delay={0.45} />
              </div>
            )}

            {activeTab === 'Question Analysis' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <QuestionList questions={questions} selectedIndex={selectedIndex} onSelect={setSelectedIndex} />
                <VideoReview questions={questions} selectedIndex={selectedIndex} onNavigate={navigateQuestion} />
              </div>
            )}

            {activeTab === 'Detailed Feedback' && (
              <div className="space-y-4">
                {questions.map((q) => {
                  const grade = getGrade(q.percentage);
                  const hasRemarks = !!(q.feedback || q.message || (q.strengths && q.strengths.length > 0) || (q.weaknesses && q.weaknesses.length > 0));
                  return (
                    <div key={q.key} className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-sm">
                      {/* Question Header & Performance Badges */}
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 border-b border-slate-100 pb-3">
                        <div className="space-y-1">
                          <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-600 font-mono">
                            Question {q.index} Evaluation
                          </span>
                          <h4 className="text-sm font-semibold text-slate-900 leading-snug">
                            {q.question}
                          </h4>
                        </div>
                        {q.percentage !== null && (
                          <div className="flex items-center gap-2 self-start shrink-0">
                            <span
                              className="text-xs font-bold px-2.5 py-1 rounded-full border font-mono"
                              style={{ color: grade.color, backgroundColor: grade.bg, borderColor: `${grade.color}30` }}
                            >
                              Grade {grade.letter} ({q.percentage}%)
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Score metrics strip */}
                      <div className="flex flex-wrap items-center gap-3 text-xs">
                        {q.obtainedScore !== null && (
                          <div className="bg-slate-50 border border-slate-200/80 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
                            <span className="text-slate-500 font-medium">Obtained Score:</span>
                            <span className="font-bold text-slate-800">{q.obtainedScore} / {q.maxScore}</span>
                          </div>
                        )}
                        {q.technicalScore !== null && (
                          <div className="bg-indigo-50/60 border border-indigo-200/60 px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-indigo-900">
                            <span className="text-indigo-600 font-medium">Technical Score:</span>
                            <span className="font-bold">{q.technicalScore}</span>
                          </div>
                        )}
                        {q.relevancy && (
                          <div
                            className="px-3 py-1.5 rounded-lg border flex items-center gap-1.5 font-semibold"
                            style={{
                              color: relevancyColor[q.relevancy]?.color || '#475569',
                              backgroundColor: relevancyColor[q.relevancy]?.bg || '#f1f5f9',
                              borderColor: `${relevancyColor[q.relevancy]?.color || '#cbd5e1'}30`,
                            }}
                          >
                            <span className="opacity-80 font-medium">Relevance:</span>
                            <span>{q.relevancy}</span>
                          </div>
                        )}
                        {q.confidenceScore !== null && (
                          <div className="bg-purple-50/60 border border-purple-200/60 px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-purple-900">
                            <span className="text-purple-600 font-medium">Confidence:</span>
                            <span className="font-bold">{q.confidenceScore}</span>
                          </div>
                        )}
                      </div>

                      {/* Question Communication Breakdown if present */}
                      {q.communication && (
                        <div className="bg-slate-50 border border-slate-200/60 p-3.5 rounded-xl space-y-1.5">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                            Communication Criteria Breakdown
                          </span>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                            {q.communication.fluency !== undefined && (
                              <div className="bg-white p-2 rounded-lg border border-slate-200/60">
                                <span className="text-slate-500 text-[10px] block">Fluency</span>
                                <span className="font-bold text-slate-800">{q.communication.fluency}</span>
                              </div>
                            )}
                            {q.communication.grammar !== undefined && (
                              <div className="bg-white p-2 rounded-lg border border-slate-200/60">
                                <span className="text-slate-500 text-[10px] block">Grammar</span>
                                <span className="font-bold text-slate-800">{q.communication.grammar}</span>
                              </div>
                            )}
                            {q.communication.vocabulary !== undefined && (
                              <div className="bg-white p-2 rounded-lg border border-slate-200/60">
                                <span className="text-slate-500 text-[10px] block">Vocabulary</span>
                                <span className="font-bold text-slate-800">{q.communication.vocabulary}</span>
                              </div>
                            )}
                            {q.communication.pronunciation !== undefined && (
                              <div className="bg-white p-2 rounded-lg border border-slate-200/60">
                                <span className="text-slate-500 text-[10px] block">Pronunciation</span>
                                <span className="font-bold text-slate-800">{q.communication.pronunciation}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Evaluator Feedback & Remarks */}
                      <div className="space-y-2">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                          <Award className="w-3.5 h-3.5 text-indigo-600" /> Detailed Evaluator Remarks
                        </span>
                        {hasRemarks ? (
                          <div className="space-y-2">
                            {q.feedback && (
                              <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200/60 p-3.5 rounded-xl leading-relaxed">
                                {q.feedback}
                              </p>
                            )}
                            {q.message && q.message !== q.feedback && (
                              <p className="text-sm text-slate-600 bg-slate-50/70 border border-slate-200/50 p-3 rounded-xl leading-relaxed">
                                {q.message}
                              </p>
                            )}
                            {q.strengths && q.strengths.length > 0 && (
                              <div className="bg-emerald-50/60 border border-emerald-200/60 p-3 rounded-xl space-y-1">
                                <span className="text-[10px] font-bold text-emerald-800 uppercase">Observed Strengths</span>
                                <ul className="list-disc list-inside text-xs text-emerald-900 space-y-0.5">
                                  {q.strengths.map((s, idx) => <li key={idx}>{s}</li>)}
                                </ul>
                              </div>
                            )}
                            {q.weaknesses && q.weaknesses.length > 0 && (
                              <div className="bg-rose-50/60 border border-rose-200/60 p-3 rounded-xl space-y-1">
                                <span className="text-[10px] font-bold text-rose-800 uppercase">Improvement Areas</span>
                                <ul className="list-disc list-inside text-xs text-rose-900 space-y-0.5">
                                  {q.weaknesses.map((w, idx) => <li key={idx}>{w}</li>)}
                                </ul>
                              </div>
                            )}
                          </div>
                        ) : (
                          <p className="text-xs text-slate-400 italic bg-slate-50 p-3 rounded-xl border border-slate-200/50">
                            No specific evaluator remarks recorded for this question. Overall scores and criteria above reflect candidate performance.
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {activeTab === 'Transcript' && (
              <div className="space-y-4">
                {questions.map((q) => {
                  const copyTranscriptText = (text: string) => {
                    navigator.clipboard.writeText(text);
                    toast.success(`Question ${q.index} transcript copied to clipboard!`);
                  };
                  return (
                    <div key={q.key} className="bg-white border border-slate-200 rounded-2xl p-6 space-y-3 shadow-sm">
                      <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                        <span className="text-xs font-bold text-indigo-600 font-mono uppercase">
                          Question {q.index}
                        </span>
                        {q.transcript && (
                          <button
                            onClick={() => copyTranscriptText(q.transcript!)}
                            className="text-xs text-slate-500 hover:text-indigo-600 flex items-center gap-1 transition cursor-pointer"
                            title="Copy transcript"
                          >
                            <Copy className="w-3.5 h-3.5" /> Copy
                          </button>
                        )}
                      </div>
                      <p className="text-sm font-semibold text-slate-900">
                        {q.question}
                      </p>
                      {q.transcript ? (
                        <div className="bg-slate-50 border border-slate-200/70 rounded-xl p-4 space-y-1.5">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                            <Mic className="w-3.5 h-3.5 text-indigo-500" /> Verbatim Candidate Speech / Response
                          </span>
                          <p className="text-sm text-slate-700 leading-relaxed italic whitespace-pre-wrap">
                            &ldquo;{q.transcript}&rdquo;
                          </p>
                        </div>
                      ) : (
                        <div className="bg-slate-50/60 border border-slate-200/50 rounded-xl p-4 text-center text-xs text-slate-400 italic">
                          No spoken transcript captured for this question.
                        </div>
                      )}
                      {q.videoUrl && (
                        <div className="pt-1">
                          <a
                            href={q.videoUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-800 hover:underline"
                          >
                            <Video className="w-3.5 h-3.5" /> Watch Candidate Recording
                          </a>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {activeTab === 'Proctoring' && <ProctoringAudit violations={violations} />}

            {activeTab === 'AI Summary' && <InsightPanels insights={insights} />}
          </>
        )}
      </div>

      {/* Off-screen (but rendered) print view used only for PDF generation */}
      <div style={{ position: 'fixed', left: 0, top: 0, opacity: 0, pointerEvents: 'none', zIndex: -1 }}>
        <div ref={printRef}>
          <ReportPrintView report={report} insights={insights} />
        </div>
      </div>
    </div>
  );
}
