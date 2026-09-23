import { useRef, useState, useMemo } from 'react';
import { Brain, MessageSquare, Activity } from 'lucide-react';
import { normalizeReport, generateInsights } from '../../utils/normalizeReport';
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
              <div className="space-y-3">
                {questions.map((q) => (
                  <div key={q.key} className="bg-white border border-slate-200 rounded-2xl p-5">
                    <p className="text-sm font-medium text-slate-800 mb-2">
                      Q{q.index}. {q.question}
                    </p>
                    <p className="text-sm text-slate-500">{q.transcript || 'No transcript.'}</p>
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'Transcript' && (
              <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
                {questions.map((q) => (
                  <div key={q.key}>
                    <p className="text-xs font-semibold text-slate-400 mb-1">
                      Q{q.index}. {q.question}
                    </p>
                    <p className="text-sm text-slate-600">{q.transcript || 'No transcript available.'}</p>
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'Proctoring' && <ProctoringAudit violations={violations} />}

            {activeTab === 'AI Summary' && <InsightPanels insights={insights} />}
          </>
        )}
      </div>

      {/* Hidden off-screen print view used only for PDF generation */}
      <div style={{ position: 'absolute', left: -9999, top: 0 }}>
        <div ref={printRef}>
          <ReportPrintView report={report} insights={insights} />
        </div>
      </div>
    </div>
  );
}
