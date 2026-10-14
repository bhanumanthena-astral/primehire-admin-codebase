import type { AssessmentProfile } from '../types';

export function getAssessmentAvailability(assessment: AssessmentProfile, now = Date.now()) {
  if (assessment.syncState?.state === 'pending' || assessment.syncState?.state === 'failed') {
    return { canAddCandidates: false, remainingSeconds: 0, message: 'Assessment setup needs to finish before candidates can be added.' };
  }
  const rawDeadline = assessment.candidateCreationAvailableAt;
  if (!rawDeadline) return { canAddCandidates: true, remainingSeconds: 0, message: '' };
  const deadline = Date.parse(rawDeadline);
  if (!Number.isFinite(deadline)) {
    return { canAddCandidates: false, remainingSeconds: 0, message: 'Preparation time is unavailable. Refresh to check the assessment.' };
  }
  const remainingSeconds = Math.max(0, Math.ceil((deadline - now) / 1000));
  return {
    canAddCandidates: remainingSeconds === 0,
    remainingSeconds,
    message: remainingSeconds ? `Preparing assessment · ${formatPreparationTime(remainingSeconds)} remaining` : '',
  };
}

export function formatPreparationTime(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
