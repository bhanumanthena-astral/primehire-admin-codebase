import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { jsPDF } from 'jspdf';
import type { Question } from '../types';
import { normalizeReport } from '../utils/normalizeReport';
import { normalizeMcqResult, mcqSummary } from '../utils/mcqReport';
import { exportReportToPdf } from '../utils/exportReportPdf';
import McqAnswerReview from '../components/report/McqAnswerReview';
import VideoReview from '../components/report/VideoReview';

const pdfDownload = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock('jspdf', async importOriginal => {
  const actual = await importOriginal<typeof import('jspdf')>();
  return { ...actual, jsPDF: vi.fn(function (...args: ConstructorParameters<typeof actual.jsPDF>) {
    const pdf = new actual.jsPDF(...args);
    pdf.save = pdfDownload.save;
    return pdf;
  }) };
});

const assessment: Question[] = [
  { id: 'local-1', text: 'Who owns Chatgpt ?', type: 'MCQ', maxDuration: 60,
    options: ['Google', 'OpenAI', 'Microsoft', 'Meta'], correctOption: 'OpenAI' },
  { id: 'local-2', text: 'Who owns Claude?', type: 'MCQ', maxDuration: 60,
    options: ['Anthropic', 'OpenAI', 'Google'], correctOption: 'Anthropic' },
];
const answer = (selection: unknown, overrides: any = {}) => ({
  id: 'provider-id', question: 'Who owns Chatgpt ?', type: 'MCQ',
  option_id: selection, correct_option_id: 'B', obtained_score: 50,
  max_score: 50, is_result_generated: true, ...overrides,
});

describe('MCQ report answer mapping', () => {
  it('joins provider question IDs to unique assessment text and maps A/B options', () => {
    const normalized = normalizeReport({ status: 'SUCCESS', data: {
      interview_details: { round_type: 'BASIC' }, report: { overall_score: 50,
        question_wise_result: [answer('B'), answer('-1', { question: 'Who owns Claude?', correct_option_id: 'A', obtained_score: 0 })] },
    } }, undefined, assessment)!;
    expect(normalized.questions[0].mcq).toMatchObject({ outcome: 'correct', selectedOptionId: 'B', correctOptionId: 'B', hasMissingOptionText: false });
    expect(normalized.questions[0].mcq!.options).toEqual([
      { id: 'A', text: 'Google' }, { id: 'B', text: 'OpenAI' },
      { id: 'C', text: 'Microsoft' }, { id: 'D', text: 'Meta' },
    ]);
    expect(normalized.questions[1].mcq).toMatchObject({ outcome: 'unanswered', selectedOptionId: null, correctOptionId: 'A' });
  });

  it.each(['-1', '-2', '-123.5', -4, '', '   ', null, undefined])('treats %s as no selection', selection => {
    const result = normalizeMcqResult(answer(selection), assessment)!;
    expect(result.selectedOptionId).toBeNull();
    expect(result.outcome).toBe('unanswered');
    expect(mcqSummary(result)).toBe('The candidate has not selected any option.');
  });

  it('uses camelCase and explicit provider option IDs without guessing numeric indices', () => {
    const result = normalizeMcqResult({ type: 'MCQ', optionId: 0, correctOptionId: 1, isResultGenerated: true,
      options: [{ id: 0, data: 'Zero' }, { id: 1, data: 'One' }] })!;
    expect(result).toMatchObject({ selectedOptionId: '0', correctOptionId: '1', outcome: 'incorrect' });
    expect(mcqSummary(result)).toContain('Correct answer: 1. One');
  });

  it('supports legacy opt_N IDs and sanitized assessment question IDs', () => {
    const result = normalizeMcqResult(answer('opt_1', { id: 'local_1', question: '', correct_option_id: 'opt_2' }), assessment)!;
    expect(result).toMatchObject({ selectedOptionId: 'A', correctOptionId: 'B', outcome: 'incorrect' });
    expect(result.options[1].text).toBe('OpenAI');
  });

  it('prefers report options and correct answer over the current assessment', () => {
    const result = normalizeMcqResult(answer('A', { correct_option_id: 'A', options: [
      { id: 'A', data: 'Original answer' }, { id: 'B', data: 'Other answer' },
    ] }), assessment)!;
    expect(result.options[0].text).toBe('Original answer');
    expect(result.outcome).toBe('correct');
  });

  it('does not guess options by question position or ambiguous text', () => {
    const ambiguous = [...assessment, { ...assessment[0], id: 'duplicate', options: ['Different option'] }];
    const result = normalizeMcqResult(answer('B'), ambiguous)!;
    expect(result.options).toEqual([{ id: 'B', text: null }]);
    expect(result.hasMissingOptionText).toBe(true);
    expect(normalizeMcqResult(answer('B', { question: 'Another question' }), assessment)!.hasMissingOptionText).toBe(true);
  });

  it('does not assume a selected option is wrong when the correct answer is missing', () => {
    expect(normalizeMcqResult(answer('A', { correct_option_id: undefined }))!.outcome).toBe('unknown');
    expect(normalizeMcqResult(answer('-2', { is_result_generated: false }), assessment)!.outcome).toBe('pending');
  });

  it('keeps spoken questions unchanged', () => {
    const report = normalizeReport({ report: { question_wise_result: [{ type: 'SPEAK_TO_ANSWER', question: 'Explain React', is_result_generated: true, result: { transcript: 'React uses components.' } }] } })!;
    expect(report.questions[0].mcq).toBeNull();
    expect(report.questions[0].transcript).toBe('React uses components.');
  });
});

describe('MCQ report presentation', () => {
  it.each([
    ['B', 'You have selected the right option.', 'Selected · Correct answer'],
    ['A', 'You have selected the wrong option.', 'Candidate’s selection'],
    ['-8', 'The candidate has not selected any option.', 'Correct answer'],
  ])('renders full options and accessible labels for selection %s', (selection, message, label) => {
    const result = normalizeMcqResult(answer(selection), assessment)!;
    const html = renderToStaticMarkup(<McqAnswerReview result={result} />);
    for (const option of assessment[0].options!) expect(html).toContain(option);
    expect(html).toContain(message);
    expect(html).toContain(label);
    expect(html).toContain('bg-emerald-50');
    expect(html.includes('border-rose-200')).toBe(selection === 'A');
  });

  it('shows MCQ answers in selected review instead of missing video/transcript placeholders', () => {
    const q = normalizeReport({ report: { question_wise_result: [answer('B')] } }, 'BASIC', assessment)!.questions;
    const html = renderToStaticMarkup(<VideoReview questions={q} selectedIndex={0} onNavigate={() => {}} />);
    expect(html).toContain('OpenAI');
    expect(html).not.toContain('No video available');
    expect(html).not.toContain('No transcript available');
  });

  it('exports MCQ options, outcomes and selection labels in the PDF', async () => {
    let pdfText = '';
    const save = pdfDownload.save.mockImplementation(function (this: jsPDF) {
      pdfText = this.output();
      return this;
    });
    try {
      const report = normalizeReport({ report: { question_wise_result: [answer('B'), answer('A'), answer('-5')] } }, 'BASIC', assessment)!;
      await exportReportToPdf(report, undefined, 'mcq.pdf');
      expect(save).toHaveBeenCalledWith('mcq.pdf');
      expect(pdfText).toContain('OpenAI');
      expect(pdfText).toContain('Selected; Correct answer');
      expect(pdfText).toContain('Candidate selection');
      expect(pdfText).toContain('You have selected the wrong option');
      expect(pdfText).toContain('The candidate has not selected any option');
    } finally { save.mockReset(); }
  });
});
