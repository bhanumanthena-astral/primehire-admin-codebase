import { useEffect, useMemo, useRef, useState } from 'react';
import { normalizeReport, generateInsights } from '../../utils/normalizeReport';
import { tabsFor, roundKindOf } from '../../utils/reportConfig';
import {
  exportInteractivePdfReport,
  exportInteractiveHtmlReport,
  openPrintDialog,
} from '../../utils/exportReportPdf';
import ReportHeader from './ReportHeader';
import ReportTabs from './ReportTabs';
import TechnicalReport from './TechnicalReport';
import HRReport from './HRReport';
import BasicReport from './BasicReport';
import EmptyReportState from './EmptyReportState';
import ReportPrintView from './print/ReportPrintView';
import ShareModal from './ShareModal';
import type { Candidate, AssessmentProfile } from '../../types';

/**
 * Shared report shell: header + tab nav + round-aware renderer + print view.
 * Owns no data fetching — receives the raw report payload like ReportView did.
 */
export default function ReportShell({
  candidate,
  assessment,
  data,
  onClose,
  onRegenerate,
  regenerating = false,
}: {
  candidate: Candidate;
  assessment: AssessmentProfile;
  data: unknown;
  onClose: () => void;
  onRegenerate: () => void;
  regenerating?: boolean;
}) {
  const normalized = useMemo(() => normalizeReport(data), [data]);
  const report =
    normalized && normalized.meta.roundType === 'UNKNOWN'
      ? { ...normalized, meta: { ...normalized.meta, roundType: assessment.roundType } }
      : normalized;
  const insights = useMemo(() => generateInsights(report), [report]);

  const kind = roundKindOf(report?.meta.roundType);
  const tabs = useMemo(() => tabsFor(kind), [kind]);
  const [activeTab, setActiveTab] = useState(tabs[0]?.id ?? 'overview');
  const [exporting, setExporting] = useState(false);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const printRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Scroll-spy: highlight the tab whose section sits in the upper viewport band.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const ids = new Set(tabs.map((t) => `report-section-${t.id}`));
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            const id = (e.target as HTMLElement).dataset.reportSection;
            if (id) setActiveTab(id);
          }
        }
      },
      { rootMargin: '-25% 0px -65% 0px', threshold: 0 },
    );
    root.querySelectorAll('[data-report-section]').forEach((el) => {
      if (ids.has(el.id)) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [tabs, report]);

  if (!report) return null;

  const goTo = (id: string) => {
    setActiveTab(id);
    rootRef.current
      ?.querySelector(`#report-section-${CSS.escape(id)}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // 1. Interactive PDF Export with Clickable Links
  const handleExportPdf = async () => {
    setExporting(true);
    try {
      await exportInteractivePdfReport({
        report,
        candidate,
        assessment,
        insights,
      });
    } catch (err) {
      console.error('Failed to export PDF:', err);
    } finally {
      setExporting(false);
    }
  };

  // 2. Standalone Interactive HTML Export
  const handleExportHtml = () => {
    exportInteractiveHtmlReport({
      report,
      candidate,
      assessment,
      insights,
    });
  };

  // 3. Native Print / Save-as-PDF
  const handlePrint = () => {
    openPrintDialog();
  };

  const evaluated =
    candidate.reportStatus === 'GENERATED' || report.questions.some((q) => q.isGenerated);
  const statusLabel = evaluated ? 'Evaluated' : candidate.reportStatus || report.meta.status || 'Pending';

  return (
    <div ref={rootRef} className="space-y-4 bg-slate-50 px-4 py-6 sm:px-6 dark:bg-slate-950">
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <ReportHeader
            name={candidate.name}
            email={candidate.email}
            jobTitle={assessment.jobTitle}
            roundType={report.meta.roundType}
            submitted={report.meta.submittedAt}
            statusLabel={statusLabel}
            evaluated={evaluated}
            onExport={handleExportPdf}
            exporting={exporting}
            onExportHtml={handleExportHtml}
            onPrint={handlePrint}
            onShare={() => setIsShareOpen(true)}
            onClose={onClose}
          />
        </div>

        {report.questions.length === 0 ? (
          <EmptyReportState status={report.meta.status} />
        ) : (
          <>
            <ReportTabs tabs={tabs} active={activeTab} onChange={goTo} />
            {kind === 'HR' ? (
              <HRReport
                report={report}
                insights={insights}
                onRefresh={() => goTo('overview')}
                onRegenerate={onRegenerate}
                regenerating={regenerating}
              />
            ) : kind === 'BASIC' ? (
              <BasicReport report={report} insights={insights} />
            ) : (
              <TechnicalReport report={report} insights={insights} />
            )}
            <p className="pt-2 text-center text-[11px] text-slate-400">
              Job {report.meta.jobId ?? 'N/A'} · Candidate {report.meta.candidateId ?? 'N/A'} ·{' '}
              {report.meta.roundType} · Status {report.meta.status ?? 'N/A'}
            </p>
          </>
        )}
      </div>

      {/* Hidden off-screen print view used only for PDF generation */}
      <div style={{ position: 'absolute', left: -9999, top: 0 }}>
        <div ref={printRef}>
          <ReportPrintView report={report} insights={insights} />
        </div>
      </div>

      {/* Share Modal Dialog */}
      <ShareModal
        isOpen={isShareOpen}
        onClose={() => setIsShareOpen(false)}
        candidate={candidate}
        assessment={assessment}
        report={report}
      />
    </div>
  );
}
