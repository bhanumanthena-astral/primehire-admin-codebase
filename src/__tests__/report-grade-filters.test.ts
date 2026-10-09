import { describe, expect, test } from 'vitest';
import type { Candidate } from '../types';
import { asLocalCandidateId } from '../lib/primehireIds';
import { getGrade, normalizeReport } from '../utils/normalizeReport';
import { checkScoreFilter, getCandidateScore, REPORT_GRADE_OPTIONS } from '../utils/reportScoreFilters';

const candidate = { id: asLocalCandidateId('CAND-grade'), reportStatus: 'GENERATED' } as Candidate;
const basic = {
  interview_details: { round_type: 'BASIC' },
  report: { overall_score: 82, communication_analysis: { overall_score: 44, fluency: 75, grammar: 0, pronunciation: 90, vocabulary: 56 } },
};
const technical = {
  interviewDetails: { roundType: 'TECHNICAL' },
  report: { overallResult: {
    technicalAnalysis: { overallScore: 68 },
    communicationAnalysis: { overallScore: 87, grammar: 52 },
    interviewAnalysis: { confidenceScore: 73 },
  } },
};

describe('report grade filters', () => {
  test.each([0, 19.99, 20, 29.99, 30, 39.99, 40, 49.99, 50, 59.99, 60, 69.99, 70, 79.99, 80, 89.99, 90, 100])('score %s matches exactly the grade displayed in reports', score => {
    const matches = REPORT_GRADE_OPTIONS.filter(option => checkScoreFilter(score, 'scale5', option.value));
    expect(matches.map(option => option.value)).toEqual([getGrade(score).letter]);
  });

  test('BASIC overall grade uses the report, independent of candidate ID', () => {
    for (const id of ['CAND-1', 'CAND-2']) {
      const score = getCandidateScore({ ...candidate, id: asLocalCandidateId(id) }, 'BASIC', 'Overall Score', null, null, 'BASIC', basic);
      expect(score).toBe(normalizeReport(basic)!.overall.overallScore);
      expect(checkScoreFilter(score, 'scale5', 'A')).toBe(true);
      expect(checkScoreFilter(score, 'scale5', 'B+')).toBe(false);
    }
  });

  test('communication criteria read their own report values, including zero', () => {
    const metric = (name: string) => getCandidateScore(candidate, 'BASIC', 'Communication', name, null, 'BASIC', basic);
    expect(metric('Overall Score')).toBe(44);
    expect(metric('Fluency')).toBe(75);
    expect(metric('Grammar')).toBe(0);
    expect(metric('Pronunciation')).toBe(90);
    expect(metric('Vocabulary')).toBe(56);
    expect(checkScoreFilter(metric('Grammar'), 'scale5', 'F')).toBe(true);
  });

  test('TECHNICAL overall, communication, and confidence are separate scores', () => {
    expect(getCandidateScore(candidate, 'TECHNICAL', 'Overall Result', null, null, 'TECHNICAL', technical)).toBe(68);
    expect(getCandidateScore(candidate, 'TECHNICAL', 'Technical Analysis (Overall Score)', null, null, 'TECHNICAL', technical)).toBe(68);
    expect(getCandidateScore(candidate, 'TECHNICAL', 'Interview Analysis (Confidence Score)', null, null, 'TECHNICAL', technical)).toBe(73);
    expect(getCandidateScore(candidate, 'TECHNICAL', 'Communication', 'Overall Score', null, 'TECHNICAL', technical)).toBe(87);
  });

  test('snake case, camel case, and API envelopes produce identical grades', () => {
    const camel = { interviewDetails: { roundType: 'BASIC' }, report: { overallScore: 82 } };
    for (const raw of [basic, camel, { status: 'SUCCESS', data: basic }]) {
      expect(getCandidateScore(candidate, 'BASIC', 'Overall Score', null, null, 'BASIC', raw)).toBe(82);
    }
  });

  test('assessment round supplies missing report metadata for display and filtering', () => {
    const raw = { report: { overall_score: 82, communication_analysis: { overall_score: 45 } } };
    expect(normalizeReport(raw, 'BASIC')!.overall.communication!.overall_score).toBe(45);
    expect(getCandidateScore(candidate, 'BASIC', 'Communication', 'Overall Score', null, 'BASIC', raw)).toBe(45);
  });

  test('missing reports or metrics do not become synthetic values or grade F', () => {
    expect(getCandidateScore(candidate, 'BASIC', 'Overall Score', null, null, 'BASIC')).toBeNull();
    const missing = { ...basic, report: { overall_score: 82 } };
    const score = getCandidateScore(candidate, 'BASIC', 'Communication', 'Fluency', null, 'BASIC', missing);
    expect(score).toBeNull();
    expect(checkScoreFilter(score, 'scale5', 'F')).toBe(false);
    for (const invalid of [null, NaN, Infinity, -1, 101]) expect(checkScoreFilter(invalid, 'scale5', 'F')).toBe(false);
  });

  test('filters never use scores from a different round or a report that is still processing', () => {
    expect(getCandidateScore(candidate, 'TECHNICAL', 'Overall Result', null, null, 'BASIC', basic)).toBeNull();
    expect(getCandidateScore(candidate, 'BASIC', 'Overall Score', null, null, 'BASIC', technical)).toBeNull();
    expect(getCandidateScore({ ...candidate, reportStatus: 'GENERATING' }, 'BASIC', 'Overall Score', null, null, 'BASIC', basic)).toBeNull();
  });

  test('HR metrics use actual reported competency and personality scores', () => {
    const raw = { interview_details: { round_type: 'HR' }, report: { overall_result: {
      hr_competency_analysis: { leadership: 8, creativity_and_innovation: 70 },
      vils_competency_analysis: { leading_and_deciding: 62 },
      personality_insights: { personal_values_big_five: { openness: { score: 72 } } },
    } } };
    expect(getCandidateScore(candidate, 'HR', 'HR Competency Analysis', 'Leadership', null, 'HR', raw)).toBe(8);
    expect(getCandidateScore(candidate, 'HR', 'HR Competency Analysis', 'Creativity & Innovation', null, 'HR', raw)).toBe(70);
    expect(getCandidateScore(candidate, 'HR', 'VILS Competency Analysis', 'Leading and Deciding', null, 'HR', raw)).toBe(62);
    expect(getCandidateScore(candidate, 'HR', 'Values & Personality', 'Personal Values (Big Five)', 'Openness', 'HR', raw)).toBe(72);
    expect(checkScoreFilter(8, 'scale3', '0 - 30')).toBe(true);
  });

  test('multiple criteria match the same report using AND', () => {
    const score = (l2: string, l3: string | null) => getCandidateScore(candidate, 'BASIC', l2, l3, null, 'BASIC', basic);
    expect(checkScoreFilter(score('Overall Score', null), 'scale5', 'A') && checkScoreFilter(score('Communication', 'Fluency'), 'scale5', 'B+')).toBe(true);
    expect(checkScoreFilter(score('Overall Score', null), 'scale5', 'A') && checkScoreFilter(score('Communication', 'Fluency'), 'scale5', 'B')).toBe(false);
  });
});
