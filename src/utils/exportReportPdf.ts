import { jsPDF } from 'jspdf';
import type { RefObject } from 'react';
import type { NormalizedReport, Insights, NormalizedQuestion } from './normalizeReport';
import { getGrade, formatDate } from './normalizeReport';
import { toast } from 'sonner';

export interface ExportReportOptions {
  report: NormalizedReport;
  candidate: {
    id?: string;
    name: string;
    email: string;
    reportStatus?: string;
  };
  assessment: {
    jobTitle: string;
    roundType?: string;
  };
  insights?: Insights | null;
  filename?: string;
}

/**
 * Generates and downloads a high-fidelity, interactive vector PDF report.
 * Features:
 * - 100% vector typography and graphics (crisp at any zoom, tiny file size)
 * - Clickable interactive hyperlinks (Candidate email, Question video responses, Portal links)
 * - Sky Blue executive branding with score progress indicators
 * - Multi-page pagination with clean headers, footers, and page numbers
 */
export async function exportInteractivePdfReport({
  report,
  candidate,
  assessment,
  insights,
  filename,
}: ExportReportOptions): Promise<void> {
  const round = report.meta.roundType || assessment.roundType || 'INTERVIEW';
  const cleanName = candidate.name.replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeFilename = filename || `interview-report-${cleanName}-${round}.pdf`;

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 14;
  const contentWidth = pageWidth - margin * 2; // 182mm

  // Theme Colors
  const skyDark = [2, 132, 199];      // #0284c7 (Sky 600)
  const skyMedium = [14, 165, 233];   // #0ea5e9 (Sky 500)
  const skyLight = [240, 249, 255];   // #f0f9ff (Sky 50)
  const skyBorder = [186, 230, 253];  // #bae6fd (Sky 200)
  const slateText = [15, 23, 42];     // #0f172a
  const slateMuted = [100, 116, 139]; // #64748b
  const slateBorder = [226, 232, 240];// #e2e8f0
  const emerald = [22, 163, 74];      // #16a34a
  const amber = [217, 119, 6];        // #d97706
  const rose = [225, 29, 72];         // #e11d48

  let currentY = 16;

  // Helper to ensure space or trigger page break
  const checkPageBreak = (neededHeight: number): void => {
    if (currentY + neededHeight > pageHeight - 20) {
      doc.addPage();
      currentY = 16;
      drawPageHeader();
    }
  };

  const drawPageHeader = () => {
    // Subtle top accent line on subsequent pages
    doc.setFillColor(skyDark[0], skyDark[1], skyDark[2]);
    doc.rect(0, 0, pageWidth, 3, 'F');

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(slateMuted[0], slateMuted[1], slateMuted[2]);
    doc.text(`PrimeHire · Candidate Report: ${candidate.name} (${assessment.jobTitle})`, margin, 10);
    doc.setDrawColor(slateBorder[0], slateBorder[1], slateBorder[2]);
    doc.setLineWidth(0.3);
    doc.line(margin, 12, pageWidth - margin, 12);
  };

  // ── FIRST PAGE BRAND HEADER ────────────────────────────────────────────────
  // Top Sky Blue Brand Banner
  doc.setFillColor(skyDark[0], skyDark[1], skyDark[2]);
  doc.rect(0, 0, pageWidth, 6, 'F');

  // Brand Name & Tagline
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(skyDark[0], skyDark[1], skyDark[2]);
  doc.text('PRIMEHIRE  |  VILS AI EVALUATION ENGINE', margin, currentY);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(slateMuted[0], slateMuted[1], slateMuted[2]);
  doc.text('Automated Intelligence & Candidate Competency Assessment', margin, currentY + 4);

  currentY += 10;

  // Title Box
  doc.setFillColor(skyLight[0], skyLight[1], skyLight[2]);
  doc.setDrawColor(skyBorder[0], skyBorder[1], skyBorder[2]);
  doc.setLineWidth(0.5);
  doc.roundedRect(margin, currentY, contentWidth, 26, 3, 3, 'FD');

  // Candidate Name & Headline
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(slateText[0], slateText[1], slateText[2]);
  doc.text(candidate.name || 'Candidate Report', margin + 6, currentY + 8);

  // Clickable Candidate Email
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(skyDark[0], skyDark[1], skyDark[2]);
  if (candidate.email) {
    doc.textWithLink(candidate.email, margin + 6, currentY + 14, { url: `mailto:${candidate.email}` });
  }

  // Meta line (Job Title, Round, Submission)
  doc.setFontSize(8);
  doc.setTextColor(slateMuted[0], slateMuted[1], slateMuted[2]);
  const metaText = `${assessment.jobTitle}  ·  ${round} Round  ·  Submitted: ${formatDate(report.meta.submittedAt)}`;
  doc.text(metaText, margin + 6, currentY + 20);

  // Status Badge on right of banner
  const isEvaluated = candidate.reportStatus === 'GENERATED' || report.questions.some((q) => q.isGenerated);
  const statusLabel = isEvaluated ? 'EVALUATED' : (report.meta.status || 'PENDING').toUpperCase();
  const badgeColor = isEvaluated ? emerald : amber;
  
  doc.setFillColor(badgeColor[0], badgeColor[1], badgeColor[2]);
  doc.roundedRect(pageWidth - margin - 36, currentY + 6, 30, 7, 2, 2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(255, 255, 255);
  doc.text(statusLabel, pageWidth - margin - 21, currentY + 10.5, { align: 'center' });

  currentY += 32;

  // ── EXECUTIVE SUMMARY & SCORE GAUGES ────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(slateText[0], slateText[1], slateText[2]);
  doc.text('EXECUTIVE PERFORMANCE OVERVIEW', margin, currentY);

  currentY += 4;

  // Overall Score Card (Left) & Metrics Breakdown (Right)
  const scoreCardWidth = 52;
  const metricsWidth = contentWidth - scoreCardWidth - 6;

  // Overall Score Card Box
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(slateBorder[0], slateBorder[1], slateBorder[2]);
  doc.setLineWidth(0.4);
  doc.roundedRect(margin, currentY, scoreCardWidth, 48, 3, 3, 'FD');

  const overallScore = report.overall.overallScore;
  const grade = getGrade(overallScore);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(slateMuted[0], slateMuted[1], slateMuted[2]);
  doc.text('OVERALL SCORE', margin + scoreCardWidth / 2, currentY + 7, { align: 'center' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(26);
  doc.setTextColor(skyDark[0], skyDark[1], skyDark[2]);
  doc.text(overallScore !== null ? `${overallScore}` : 'N/A', margin + scoreCardWidth / 2, currentY + 20, { align: 'center' });

  doc.setFontSize(9);
  doc.setTextColor(slateMuted[0], slateMuted[1], slateMuted[2]);
  doc.text('out of 100', margin + scoreCardWidth / 2, currentY + 26, { align: 'center' });

  // Grade Chip
  doc.setFillColor(skyLight[0], skyLight[1], skyLight[2]);
  doc.setDrawColor(skyBorder[0], skyBorder[1], skyBorder[2]);
  doc.roundedRect(margin + 8, currentY + 31, scoreCardWidth - 16, 11, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(skyDark[0], skyDark[1], skyDark[2]);
  doc.text(`Grade: ${grade.letter}`, margin + scoreCardWidth / 2, currentY + 38, { align: 'center' });

  // Metrics Breakdown Box (Right)
  const metricsX = margin + scoreCardWidth + 6;
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(slateBorder[0], slateBorder[1], slateBorder[2]);
  doc.roundedRect(metricsX, currentY, metricsWidth, 48, 3, 3, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(slateText[0], slateText[1], slateText[2]);
  doc.text('Core Competencies & Evaluation Metrics', metricsX + 6, currentY + 6);

  // Bar indicators
  const commObj = report.overall.communication || {};
  const commScore = commObj.overall_score ?? commObj.overallScore ?? null;
  const metricsList = [
    { label: 'Technical Accuracy', val: report.overall.overallScore },
    { label: 'Communication Delivery', val: commScore },
    { label: 'Candidate Confidence', val: report.overall.confidenceScore },
    { label: 'Fluency & Clarity', val: commObj.fluency ?? null },
    { label: 'Grammar & Vocabulary', val: commObj.grammar ?? commObj.vocabulary ?? null },
  ];

  let barY = currentY + 11;
  const barMaxW = metricsWidth - 56;

  metricsList.forEach((m) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(slateText[0], slateText[1], slateText[2]);
    doc.text(m.label, metricsX + 6, barY + 3);

    // Track
    const trackX = metricsX + 46;
    doc.setFillColor(241, 245, 249);
    doc.roundedRect(trackX, barY, barMaxW, 3.5, 1, 1, 'F');

    // Fill
    if (m.val !== null && m.val !== undefined && m.val > 0) {
      const fillW = Math.min(barMaxW, (m.val / 100) * barMaxW);
      doc.setFillColor(skyDark[0], skyDark[1], skyDark[2]);
      doc.roundedRect(trackX, barY, fillW, 3.5, 1, 1, 'F');
    }

    // Value
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(slateMuted[0], slateMuted[1], slateMuted[2]);
    doc.text(m.val !== null && m.val !== undefined ? `${Math.round(m.val)}%` : 'N/A', metricsX + metricsWidth - 7, barY + 3, { align: 'right' });

    barY += 7;
  });

  currentY += 54;

  // ── AI INSIGHTS & STRENGTHS ────────────────────────────────────────────────
  if (insights && (insights.strengths?.length > 0 || insights.improvements?.length > 0)) {
    checkPageBreak(38);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(slateText[0], slateText[1], slateText[2]);
    doc.text('EVALUATOR HIGHLIGHTS & INSIGHTS', margin, currentY);
    currentY += 4;

    const halfW = (contentWidth - 4) / 2;

    // Strengths Box
    doc.setFillColor(240, 253, 244);
    doc.setDrawColor(187, 247, 208);
    doc.roundedRect(margin, currentY, halfW, 26, 2, 2, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(emerald[0], emerald[1], emerald[2]);
    doc.text('Strength Signals', margin + 5, currentY + 5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(slateText[0], slateText[1], slateText[2]);
    let sy = currentY + 10;
    (insights.strengths || []).slice(0, 3).forEach((str) => {
      const lines = doc.splitTextToSize(`• ${str}`, halfW - 10);
      doc.text(lines[0], margin + 5, sy);
      sy += 4.5;
    });

    // Risk Signals Box
    const riskX = margin + halfW + 4;
    doc.setFillColor(254, 243, 199);
    doc.setDrawColor(253, 230, 138);
    doc.roundedRect(riskX, currentY, halfW, 26, 2, 2, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(amber[0], amber[1], amber[2]);
    doc.text('Risk Signals', riskX + 5, currentY + 5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(slateText[0], slateText[1], slateText[2]);
    let gy = currentY + 10;
    (insights.improvements || []).slice(0, 3).forEach((gr) => {
      const lines = doc.splitTextToSize(`• ${gr}`, halfW - 10);
      doc.text(lines[0], riskX + 5, gy);
      gy += 4.5;
    });

    currentY += 32;

    // Recruiter Verification Prompts Box
    if (insights.recommendations && insights.recommendations.length > 0) {
      checkPageBreak(26);
      doc.setFillColor(skyLight[0], skyLight[1], skyLight[2]);
      doc.setDrawColor(skyBorder[0], skyBorder[1], skyBorder[2]);
      doc.roundedRect(margin, currentY, contentWidth, 22, 2, 2, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(skyDark[0], skyDark[1], skyDark[2]);
      doc.text('Recruiter Verification Prompts & Live Interview Probes', margin + 5, currentY + 5);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(slateText[0], slateText[1], slateText[2]);
      let ry = currentY + 10;
      (insights.recommendations || []).slice(0, 2).forEach((rec) => {
        const lines = doc.splitTextToSize(`• ${rec}`, contentWidth - 10);
        doc.text(lines[0], margin + 5, ry);
        ry += 4.5;
      });
      currentY += 27;
    }
  }

  // ── DETAILED QUESTION ANALYSIS ─────────────────────────────────────────────
  checkPageBreak(30);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(slateText[0], slateText[1], slateText[2]);
  doc.text('DETAILED QUESTION EVALUATIONS', margin, currentY);
  currentY += 4;

  report.questions.forEach((q: NormalizedQuestion, index: number) => {
    checkPageBreak(36);

    // Question Box Container
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(slateBorder[0], slateBorder[1], slateBorder[2]);
    doc.setLineWidth(0.3);
    const boxStartY = currentY;

    // Header strip for question
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(margin, boxStartY, contentWidth, 7, 2, 2, 'F');
    doc.roundedRect(margin, boxStartY, contentWidth, 30, 2, 2, 'D');

    // Q Index
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(skyDark[0], skyDark[1], skyDark[2]);
    doc.text(`QUESTION ${q.index || index + 1}`, margin + 4, boxStartY + 5);

    // Score indicator on right
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    if (q.percentage !== null && q.percentage !== undefined) {
      doc.setTextColor(slateText[0], slateText[1], slateText[2]);
      doc.text(`Score: ${Math.round(q.percentage)}%`, pageWidth - margin - 4, boxStartY + 5, { align: 'right' });
    } else {
      doc.setTextColor(slateMuted[0], slateMuted[1], slateMuted[2]);
      doc.text('Not Evaluated', pageWidth - margin - 4, boxStartY + 5, { align: 'right' });
    }

    // Question text (multi-line wrapped)
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(slateText[0], slateText[1], slateText[2]);
    const qLines = doc.splitTextToSize(q.question || 'Untitled question', contentWidth - 10);
    doc.text(qLines.slice(0, 2), margin + 4, boxStartY + 12);

    // Subscores line
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(slateMuted[0], slateMuted[1], slateMuted[2]);
    const scoreParts = [
      q.technicalScore !== null ? `Technical: ${Math.round(q.technicalScore)}%` : null,
      q.confidenceScore !== null ? `Confidence: ${Math.round(q.confidenceScore)}%` : null,
      q.relevancy ? `Relevancy: ${q.relevancy}` : null,
      q.weightage ? `Weight: ${q.weightage}%` : null,
    ].filter(Boolean);
    doc.text(scoreParts.join('  ·  ') || 'Standard Evaluation', margin + 4, boxStartY + 18);

    // Transcript / message snippet
    const snippet = q.transcript || q.message || 'No candidate response audio recorded.';
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7);
    doc.setTextColor(slateMuted[0], slateMuted[1], slateMuted[2]);
    const tLines = doc.splitTextToSize(`Response: "${snippet}"`, contentWidth - 10);
    doc.text(tLines.slice(0, 1), margin + 4, boxStartY + 23);

    // Interactive Clickable Video Link
    if (q.videoUrl) {
      doc.setFillColor(skyLight[0], skyLight[1], skyLight[2]);
      doc.setDrawColor(skyBorder[0], skyBorder[1], skyBorder[2]);
      doc.roundedRect(margin + 4, boxStartY + 25, 48, 4.5, 1, 1, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.5);
      doc.setTextColor(skyDark[0], skyDark[1], skyDark[2]);
      // REAL CLICKABLE LINK IN PDF
      doc.textWithLink('▶ Click to Watch Video Response', margin + 6, boxStartY + 28, { url: q.videoUrl });
    }

    currentY += 34;
  });

  // ── PROCTORING & INTEGRITY AUDIT ────────────────────────────────────────────
  if (report.violations) {
    checkPageBreak(25);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(slateText[0], slateText[1], slateText[2]);
    doc.text('PROCTORING & SESSION INTEGRITY AUDIT', margin, currentY);
    currentY += 4;

    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(slateBorder[0], slateBorder[1], slateBorder[2]);
    doc.roundedRect(margin, currentY, contentWidth, 18, 2, 2, 'FD');

    const v = report.violations;
    const tabSwitches = v.tab_switch_count ?? v.tabSwitches ?? 0;
    const multipleFaces = v.multiple_face_detected ?? v.multipleFaceDetected ?? 0;
    const voiceCount = v.multiple_voice_detected ?? v.multipleVoiceDetected ?? 0;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(slateText[0], slateText[1], slateText[2]);
    doc.text(`Tab Switch Incidents: ${tabSwitches}`, margin + 6, currentY + 6);
    doc.text(`Multiple Face Events: ${multipleFaces}`, margin + 65, currentY + 6);
    doc.text(`Multiple Voices Detected: ${voiceCount}`, margin + 125, currentY + 6);

    const integrityPassed = tabSwitches === 0 && multipleFaces === 0;
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(integrityPassed ? emerald[0] : rose[0], integrityPassed ? emerald[1] : rose[1], integrityPassed ? emerald[2] : rose[2]);
    doc.text(
      integrityPassed ? '✓ Proctoring Check Passed: Normal Session' : '! Proctoring Alerts Recorded During Session',
      margin + 6,
      currentY + 13
    );

    currentY += 24;
  }

  // ── FOOTERS ON ALL PAGES ───────────────────────────────────────────────────
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setDrawColor(slateBorder[0], slateBorder[1], slateBorder[2]);
    doc.setLineWidth(0.3);
    doc.line(margin, pageHeight - 12, pageWidth - margin, pageHeight - 12);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(slateMuted[0], slateMuted[1], slateMuted[2]);
    doc.text('PrimeHire AI Candidate Assessment Platform · Confidential Evaluation Report', margin, pageHeight - 8);

    doc.text(`Page ${i} of ${totalPages}`, pageWidth - margin, pageHeight - 8, { align: 'right' });
  }

  // Trigger browser download of PDF
  doc.save(safeFilename);
  toast.success('PDF report downloaded successfully with clickable links!');
}

/**
 * Downloads a standalone, rich, interactive HTML report file.
 * The file can be opened locally in any browser offline.
 */
export function exportInteractiveHtmlReport({
  report,
  candidate,
  assessment,
  filename,
}: ExportReportOptions): void {
  const round = report.meta.roundType || assessment.roundType || 'INTERVIEW';
  const cleanName = candidate.name.replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeFilename = filename || `interview-report-${cleanName}-${round}.html`;

  const overall = report.overall.overallScore ?? 'N/A';
  const comm = report.overall.communication?.overall_score ?? report.overall.communication?.overallScore ?? 'N/A';
  const conf = report.overall.confidenceScore ?? 'N/A';

  const questionsHtml = report.questions
    .map(
      (q, idx) => `
    <div class="q-card">
      <div class="q-header">
        <span class="q-num">Question ${q.index || idx + 1}</span>
        <span class="q-score">${q.percentage !== null && q.percentage !== undefined ? Math.round(q.percentage) + '%' : 'Not Evaluated'}</span>
      </div>
      <h3 class="q-title">${escapeHtml(q.question || 'Untitled question')}</h3>
      <div class="q-badges">
        ${q.technicalScore !== null ? `<span class="badge">Technical: ${Math.round(q.technicalScore)}%</span>` : ''}
        ${q.confidenceScore !== null ? `<span class="badge">Confidence: ${Math.round(q.confidenceScore)}%</span>` : ''}
        ${q.relevancy ? `<span class="badge">Relevancy: ${q.relevancy}</span>` : ''}
        ${q.weightage ? `<span class="badge">Weightage: ${q.weightage}%</span>` : ''}
      </div>
      <div class="q-transcript">
        <strong>Transcript:</strong> ${escapeHtml(q.transcript || q.message || 'No transcription recorded.')}
      </div>
      ${
        q.videoUrl
          ? `<div class="q-video">
              <a href="${q.videoUrl}" target="_blank" rel="noopener noreferrer" class="btn-video">
                ▶ Watch Video Response
              </a>
              <video src="${q.videoUrl}" controls preload="metadata" style="max-width:100%; border-radius:8px; margin-top:8px; max-height:220px;"></video>
            </div>`
          : ''
      }
    </div>
  `
    )
    .join('');

  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Evaluation Report - ${escapeHtml(candidate.name)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    :root {
      --sky: #0284c7;
      --sky-light: #f0f9ff;
      --sky-border: #bae6fd;
      --text: #0f172a;
      --muted: #64748b;
      --card: #ffffff;
      --bg: #f8fafc;
      --border: #e2e8f0;
      --green: #16a34a;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background: var(--bg); color: var(--text); padding: 24px; line-height: 1.5; }
    .container { max-width: 900px; margin: 0 auto; }
    .header { background: var(--card); border: 1px solid var(--border); border-radius: 16px; padding: 24px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
    .brand { font-size: 11px; font-weight: 800; color: var(--sky); letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 4px; }
    .title { font-size: 24px; font-weight: 800; color: var(--text); margin-bottom: 4px; }
    .meta { font-size: 13px; color: var(--muted); }
    .scores-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 24px; }
    .score-card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 16px; text-align: center; }
    .score-label { font-size: 12px; font-weight: 600; color: var(--muted); text-transform: uppercase; margin-bottom: 4px; }
    .score-val { font-size: 32px; font-weight: 800; color: var(--sky); }
    .section-title { font-size: 16px; font-weight: 700; color: var(--text); margin: 24px 0 12px; }
    .q-card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 16px; margin-bottom: 14px; }
    .q-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
    .q-num { font-size: 11px; font-weight: 700; color: var(--sky); text-transform: uppercase; }
    .q-score { font-size: 12px; font-weight: 700; background: var(--sky-light); color: var(--sky); padding: 2px 8px; border-radius: 99px; }
    .q-title { font-size: 14px; font-weight: 700; color: var(--text); margin-bottom: 8px; }
    .q-badges { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
    .badge { font-size: 11px; background: #f1f5f9; padding: 2px 8px; border-radius: 6px; color: var(--muted); }
    .q-transcript { font-size: 12px; color: var(--muted); background: #f8fafc; border-left: 3px solid var(--sky); padding: 8px 12px; border-radius: 4px; margin-bottom: 10px; }
    .btn-video { display: inline-block; font-size: 12px; font-weight: 600; color: #fff; background: var(--sky); padding: 6px 12px; border-radius: 6px; text-decoration: none; }
    .btn-video:hover { opacity: 0.9; }
    .footer { text-align: center; font-size: 12px; color: var(--muted); margin-top: 32px; padding-top: 16px; border-top: 1px solid var(--border); }
    @media print {
      body { background: #fff; padding: 0; }
      .q-video video { display: none; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="brand">PrimeHire · VILS AI Candidate Report</div>
      <h1 class="title">${escapeHtml(candidate.name)}</h1>
      <p class="meta">${escapeHtml(assessment.jobTitle)} · ${round} Round · Generated: ${new Date().toLocaleDateString()}</p>
    </div>

    <div class="scores-grid">
      <div class="score-card">
        <div class="score-label">Overall Score</div>
        <div class="score-val">${overall}${overall !== 'N/A' ? '<span style="font-size:14px">/100</span>' : ''}</div>
      </div>
      <div class="score-card">
        <div class="score-label">Communication</div>
        <div class="score-val">${comm}${comm !== 'N/A' ? '<span style="font-size:14px">/100</span>' : ''}</div>
      </div>
      <div class="score-card">
        <div class="score-label">Confidence</div>
        <div class="score-val">${conf}${conf !== 'N/A' ? '<span style="font-size:14px">/100</span>' : ''}</div>
      </div>
    </div>

    <h2 class="section-title">Question Breakdown & Evidence</h2>
    ${questionsHtml}

    <div class="footer">
      Generated by PrimeHire AI Evaluation Engine · Confidential Candidate Assessment
    </div>
  </div>
</body>
</html>`;

  const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  toast.success('Interactive HTML report downloaded!');
}

/**
 * Triggers clean browser vector print / Save-as-PDF dialog.
 */
export function openPrintDialog(): void {
  window.print();
}

/**
 * Backward-compatible export function that safely calls the interactive PDF generator.
 */
export async function exportReportToPdf(
  elementRef?: RefObject<HTMLDivElement | null>,
  filename = 'interview-report.pdf',
  reportData?: ExportReportOptions
): Promise<void> {
  if (reportData) {
    return exportInteractivePdfReport(reportData);
  }

  // Fallback: If no structured data is passed, trigger print dialog
  openPrintDialog();
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
