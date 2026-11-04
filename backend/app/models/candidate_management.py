"""V2-only profile and candidate-assessment relationship indexes."""
INDEXES = {
    'candidate_assignments': [
        ([('assignmentId',1)], {'unique':True,'name':'cm_assignment_id'}),
        ([('orgId',1),('candidateId',1),('assessmentId',1)], {'unique':True,'name':'cm_unique_assignment'}),
        ([('orgId',1),('candidateId',1),('createdAt',-1)], {'name':'cm_candidate_assignments'}),
        ([('orgId',1),('assessmentId',1),('status',1)], {'name':'cm_assessment_status'}),
    ],
    'applicants': [([('orgId',1),('createdAt',-1),('applicantId',1)], {'name':'cm_people_listing'})],
}
