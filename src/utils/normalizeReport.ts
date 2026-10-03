export interface Grade {
  letter: string;
  color: string;
  bg: string;
}

export function getGrade(score: number | null | undefined): Grade {
  if (score === null || score === undefined) return { letter: 'N/A', color: '#94a3b8', bg: '#f1f5f9' };
  if (score >= 90) return { letter: 'A+', color: '#15803d', bg: '#dcfce7' };
  if (score >= 80) return { letter: 'A', color: '#15803d', bg: '#dcfce7' };
  if (score >= 70) return { letter: 'B+', color: '#1d4ed8', bg: '#dbeafe' };
  if (score >= 60) return { letter: 'B', color: '#1d4ed8', bg: '#dbeafe' };
  if (score >= 50) return { letter: 'C+', color: '#b45309', bg: '#fef3c7' };
  if (score >= 40) return { letter: 'C', color: '#b45309', bg: '#fef3c7' };
  if (score >= 30) return { letter: 'D', color: '#c2410c', bg: '#ffedd5' };
  if (score >= 20) return { letter: 'E', color: '#dc2626', bg: '#fee2e2' };
  return { letter: 'F', color: '#dc2626', bg: '#fee2e2' };
}

export const relevancyColor: Record<string, { color: string; bg: string }> = {
  High: { color: '#15803d', bg: '#dcfce7' },
  Medium: { color: '#b45309', bg: '#fef3c7' },
  Low: { color: '#dc2626', bg: '#fee2e2' },
};

export function initialsFromId(id: string | null | undefined): string {
  if (!id) return '??';
  return id.slice(0, 2).toUpperCase();
}

export function shortId(id: string | null | undefined, len = 8): string {
  if (!id) return 'N/A';
  return id.slice(0, len);
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return 'N/A';
  try {
    const d = new Date(dateStr.replace(' ', 'T'));
    return d.toLocaleString('en-US', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

export interface NormalizedQuestion {
  key: string;
  index: number;
  question: string;
  isGenerated: boolean;
  /** Raw is_attempted passthrough (null when the source omits it — never inferred). */
  isAttempted: boolean | null;
  message: string | null;
  maxScore: number;
  weightage: number | null;
  obtainedScore: number | null;
  percentage: number | null;
  transcript: string | null;
  relevancy: string | null;
  technicalScore: number | null;
  confidenceScore: number | null;
  communication: Record<string, any> | null;
  videoUrl: string | null;
}

export interface NormalizedOverall {
  overallScore: number | null;
  confidenceScore: number | null;
  communication: Record<string, any> | null;
}

export interface NormalizedReport {
  meta: {
    jobId: string | null;
    candidateId: string | null;
    roundType: string;
    submittedAt: string | null;
    status: string | null;
  };
  violations: Record<string, any> | null;
  overall: NormalizedOverall;
  questions: NormalizedQuestion[];
  isEmpty: boolean;
  isTechnical: boolean;
  isBasic: boolean;
  isHR: boolean;
  /** Original payload (raw PrimeHire JSON or app shape) — kept for debugging/export. */
  raw: any;
}

export function normalizeReport(raw: any): NormalizedReport | null {
  if (!raw) return null;

  // Accept both snake_case (raw backend JSON) and camelCase (app API proxy).
  const details = raw?.interview_details || raw?.interviewDetails || {};
  const roundType: string =
    details?.round_type || details?.roundType || raw?.round_type || raw?.roundType || 'UNKNOWN';
  const jobId = details?.job_id || details?.jobId || raw?.job_id || raw?.jobId || null;
  const candidateId =
    details?.candidate_id || details?.candidateId || raw?.candidate_id || raw?.candidateId || null;
  const submittedAt =
    details?.submitted_at || details?.submittedAt || raw?.submitted_at || raw?.submittedAt || null;
  const violations =
    raw?.faceapi_violations || raw?.faceapi_attributes || raw?.faceapiViolations || raw?.faceapiAttributes || null;

  const reportBlock = raw?.report || raw;
  const questionsRaw: any[] = reportBlock?.question_wise_result || reportBlock?.questionWiseResult || [];

  // Legacy mock/simulated shape used by Candidate Directory demo candidates:
  // { overallScore, answersFeedback: [{ questionId, score, maxScore, feedback }] }
  const legacyFeedback: any[] = reportBlock?.answersFeedback || reportBlock?.answers_feedback || [];
  const legacyOverall: number | null =
    reportBlock?.overallScore ?? reportBlock?.overall_score ?? raw?.overallScore ?? null;

  const isTechnical = roundType === 'TECHNICAL';
  const isBasic = roundType === 'BASIC';
  const isHR = roundType === 'HR';

  let overall: NormalizedOverall = { overallScore: null, confidenceScore: null, communication: null };

  if (isTechnical) {
    const o = reportBlock.overall_result || reportBlock.overallResult || {};
    overall = {
      overallScore: o?.technical_analysis?.overall_score ?? o?.technicalAnalysis?.overallScore ?? null,
      confidenceScore: o?.interview_analysis?.confidence_score ?? o?.interviewAnalysis?.confidenceScore ?? null,
      communication: o?.communication_analysis ?? o?.communicationAnalysis ?? null,
    };
  } else if (isBasic) {
    overall = {
      overallScore: reportBlock?.overall_score ?? reportBlock?.overallScore ?? null,
      confidenceScore: null,
      communication: reportBlock?.communication_analysis ?? reportBlock?.communicationAnalysis ?? null,
    };
  } else {
    const o = reportBlock?.overall_result || reportBlock?.overallResult || {};
    overall = {
      overallScore:
        o?.technical_analysis?.overall_score ??
        o?.technicalAnalysis?.overallScore ??
        o?.overall_score ??
        o?.overallScore ??
        null,
      confidenceScore:
        o?.interview_analysis?.confidence_score ?? o?.interviewAnalysis?.confidenceScore ?? null,
      communication: o?.communication_analysis ?? o?.communicationAnalysis ?? null,
    };
  }

  const questions: NormalizedQuestion[] = questionsRaw.map((q, idx) => {
    const r = q.result || {};
    const tech = r.technical_analysis || r.technicalAnalysis || {};
    const interview = r.interview_analysis || r.interviewAnalysis || {};
    const maxScore = q.max_score ?? q.maxScore ?? 100;
    const obtained = q.obtained_score ?? q.obtainedScore ?? null;
    const pct = obtained !== undefined && obtained !== null && maxScore ? Math.round((obtained / maxScore) * 100) : null;
    return {
      key: String(q.id || q._id || q.video_id || q.videoId || idx),
      index: idx + 1,
      question: q.question || '',
      isGenerated: !!(q.is_result_generated ?? q.isResultGenerated),
      isAttempted: q.is_attempted ?? q.isAttempted ?? (q.video_url || q.videoUrl ? true : null),
      message: q.message || null,
      maxScore,
      weightage: q.weightage ?? null,
      obtainedScore: obtained,
      percentage: pct,
      transcript: r.transcript ?? null,
      relevancy: r.relevancy ?? null,
      technicalScore: tech?.overall_score ?? tech?.overallScore ?? null,
      confidenceScore: interview?.confidence_score ?? interview?.confidenceScore ?? null,
      communication: r.communication_analysis ?? r.communicationAnalysis ?? null,
      videoUrl: q.video_url || q.videoUrl || null,
    };
  });

  // Fallback for legacy mock/simulated reports that carry no question_wise_result.
  if (questions.length === 0 && legacyFeedback.length > 0) {
    legacyFeedback.forEach((a, idx) => {
      const max = a.maxScore ?? a.max_score ?? 100;
      const rawScore = a.score ?? 0;
      const pct = max > 0 ? Math.round((rawScore / max) * 100) : 0;
      questions.push({
        key: String(a.questionId || a.question_id || idx),
        index: idx + 1,
        question: a.question || a.questionId || a.question_id || `Question ${idx + 1}`,
        isGenerated: true,
        isAttempted: true,
        message: null,
        maxScore: 100,
        weightage: null,
        obtainedScore: pct,
        percentage: pct,
        transcript: a.feedback || null,
        relevancy: null,
        technicalScore: pct,
        confidenceScore: null,
        communication: null,
        videoUrl: null,
      });
    });
  }

  if (overall.overallScore === null && legacyOverall !== null) {
    overall.overallScore = legacyOverall;
  }

  const generatedCount = questions.filter((q) => q.isGenerated).length;
  const isEmpty = (questionsRaw.length > 0 || legacyFeedback.length > 0) && generatedCount === 0;

  return {
    meta: { jobId, candidateId, roundType, submittedAt, status: raw.status ?? null },
    violations,
    overall,
    questions,
    isEmpty,
    isTechnical,
    isBasic,
    isHR,
    raw,
  };
}

export interface Insights {
  summary: string;
  strengths: string[];
  improvements: string[];
  recommendations: string[];
}

// Deterministic, hiring-oriented insight generator.
// Shifts tone strictly from student coaching to professional recruiter decision-support.
// All signals directly reference genuine numbers and flags from backend data.
export function generateInsights(report: NormalizedReport | null): Insights {
  if (!report) return { summary: '', strengths: [], improvements: [], recommendations: [] };
  const { overall, questions, violations } = report;
  const strengths: string[] = [];
  const improvements: string[] = [];
  const recommendations: string[] = [];

  const comm = overall.communication;
  const commScore = comm?.overall_score ?? comm?.overallScore;

  // Strength signals
  if (overall.overallScore !== null && overall.overallScore >= 70) {
    strengths.push(`Strong core performance: ${overall.overallScore}/100 overall technical score`);
  } else if (overall.overallScore !== null && overall.overallScore >= 50) {
    strengths.push(`Meets baseline technical criteria: ${overall.overallScore}/100 overall score`);
  }

  if (comm) {
    if (comm.fluency >= 65) strengths.push(`High verbal articulation and fluency (${comm.fluency}/100)`);
    if (comm.grammar >= 65) strengths.push(`Clean professional grammar and sentence structure (${comm.grammar}/100)`);
    if (comm.vocabulary >= 65) strengths.push(`Rich technical and contextual vocabulary (${comm.vocabulary}/100)`);
  }

  if (overall.confidenceScore !== null && overall.confidenceScore >= 65) {
    strengths.push(`Poised, confident delivery under assessment conditions (${overall.confidenceScore}/100)`);
  }

  const strongQuestions = questions.filter((q) => q.percentage !== null && (q.percentage as number) >= 70);
  const weakQuestions = questions.filter((q) => q.percentage !== null && (q.percentage as number) < 45);

  if (strongQuestions.length > 0) {
    strengths.push(`High consistency: answered ${strongQuestions.length} of ${questions.length} questions above 70% threshold`);
  }

  // Risk signals & discrepancies
  if (overall.overallScore !== null && overall.overallScore < 50) {
    improvements.push(`Overall performance is below hiring threshold (${overall.overallScore}/100)`);
  }

  if (weakQuestions.length > 0) {
    improvements.push(`${weakQuestions.length} question(s) scored below 45% threshold — denotes specific conceptual gaps`);
    recommendations.push(`Cross-examine the candidate on topics covered in Q${weakQuestions.map((q) => q.index).join(', Q')}`);
  }

  if (comm) {
    if (comm.fluency !== undefined && comm.fluency < 50) {
      improvements.push(`Fluency gap detected (${comm.fluency}/100) — candidate had hesitations or phrasing friction`);
      recommendations.push('Assess live conversational fluency and stakeholder communication in team round');
    }
    if (comm.grammar !== undefined && comm.grammar < 50) {
      improvements.push(`Grammar accuracy scored below average (${comm.grammar}/100)`);
    }
  }

  if (overall.confidenceScore !== null && overall.confidenceScore < 50) {
    improvements.push(`Delivery confidence was low (${overall.confidenceScore}/100) during video recording`);
    recommendations.push('Evaluate candidate autonomy, assertiveness, and pressure tolerance in live interview');
  }

  // Proctoring audit risk flags
  if (violations) {
    const tabSwitches = violations.tab_switch_count ?? violations.tabSwitches ?? violations.tab_switching ?? 0;
    const multipleFaces = violations.multiple_face_detected ?? violations.multipleFaceDetected ?? violations.multiple_faces_detected ?? 0;
    if (tabSwitches > 0) {
      improvements.push(`Proctoring alert: ${tabSwitches} window/tab switch event(s) logged during session`);
      recommendations.push('Review integrity log and verify candidate authentication during follow-up interview');
    }
    if (multipleFaces > 0) {
      improvements.push(`Proctoring alert: multiple face detection triggered ${multipleFaces} time(s)`);
      recommendations.push('Inspect question video recordings for potential unauthorized assistance');
    }
  }

  // Default recruiter recommendations if clean
  if (recommendations.length === 0) {
    recommendations.push('Candidate meets assessment criteria; proceed to live technical panel or hiring manager interview');
    recommendations.push('Deepen live evaluation on system architecture and team collaboration competencies');
  }

  const evaluatedCount = questions.filter((q) => q.isGenerated).length;
  const summary =
    overall.overallScore !== null
      ? `Candidate scored ${overall.overallScore}/100 overall across ${evaluatedCount} of ${questions.length} evaluated questions.${
          commScore ? ` Communication scored ${commScore}/100 with fluency at ${comm?.fluency ?? 'N/A'}/100.` : ''
        } ${weakQuestions.length ? `${weakQuestions.length} area(s) require technical verification.` : 'Performance remained consistent across all assessed questions.'}`
      : `Evaluation pending or partial: ${evaluatedCount} of ${questions.length} question(s) currently processed.`;

  return {
    summary,
    strengths: strengths.length ? strengths : ['Candidate baseline evaluation in progress'],
    improvements: improvements.length ? improvements : ['No critical risk signals flagged in this round'],
    recommendations,
  };
}
