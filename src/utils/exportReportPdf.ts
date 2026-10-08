import { jsPDF } from 'jspdf';
import type { RefObject } from 'react';
import type { NormalizedReport, Insights } from './normalizeReport';
import { getGrade, formatDate, shortId } from './normalizeReport';

/**
 * Robust, client-side PDF export for candidate evaluation reports.
 * Uses native vector PDF primitives for crisp typography, zero rendering lag,
 * and reliable multi-page support across all modern browsers.
 */
export async function exportReportToPdf(
  reportOrRef: NormalizedReport | RefObject<HTMLDivElement | null> | any,
  insightsOrFilename?: Insights | string,
  maybeFilename?: string
): Promise<void> {
  // Discriminate parameters: allows both exportReportToPdf(report, insights, filename)
  // and legacy exportReportToPdf(elementRef, filename).
  let report: NormalizedReport | null = null;
  let insights: Insights | null = null;
  let filename = 'interview-report.pdf';

  if (reportOrRef && 'meta' in reportOrRef && 'overall' in reportOrRef) {
    report = reportOrRef as NormalizedReport;
    if (typeof insightsOrFilename === 'object' && insightsOrFilename !== null) {
      insights = insightsOrFilename as Insights;
    }
    if (typeof maybeFilename === 'string') {
      filename = maybeFilename;
    }
  } else if (typeof insightsOrFilename === 'string') {
    filename = insightsOrFilename;
  }

  if (!report) {
    throw new Error('Candidate report data is required for PDF generation.');
  }

  const pdf = new jsPDF('p', 'mm', 'a4');
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const marginX = 14;
  const contentWidth = pageWidth - marginX * 2;
  const bottomLimit = pageHeight - 20;

  let y = 14;

  const checkPageBreak = (neededHeight: number) => {
    if (y + neededHeight > bottomLimit) {
      pdf.addPage();
      y = 16;
      drawPageHeader();
    }
  };

  const drawPageHeader = () => {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(148, 163, 184); // slate-400
    pdf.text('PRIMEHIRE CANDIDATE EVALUATION REPORT', marginX, y);
    pdf.text(
      `Job ID: ${shortId(report?.meta.jobId, 14)} | Candidate: #${shortId(report?.meta.candidateId, 10)}`,
      pageWidth - marginX,
      y,
      { align: 'right' }
    );
    y += 3;
    pdf.setDrawColor(226, 232, 240);
    pdf.setLineWidth(0.3);
    pdf.line(marginX, y, pageWidth - marginX, y);
    y += 8;
  };

  // ── Cover Banner (Page 1) ──────────────────────────────────────────────────
  pdf.setFillColor(15, 23, 42); // slate-900
  pdf.roundedRect(marginX, y, contentWidth, 32, 3, 3, 'F');

  // Accent stripe
  pdf.setFillColor(99, 102, 241); // indigo-500
  pdf.rect(marginX, y, 4, 32, 'F');

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(15);
  pdf.setTextColor(255, 255, 255);
  pdf.text('CANDIDATE PERFORMANCE EVALUATION', marginX + 8, y + 11);

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(203, 213, 225); // slate-300
  pdf.text('Automated AI Technical & Competency Assessment', marginX + 8, y + 18);

  const roundLabel = `${report.meta.roundType || 'INTERVIEW'} ROUND`.toUpperCase();
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8.5);
  pdf.setTextColor(129, 140, 248); // indigo-300
  pdf.text(roundLabel, marginX + 8, y + 25);

  const statusLabel = report.isEmpty ? 'NOT EVALUATED' : 'EVALUATED & VERIFIED';
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8.5);
  pdf.setTextColor(report.isEmpty ? 251 : 52, report.isEmpty ? 191 : 211, report.isEmpty ? 36 : 153);
  pdf.text(statusLabel, pageWidth - marginX - 8, y + 25, { align: 'right' });

  y += 38;

  // ── Metadata Grid ─────────────────────────────────────────────────────────
  pdf.setFillColor(248, 250, 252); // slate-50
  pdf.setDrawColor(226, 232, 240);
  pdf.setLineWidth(0.3);
  pdf.roundedRect(marginX, y, contentWidth, 22, 2, 2, 'FD');

  const metaCols = [
    { label: 'CANDIDATE ID', val: `#${shortId(report.meta.candidateId, 12)}` },
    { label: 'JOB ID / ASSESSMENT', val: shortId(report.meta.jobId, 16) },
    { label: 'SUBMITTED DATE', val: formatDate(report.meta.submittedAt) },
    { label: 'ROUND TYPE', val: report.meta.roundType || 'GENERAL' },
  ];

  const colWidth = contentWidth / 4;
  metaCols.forEach((col, idx) => {
    const colX = marginX + idx * colWidth + 4;
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7.5);
    pdf.setTextColor(100, 116, 139); // slate-500
    pdf.text(col.label, colX, y + 7);

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    pdf.setTextColor(15, 23, 42); // slate-900
    pdf.text(col.val, colX, y + 15);
  });

  y += 28;

  // ── Executive Score KPI Cards ─────────────────────────────────────────────
  const grade = getGrade(report.overall.overallScore);
  const commScore =
    report.overall.communication?.overall_score ??
    report.overall.communication?.overallScore ??
    null;

  const kpis = [
    {
      title: 'OVERALL SCORE',
      val: report.overall.overallScore !== null ? `${report.overall.overallScore}/100` : '—',
      sub: `Grade ${grade.letter}`,
      bgR: 240, bgG: 253, bgB: 244, // emerald-50
      borderR: 187, borderG: 247, borderB: 208,
      textR: 21, textG: 128, textB: 61,
    },
    {
      title: 'COMMUNICATION',
      val: commScore !== null ? `${commScore}/100` : '—',
      sub: report.overall.communication?.fluency ? `Fluency: ${report.overall.communication.fluency}%` : 'Analysis Score',
      bgR: 240, bgG: 249, bgB: 255, // sky-50
      borderR: 186, borderG: 230, borderB: 253,
      textR: 3, textG: 105, textB: 161,
    },
    {
      title: 'CONFIDENCE',
      val: report.overall.confidenceScore !== null ? `${report.overall.confidenceScore}/100` : '—',
      sub: 'Interview Presence',
      bgR: 250, bgG: 245, bgB: 255, // purple-50
      borderR: 233, borderG: 213, borderB: 255,
      textR: 126, textG: 34, textB: 206,
    },
    {
      title: 'TOTAL QUESTIONS',
      val: `${report.questions.length}`,
      sub: `${report.questions.filter(q => q.isGenerated).length} Evaluated`,
      bgR: 248, bgG: 250, bgB: 252, // slate-50
      borderR: 226, borderG: 232, borderB: 240,
      textR: 51, textG: 65, textB: 85,
    },
  ];

  const cardW = (contentWidth - 9) / 4;
  kpis.forEach((kpi, idx) => {
    const cardX = marginX + idx * (cardW + 3);
    pdf.setFillColor(kpi.bgR, kpi.bgG, kpi.bgB);
    pdf.setDrawColor(kpi.borderR, kpi.borderG, kpi.borderB);
    pdf.setLineWidth(0.3);
    pdf.roundedRect(cardX, y, cardW, 25, 2, 2, 'FD');

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7);
    pdf.setTextColor(100, 116, 139);
    pdf.text(kpi.title, cardX + 3.5, y + 6);

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(14);
    pdf.setTextColor(kpi.textR, kpi.textG, kpi.textB);
    pdf.text(kpi.val, cardX + 3.5, y + 15);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.5);
    pdf.setTextColor(100, 116, 139);
    pdf.text(kpi.sub, cardX + 3.5, y + 21);
  });

  y += 32;

  // ── Executive Summary & Insights ──────────────────────────────────────────
  if (insights?.summary) {
    checkPageBreak(30);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(10.5);
    pdf.setTextColor(15, 23, 42);
    pdf.text('Executive Summary', marginX, y);
    y += 5;

    pdf.setFillColor(248, 250, 252);
    pdf.setDrawColor(226, 232, 240);
    pdf.setLineWidth(0.3);

    const summaryLines = pdf.splitTextToSize(`"${insights.summary}"`, contentWidth - 8);
    const summaryBoxHeight = summaryLines.length * 4.5 + 8;

    pdf.roundedRect(marginX, y, contentWidth, summaryBoxHeight, 2, 2, 'FD');
    pdf.setFont('helvetica', 'italic');
    pdf.setFontSize(8.5);
    pdf.setTextColor(51, 65, 85);
    pdf.text(summaryLines, marginX + 4, y + 6);

    y += summaryBoxHeight + 8;
  }

  // ── Key Strengths & Areas for Improvement ─────────────────────────────────
  if (insights && (insights.strengths.length > 0 || insights.improvements.length > 0)) {
    checkPageBreak(40);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(10.5);
    pdf.setTextColor(15, 23, 42);
    pdf.text('Competency Highlights & Development Areas', marginX, y);
    y += 6;

    const boxW = (contentWidth - 4) / 2;

    // Strengths Box
    if (insights.strengths.length > 0) {
      pdf.setFillColor(240, 253, 244);
      pdf.setDrawColor(187, 247, 208);
      pdf.roundedRect(marginX, y, boxW, 36, 2, 2, 'FD');

      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(8.5);
      pdf.setTextColor(21, 128, 61);
      pdf.text('Key Strengths', marginX + 4, y + 6);

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(7.5);
      pdf.setTextColor(51, 65, 85);
      let sY = y + 12;
      insights.strengths.slice(0, 4).forEach(st => {
        const lines = pdf.splitTextToSize(`• ${st}`, boxW - 8);
        pdf.text(lines.slice(0, 2), marginX + 4, sY);
        sY += lines.length * 3.5 + 2;
      });
    }

    // Improvements Box
    if (insights.improvements.length > 0) {
      const impX = marginX + boxW + 4;
      pdf.setFillColor(254, 242, 242);
      pdf.setDrawColor(254, 202, 202);
      pdf.roundedRect(impX, y, boxW, 36, 2, 2, 'FD');

      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(8.5);
      pdf.setTextColor(185, 28, 28);
      pdf.text('Areas for Growth', impX + 4, y + 6);

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(7.5);
      pdf.setTextColor(51, 65, 85);
      let iY = y + 12;
      insights.improvements.slice(0, 4).forEach(imp => {
        const lines = pdf.splitTextToSize(`• ${imp}`, boxW - 8);
        pdf.text(lines.slice(0, 2), impX + 4, iY);
        iY += lines.length * 3.5 + 2;
      });
    }

    y += 42;
  }

  // ── Proctoring Audit Summary ──────────────────────────────────────────────
  if (report.violations && Object.keys(report.violations).length > 0) {
    checkPageBreak(25);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(10.5);
    pdf.setTextColor(15, 23, 42);
    pdf.text('Integrity & Proctoring Audit', marginX, y);
    y += 5;

    pdf.setFillColor(248, 250, 252);
    pdf.setDrawColor(226, 232, 240);
    pdf.setLineWidth(0.3);
    pdf.roundedRect(marginX, y, contentWidth, 18, 2, 2, 'FD');

    const vEntries = Object.entries(report.violations);
    const vColW = contentWidth / Math.min(vEntries.length, 5);
    vEntries.slice(0, 5).forEach(([key, val], idx) => {
      const vX = marginX + idx * vColW + 4;
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(7);
      pdf.setTextColor(100, 116, 139);
      pdf.text(key.replace(/_/g, ' ').toUpperCase(), vX, y + 6);

      const count = Number(val) || 0;
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(9);
      if (count > 0) {
        pdf.setTextColor(220, 38, 38);
        pdf.text(`${count} Incident${count > 1 ? 's' : ''}`, vX, y + 13);
      } else {
        pdf.setTextColor(22, 163, 74);
        pdf.text('Verified (0)', vX, y + 13);
      }
    });

    y += 24;
  }

  // ── Detailed Question Breakdown ───────────────────────────────────────────
  if (report.questions && report.questions.length > 0) {
    checkPageBreak(30);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(11);
    pdf.setTextColor(15, 23, 42);
    pdf.text('Question-by-Question Evaluation Breakdown', marginX, y);
    y += 6;

    report.questions.forEach((q, qIndex) => {
      const qGrade = getGrade(q.percentage);
      const questionLines = pdf.splitTextToSize(`Q${q.index || qIndex + 1}: ${q.question || 'Interview Question'}`, contentWidth - 45);
      const transcriptLines = q.transcript ? pdf.splitTextToSize(`Transcript: "${q.transcript}"`, contentWidth - 12) : [];
      const feedbackLines = q.feedback ? pdf.splitTextToSize(`Evaluation: ${q.feedback}`, contentWidth - 12) : [];

      const blockHeight = 14 + (questionLines.length * 4) + (transcriptLines.length > 0 ? transcriptLines.length * 3.5 + 4 : 0) + (feedbackLines.length > 0 ? feedbackLines.length * 3.5 + 4 : 0);

      checkPageBreak(Math.min(blockHeight, 75));

      pdf.setFillColor(255, 255, 255);
      pdf.setDrawColor(226, 232, 240);
      pdf.setLineWidth(0.3);
      pdf.roundedRect(marginX, y, contentWidth, blockHeight, 2, 2, 'FD');

      // Question title
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(8.5);
      pdf.setTextColor(15, 23, 42);
      pdf.text(questionLines, marginX + 4, y + 6);

      // Score Pill on the right
      const scoreStr = q.isGenerated ? `${q.obtainedScore ?? 0} / ${q.maxScore || 100} (${qGrade.letter})` : 'Pending';
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(8.5);
      pdf.setTextColor(qGrade.color === '#15803d' ? 21 : qGrade.color === '#dc2626' ? 220 : 37, qGrade.color === '#15803d' ? 128 : qGrade.color === '#dc2626' ? 38 : 99, qGrade.color === '#15803d' ? 61 : qGrade.color === '#dc2626' ? 38 : 235);
      pdf.text(scoreStr, pageWidth - marginX - 4, y + 6, { align: 'right' });

      let subY = y + 7 + questionLines.length * 4;

      // Spoken Transcript
      if (transcriptLines.length > 0) {
        pdf.setFont('helvetica', 'italic');
        pdf.setFontSize(7.5);
        pdf.setTextColor(71, 85, 105);
        pdf.text(transcriptLines, marginX + 6, subY);
        subY += transcriptLines.length * 3.5 + 3;
      }

      // Feedback / Evaluation
      if (feedbackLines.length > 0) {
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(7.5);
        pdf.setTextColor(30, 41, 59);
        pdf.text(feedbackLines, marginX + 6, subY);
      }

      y += blockHeight + 4;
    });
  }

  // ── Running Footers on All Pages ──────────────────────────────────────────
  const totalPages = pdf.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    pdf.setPage(i);
    pdf.setDrawColor(226, 232, 240);
    pdf.setLineWidth(0.3);
    pdf.line(marginX, pageHeight - 12, pageWidth - marginX, pageHeight - 12);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.5);
    pdf.setTextColor(148, 163, 184);
    pdf.text('PrimeHire Executive Portal • Confidential Evaluation Document', marginX, pageHeight - 7);
    pdf.text(`Page ${i} of ${totalPages}`, pageWidth - marginX, pageHeight - 7, { align: 'right' });
  }

  // Trigger browser download
  pdf.save(filename);
}
