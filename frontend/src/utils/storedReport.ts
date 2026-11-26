import type {ReportContent, ReportMetadata, ReportMetric} from '../lib/reportingApi';
import type {NormalizedReport} from './normalizeReport';
import {normalizeMcq} from './mcqReport';

export function storedPercentage(metric: Pick<ReportMetric, 'value' | 'maximum'>): number | null {
  return metric.value !== null && metric.maximum !== null && metric.maximum > 0
    ? metric.value / metric.maximum * 100 : null;
}

export function normalizeStoredReport(content: ReportContent, metadata: ReportMetadata): NormalizedReport {
  return {
    meta: {jobId: metadata.jobId, candidateId: metadata.candidateId, roundType: metadata.roundType,
      submittedAt: metadata.roundCompletedAt ?? null, status: metadata.status},
    overall: {overallScore: storedPercentage(content.overview), confidenceScore: null, communication: null},
    violations: null,
    questions: content.questions.map((question, index) => ({
      key: question.reference, index: index + 1, question: question.question ?? 'Question text unavailable',
      isGenerated: question.status === 'Completed' || question.score != null, isAttempted: null,
      message: question.aiAnalysis ?? question.feedback, maxScore: question.maximum ?? 0,
      scoreLabel: question.score == null ? 'Score unavailable' : `${question.score}${question.maximum == null ? '' : ` / ${question.maximum}`}`,
      obtainedScore: question.score, percentage: storedPercentage({value: question.score, maximum: question.maximum}),
      weightage: question.weightage, transcript: question.transcript,
      relevancy: typeof question.relevancy === 'string' ? question.relevancy : null,
      technicalScore: null, confidenceScore: null, communication: null, videoUrl: null,
      mcq: question.type?.toUpperCase() === 'MCQ' ? normalizeMcq(question.mcqInput ?? {}, content.assessmentQuestions) : undefined,
    })),
    isEmpty: !content.questions.length, isTechnical: metadata.roundType === 'TECHNICAL',
    isBasic: metadata.roundType === 'BASIC', isHR: metadata.roundType === 'HR', raw: content,
  };
}
