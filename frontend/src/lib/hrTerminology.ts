/** Presentation labels only. API fields and stored status values stay stable. */
export const HR_TERMS:Record<string,string>={
 'Open Seats':'Open Positions',
 'Candidate Ingestion':'Resume Upload',
 'Parsing Queue':'Resumes Being Processed',
 'ATS Processing':'Resume Screening',
 'Pipeline Transition':'Move to Next Stage',
 'Assessment Allocation':'Assign Assessment',
 'Evaluation Artifact':'Candidate Report',
 'Scheduling Payload':'Interview Details',
 'Unmapped profile':'Assessment Not Assigned',
 'Worker Error':'Processing Issue',
 'Duplicate suspected':'Potential Duplicate',
 'Queued':'Waiting to process',
 'Failed':'Processing Issue',
 'Processing is waiting for a resume worker. Uploads remain safely queued until a worker connects.':'Resume processing is temporarily unavailable. Uploaded files are safely saved and will continue automatically when processing resumes.',
};
export function hiringTerm(label:string,role?:string):string{
 return role==='super_admin'?label:HR_TERMS[label]??label;
}

/** Job-scoped upload/screening replace duplicate Admin entry points. */
export function hiringNavigation<T extends {id:string;label:string}>(tabs:T[],role?:string):T[]{
 if(role!=='admin')return tabs;
 return tabs.filter(tab=>!['resumes','applicants','applicant'].includes(tab.id)).map(tab=>({...tab,label:tab.id==='assessments'?'Assessments':tab.id==='recruitment'?'Interviews':tab.label}));
}
