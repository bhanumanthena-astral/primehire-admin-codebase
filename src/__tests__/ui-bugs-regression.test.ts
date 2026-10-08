/**
 * Regression tests for UI bugs:
 * - Bug #7: Max Duration range 1-120s
 * - Bug #28: Weightage leading zero normalization & field clearing
 * - Bug #20: Detailed Feedback vs Transcript semantic separation
 */

import { describe, test, expect } from 'vitest';
import { normalizeReport, getGrade } from '../utils/normalizeReport';

describe('BUG #7: Max Duration validation logic', () => {
  function validateDuration(val: unknown): { isValid: boolean; error?: string } {
    const num = Number(val);
    if (val === '' || val === undefined || val === null) {
      return { isValid: false, error: 'Max Duration is required' };
    }
    if (!Number.isFinite(num) || num < 1 || num > 120) {
      return { isValid: false, error: 'Max Duration must be between 1 and 120 seconds.' };
    }
    return { isValid: true };
  }

  test('accepts 60 seconds', () => {
    expect(validateDuration(60).isValid).toBe(true);
  });

  test('accepts 120 seconds boundary', () => {
    expect(validateDuration(120).isValid).toBe(true);
  });

  test('accepts 1 second boundary', () => {
    expect(validateDuration(1).isValid).toBe(true);
  });

  test('rejects 121 seconds with clear feedback', () => {
    const res = validateDuration(121);
    expect(res.isValid).toBe(false);
    expect(res.error).toBe('Max Duration must be between 1 and 120 seconds.');
  });

  test('rejects 500 seconds', () => {
    const res = validateDuration(500);
    expect(res.isValid).toBe(false);
    expect(res.error).toBe('Max Duration must be between 1 and 120 seconds.');
  });

  test('rejects 0 seconds', () => {
    const res = validateDuration(0);
    expect(res.isValid).toBe(false);
    expect(res.error).toBe('Max Duration must be between 1 and 120 seconds.');
  });

  test('rejects negative seconds', () => {
    const res = validateDuration(-10);
    expect(res.isValid).toBe(false);
  });
});

describe('BUG #28: Weightage input normalization and leading zero handling', () => {
  function normalizeNumericInput(rawStr: string): number | undefined {
    const raw = rawStr.trim();
    if (raw === '') return undefined;
    const cleaned = raw.replace(/^0+(?=\d)/, '');
    const num = Number(cleaned);
    return isNaN(num) ? undefined : num;
  }

  test('clearing field returns undefined (allows empty editing state without sticking to 0)', () => {
    expect(normalizeNumericInput('')).toBeUndefined();
    expect(normalizeNumericInput('   ')).toBeUndefined();
  });

  test('typing 5 produces 5', () => {
    expect(normalizeNumericInput('5')).toBe(5);
  });

  test('typing 50 produces 50', () => {
    expect(normalizeNumericInput('50')).toBe(50);
  });

  test('typing 5 with a leading 0 (05) strips the extra leading zero and produces 5', () => {
    expect(normalizeNumericInput('05')).toBe(5);
  });

  test('typing 050 strips leading zero and produces 50', () => {
    expect(normalizeNumericInput('050')).toBe(50);
  });

  test('typing 00050 strips multiple leading zeros and produces 50', () => {
    expect(normalizeNumericInput('00050')).toBe(50);
  });

  test('typing legitimate 0 is preserved as 0', () => {
    expect(normalizeNumericInput('0')).toBe(0);
  });

  test('typing 00 is normalized to 0', () => {
    expect(normalizeNumericInput('00')).toBe(0);
  });

  test('typing 100 produces 100', () => {
    expect(normalizeNumericInput('100')).toBe(100);
  });
});

describe('BUG #20: Detailed Feedback vs Transcript separation in report normalization', () => {
  test('separates evaluator feedback from candidate transcript in real report shape', () => {
    const rawReport = {
      interview_details: {
        job_id: 'JOB-TECH-1',
        candidate_id: 'CAND-1',
        round_type: 'TECHNICAL',
      },
      report: {
        overall_result: {
          technical_analysis: { overall_score: 85 },
        },
        question_wise_result: [
          {
            id: 'q-1',
            question: 'Explain React hooks lifecycle.',
            max_score: 20,
            obtained_score: 18,
            result: {
              transcript: 'I used useEffect and useMemo to optimize component rendering.',
              feedback: 'Candidate demonstrated strong mastery of dependency arrays and closure semantics.',
              relevancy: 'High',
              technical_analysis: { overall_score: 90 },
            },
          },
        ],
      },
    };

    const norm = normalizeReport(rawReport);
    expect(norm).not.toBeNull();
    const q = norm!.questions[0];

    // Transcript MUST be what the candidate said
    expect(q.transcript).toBe('I used useEffect and useMemo to optimize component rendering.');

    // Feedback MUST be the evaluator evaluation
    expect(q.feedback).toBe('Candidate demonstrated strong mastery of dependency arrays and closure semantics.');

    // Feedback and transcript must NOT be identical
    expect(q.feedback).not.toBe(q.transcript);
  });

  test('handles case where transcript is present but evaluator feedback remarks are absent', () => {
    const rawReport = {
      interview_details: { job_id: 'JOB-1', candidate_id: 'CAND-2', round_type: 'TECHNICAL' },
      report: {
        question_wise_result: [
          {
            id: 'q-1',
            question: 'What is CORS?',
            max_score: 10,
            obtained_score: 8,
            result: {
              transcript: 'Cross-origin resource sharing is a browser security mechanism.',
              // No evaluator feedback string
            },
          },
        ],
      },
    };

    const norm = normalizeReport(rawReport);
    expect(norm).not.toBeNull();
    const q = norm!.questions[0];

    expect(q.transcript).toBe('Cross-origin resource sharing is a browser security mechanism.');
    expect(q.feedback).toBeNull();
  });

  test('handles legacy reports where feedback was present without candidate transcript', () => {
    const legacyReport = {
      interview_details: { job_id: 'JOB-LEGACY', candidate_id: 'CAND-LEGACY', round_type: 'TECHNICAL' },
      report: {
        overallScore: 82,
        answersFeedback: [
          {
            questionId: 'q-legacy-1',
            question: 'Explain debouncing.',
            score: 18,
            maxScore: 20,
            feedback: 'Solid explanation of rate limiting events.',
          },
        ],
      },
    };

    const norm = normalizeReport(legacyReport);
    expect(norm).not.toBeNull();
    const q = norm!.questions[0];

    // Evaluator feedback is mapped to feedback
    expect(q.feedback).toBe('Solid explanation of rate limiting events.');
    // Transcript is not falsely set to the feedback
    expect(q.transcript).toBeNull();
  });
});
