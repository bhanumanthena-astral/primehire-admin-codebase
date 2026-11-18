import {expect,it} from 'vitest';
import {hiringTerm} from './hrTerminology';
it('uses HR labels without changing Super Admin terminology',()=>{
 expect(hiringTerm('Open Seats','admin')).toBe('Open Positions');
 expect(hiringTerm('Worker Error','recruiter')).toBe('Processing Issue');
 expect(hiringTerm('Open Seats','super_admin')).toBe('Open Seats');
 expect(hiringTerm('Unchanged label','hr')).toBe('Unchanged label');
});

it('simplifies Admin navigation while keeping Super Admin entries unchanged',async()=>{
 const {hiringNavigation}=await import('./hrTerminology');
 const tabs=[{id:'jobs',label:'Jobs'},{id:'resumes',label:'Resume Upload'},{id:'applicants',label:'Applicants'},{id:'assessments',label:'Assessments & Profiles'}];
 expect(hiringNavigation(tabs,'admin')).toEqual([{id:'jobs',label:'Jobs'},{id:'assessments',label:'Assessments'}]);
 expect(hiringNavigation(tabs,'super_admin')).toBe(tabs);
});
