import type { Candidate, AssessmentProfile } from '../types';

export function matchesAssessmentFilters(assessment: AssessmentProfile, round: string, query: string) {
  const search = query.trim().toLowerCase();
  return (round === 'ALL' || assessment.roundType === round) &&
    (!search || [assessment.jobTitle, assessment.jobId, assessment.jobDescription].some(value => value?.toLowerCase().includes(search)));
}

export function matchesCandidateFilters(candidate: Candidate, assessments: AssessmentProfile[], round: string, status: string, query: string) {
  const assessment = assessments.find(item => item.id === candidate.assessmentId);
  const search = query.trim().toLowerCase();
  return (round === 'ALL' || assessment?.roundType === round) &&
    (status === 'ALL' || status === candidate.reportStatus || (status === 'PENDING' && !candidate.reportStatus)) &&
    (!search || [candidate.name, candidate.email, assessment?.jobTitle].some(value => value?.toLowerCase().includes(search)));
}
