import {describe,expect,it} from 'vitest';
import type {Candidate,AssessmentProfile} from '../types';
import {matchesCandidateFilters,matchesAssessmentFilters} from '../utils/portalFilters';

const profiles=[{id:'JOB-1',jobTitle:'Front End Developer',roundType:'BASIC'}] as AssessmentProfile[];
const candidate={id:'CAND-1',assessmentId:'JOB-1',name:'Test Candidate',email:'candidate@example.test',reportStatus:'GENERATED'} as Candidate;

describe('Shared portal filter results',()=>{
  it('matches assessment descriptions consistently across all profile counts',()=>{
    const profile={...profiles[0],jobDescription:'React and accessibility'};
    expect(matchesAssessmentFilters(profile,'BASIC',' ACCESSIBILITY ')).toBe(true);
    expect(matchesAssessmentFilters(profile,'HR','accessibility')).toBe(false);
  });
  it('handles legacy profiles without descriptions',()=>{
    expect(matchesAssessmentFilters(profiles[0],'ALL',' Front End ')).toBe(true);
    expect(matchesAssessmentFilters(profiles[0],'ALL','unmatched')).toBe(false);
  });
  it('matches the same round, report status, and title for summary and directory',()=>{
    expect(matchesCandidateFilters(candidate,profiles,'BASIC','GENERATED','  front END  ')).toBe(true);
  });
  it('excludes candidates from other rounds or report states',()=>{
    expect(matchesCandidateFilters(candidate,profiles,'HR','GENERATED','')).toBe(false);
    expect(matchesCandidateFilters(candidate,profiles,'BASIC','GENERATING','')).toBe(false);
  });
  it('matches pending reports only when no report status is present',()=>{
    expect(matchesCandidateFilters({...candidate,reportStatus:null},profiles,'ALL','PENDING','')).toBe(true);
    expect(matchesCandidateFilters(candidate,profiles,'ALL','PENDING','')).toBe(false);
  });
  it('searches both candidate name and email without case sensitivity',()=>{
    expect(matchesCandidateFilters(candidate,profiles,'ALL','ALL','TEST CANDIDATE')).toBe(true);
    expect(matchesCandidateFilters(candidate,profiles,'ALL','ALL','EXAMPLE.TEST')).toBe(true);
  });
  it('handles unmapped profiles without losing candidate name searches',()=>{
    expect(matchesCandidateFilters(candidate,[],'ALL','ALL','Test')).toBe(true);
    expect(matchesCandidateFilters(candidate,[],'BASIC','ALL','Test')).toBe(false);
  });
});
