import type { Question } from '../types';

export interface McqOption {
  id: string;
  text: string | null;
}

export interface McqResult {
  options: McqOption[];
  selectedOptionId: string | null;
  correctOptionId: string | null;
  outcome: 'correct' | 'incorrect' | 'unanswered' | 'pending' | 'unknown';
  hasMissingOptionText: boolean;
}

function answerId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const id = String(value).trim();
  // The provider uses negative IDs (including numeric values) for skipped MCQs.
  if (!id || (Number.isFinite(Number(id)) && Number(id) < 0)) return null;
  return /^[a-z]$/i.test(id) ? id.toUpperCase() : id;
}

function questionText(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function providerQuestionId(id: string): string {
  const sanitized = id.replace(/[^a-zA-Z0-9_]/g, '_');
  return !sanitized || /^\d/.test(sanitized) ? `q_${sanitized}` : sanitized;
}

export function normalizeMcqResult(raw: any, assessmentQuestions: Question[] = []): McqResult | null {
  const rawId = String(raw.id ?? raw.question_id ?? raw.questionId ?? '');
  const byId = assessmentQuestions.filter(q => q.id === rawId || providerQuestionId(q.id) === rawId);
  const byText = assessmentQuestions.filter(q => questionText(q.text) === questionText(raw.question));
  // Provider report IDs can differ from our question IDs. Never join by position,
  // or choose arbitrarily between duplicate question texts.
  const assessment = byId.length === 1 ? byId[0] : byText.length === 1 ? byText[0] : undefined;
  const type = String(raw.type ?? assessment?.type ?? '').toUpperCase();
  const hasAnswerIds = 'option_id' in raw || 'optionId' in raw || 'correct_option_id' in raw || 'correctOptionId' in raw;
  if (type !== 'MCQ' && (type || !hasAnswerIds)) return null;

  const rawOptions = Array.isArray(raw.options) && raw.options.length ? raw.options : assessment?.options ?? [];
  const stringOptions = rawOptions.every((option: unknown) => typeof option === 'string');
  const options: McqOption[] = rawOptions.map((option: any, index: number) => {
    if (typeof option === 'string') return { id: String.fromCharCode(65 + index), text: option };
    return {
      id: answerId(option?.id ?? option?.option_id ?? option?.optionId) ?? String.fromCharCode(65 + index),
      text: option?.data ?? option?.text ?? option?.label ?? null,
    };
  });
  const resolveId = (value: unknown) => {
    const id = answerId(value);
    if (!id) return null;
    if (options.some(option => option.id === id)) return id;
    // Older assessments used opt_1, opt_2, ... for the same ordered options.
    const legacy = stringOptions ? /^opt_(\d+)$/i.exec(id) : null;
    return legacy ? options[Number(legacy[1]) - 1]?.id ?? id : id;
  };
  const selectedOptionId = resolveId(raw.option_id ?? raw.optionId);
  const correctFromAssessment = assessment?.options?.indexOf(assessment.correctOption ?? '') ?? -1;
  const correctOptionId = resolveId(raw.correct_option_id ?? raw.correctOptionId ??
    (correctFromAssessment >= 0 ? String.fromCharCode(65 + correctFromAssessment) : null));

  // Preserve unresolved IDs visibly rather than inventing answer text.
  for (const id of [selectedOptionId, correctOptionId]) {
    if (id && !options.some(option => option.id === id)) options.push({ id, text: null });
  }
  const pending = !(raw.is_result_generated ?? raw.isResultGenerated);
  const outcome = pending ? 'pending' : !selectedOptionId ? 'unanswered' : !correctOptionId ? 'unknown' :
    selectedOptionId === correctOptionId ? 'correct' : 'incorrect';
  return { options, selectedOptionId, correctOptionId, outcome,
    hasMissingOptionText: options.length === 0 || options.some(option => !option.text) };
}

export function mcqOptionLabel(result: McqResult, id: string | null): string {
  if (!id) return 'Unavailable';
  const text = result.options.find(option => option.id === id)?.text;
  return text ? `${id}. ${text}` : `Option ${id}`;
}

export function mcqSummary(result: McqResult): string {
  switch (result.outcome) {
    case 'correct': return 'You have selected the right option.';
    case 'incorrect': return `You have selected the wrong option. Correct answer: ${mcqOptionLabel(result, result.correctOptionId)}.`;
    case 'unanswered': return 'The candidate has not selected any option.';
    case 'pending': return 'This answer has not been evaluated yet.';
    default: return 'The correct answer is unavailable in this report.';
  }
}
