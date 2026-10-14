import { describe, expect, it } from 'vitest';
import { getAssessmentAvailability } from '../utils/assessmentAvailability';
import { mapMongoAssessment } from '../lib/mongoApi';

const started = Date.parse('2026-10-13T06:30:00Z');
const savedDocument = {
  jobId: 'JOB-TEST', roundType: 'BASIC', questions: [],
  syncState: { state: 'synced' }, candidateCreationAvailableAt: '2026-10-13T06:35:00+00:00',
};

describe('Assessment preparation deadline', () => {
  it('uses the saved deadline on a fresh page load, with only the remaining wait', () => {
    const first = getAssessmentAvailability(mapMongoAssessment(savedDocument), started);
    expect(first.canAddCandidates).toBe(false);
    expect(first.remainingSeconds).toBe(300);
    const reload = getAssessmentAvailability(mapMongoAssessment(JSON.parse(JSON.stringify(savedDocument))), started + 120_000);
    expect(reload.remainingSeconds).toBe(180);
    expect(reload.message).toContain('3:00');
  });

  it('unlocks at exactly five minutes and stays unlocked after further reloads', () => {
    expect(getAssessmentAvailability(mapMongoAssessment(savedDocument), started + 299_999).canAddCandidates).toBe(false);
    for (const offset of [300_000, 360_000, 86_400_000]) {
      expect(getAssessmentAvailability(mapMongoAssessment(savedDocument), started + offset).canAddCandidates).toBe(true);
    }
  });

  it.each(['pending', 'failed'])('does not unlock unsuccessful %s setup after five minutes', state => {
    expect(getAssessmentAvailability(mapMongoAssessment({ ...savedDocument, syncState: { state } }), started + 86_400_000).canAddCandidates).toBe(false);
  });

  it('allows legacy assessments and refuses malformed preparation timestamps', () => {
    expect(getAssessmentAvailability(mapMongoAssessment({ ...savedDocument, candidateCreationAvailableAt: null }), started).canAddCandidates).toBe(true);
    expect(getAssessmentAvailability(mapMongoAssessment({ ...savedDocument, candidateCreationAvailableAt: 'invalid' }), started).canAddCandidates).toBe(false);
  });

  it('normalizes a timezone-less UTC server deadline before comparing it', () => {
    expect(getAssessmentAvailability(mapMongoAssessment({ ...savedDocument, candidateCreationAvailableAt: '2026-10-13T06:35:00' }), started).remainingSeconds).toBe(300);
  });
});
