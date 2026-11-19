import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { chooseSelect } from '../../test-select';
import AssessmentsAndAssignments from '../AssessmentsAndAssignments';
import { AssessmentLibrary } from '../assessments/AssessmentLibrary';
import { AssessmentCsvDialog } from '../assessments/AssessmentCsvDialog';
import { AssessmentError, assessmentRequest, assessmentFormDate, assessmentInputDate, configFromForm } from '../../lib/assessmentManagementApi';
import {candidateRequest} from '../../lib/candidateManagementApi';
vi.mock('../../lib/assessmentManagementApi',async original=>({...await original<any>(),assessmentRequest:vi.fn()}));
vi.mock('../../lib/candidateManagementApi',async original=>({...await original<any>(),candidateRequest:vi.fn()}));

const record:any={id:'JOB-test',jobId:'JOB-test',jobTitle:'Test Assessment',jobDescription:'Build reliable services',language:'ENGLISH',roundType:'TECHNICAL',
  startDate:'2027-01-01T00:00:00Z',endDate:'2027-01-31T00:00:00Z',createdAt:'2026-10-19T06:00:00Z',revision:1,publicationState:'draft',status:'Draft',canEdit:true,canPublish:true,
  questions:[{id:'q_1',text:'Explain a dictionary',type:'SPEAK_TO_ANSWER',referenceAnswer:'Key value pairs',maxDuration:120,maxScore:10,weightage:100}]};
beforeEach(()=>{
  vi.mocked(assessmentRequest).mockReset();
  vi.mocked(assessmentRequest).mockImplementation(async(path,body)=>{
    if(path==='/capabilities')return {enabled:true,canManage:true} as any;
    if(path?.startsWith('?'))return {items:[],total:0} as any;
    return record;
  });
});

it('extends an expired published assessment using the date-only editor',async()=>{
  const expired={...record,publicationState:'published',status:'Completed',canEdit:false,canPublish:false,canEditDates:true,
    startDate:'2025-01-01T00:00:00Z',endDate:'2025-01-31T00:00:00Z'};
  vi.mocked(assessmentRequest).mockImplementation(async(path,body)=>{
    if(path?.startsWith('?'))return {items:[expired],total:1} as any;
    if(path?.endsWith('/dates'))return {...expired,...body as object,status:'Active',revision:3} as any;
    return expired as any;
  });
  render(<AssessmentLibrary canManage onNew={vi.fn()} onEdit={vi.fn()} onAssignments={vi.fn()} onPublished={vi.fn()}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Edit dates'}));
  const dialog=await screen.findByRole('dialog',{name:'Edit assessment dates'});
  fireEvent.change(within(dialog).getByLabelText('End date (IST)'),{target:{value:'2029-01-31T18:00'}});
  fireEvent.click(within(dialog).getByRole('button',{name:'Save dates'}));
  await screen.findByText('Assessment dates updated successfully.');
  expect(assessmentRequest).toHaveBeenCalledWith('/JOB-test/dates',{
    expectedRevision:1,startDate:'2025-01-01T00:00:00.000Z',endDate:'2029-01-31T12:30:00.000Z',
  },'PUT');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

describe('Assessment Management additions',()=>{
  it('opens the job candidate invitation table from a published assessment action',async()=>{
    const published={...record,publicationState:'published',status:'Active',canEdit:false,canPublish:false};
    vi.mocked(assessmentRequest).mockResolvedValue({items:[published],total:1} as any);
    const viewTable=vi.fn();
    render(<AssessmentLibrary canManage onNew={vi.fn()} onEdit={vi.fn()} onAssignments={vi.fn()} onPublished={vi.fn()} onViewTable={viewTable}/>);
    fireEvent.click(await screen.findByRole('button',{name:'View table'}));
    expect(viewTable).toHaveBeenCalledWith(published);
  });
  it('opens native V2 candidate assignments without using legacy provider routes',async()=>{
    const published={...record,publicationState:'published',status:'Active',canEdit:false,canPublish:false};
    vi.mocked(assessmentRequest).mockImplementation(async path=>path==='/capabilities'?{enabled:true,canManage:true}:path?.startsWith('?')?{items:[published],total:1}:published as any);
    vi.mocked(candidateRequest).mockResolvedValue({items:[],total:0});
    const openCandidates=vi.fn();
    function Harness(){const [items,setItems]=React.useState([published]);return <AssessmentsAndAssignments assessments={items} candidates={[]} templates={[]}
      onSetAssessments={setItems} onSetCandidates={vi.fn()} onOpenReport={vi.fn()} onOpenCandidates={openCandidates}/>;}
    render(<Harness/>);
    fireEvent.click(await screen.findByRole('button',{name:'View'},{timeout:5000}));
    fireEvent.click(await screen.findByRole('button',{name:'Candidate assignments'}));
    expect(await screen.findByRole('heading',{name:'Candidate assignments'})).toBeVisible();
    fireEvent.click(screen.getByRole('button',{name:'View assignment statuses'}));
    expect(await screen.findByText('No candidate assignments in your access scope.')).toBeVisible();
    expect(candidateRequest).toHaveBeenCalledWith('/assessment-assignments/JOB-test?skip=0',undefined,'GET',expect.any(AbortSignal));
    fireEvent.click(screen.getByRole('button',{name:'Manage assignments in Candidates'}));
    expect(openCandidates).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button',{name:'Generate link'})).not.toBeInTheDocument();
  });
  it('keeps the question form and requires preview and confirmation before saving a draft',async()=>{
    render(<AssessmentsAndAssignments assessments={[]} candidates={[]} templates={[]} onSetAssessments={vi.fn()} onSetCandidates={vi.fn()} onOpenReport={vi.fn()}/>);
    fireEvent.click(await screen.findByRole('button',{name:'New assessment'}));
    fireEvent.change(screen.getByLabelText('Assessment job title'),{target:{value:'Test Assessment'}});
    fireEvent.change(screen.getByLabelText('Assessment job description'),{target:{value:'Build reliable services'}});
    fireEvent.change(screen.getByLabelText('Assessment start date'),{target:{value:'2027-01-01T10:00'}});
    fireEvent.change(screen.getByLabelText('Assessment end date'),{target:{value:'2027-01-31T10:00'}});
    fireEvent.change(screen.getByLabelText('Question 1 prompt'),{target:{value:'Explain a dictionary'}});
    fireEvent.change(screen.getByLabelText('Question 1 reference answer'),{target:{value:'Key value pairs'}});
    fireEvent.change(screen.getByLabelText('Question 1 weightage'),{target:{value:'100'}});
    fireEvent.click(screen.getByRole('button',{name:'Preview assessment draft'}));
    const preview=await screen.findByRole('dialog',{name:'Preview assessment draft'});
    expect(preview).toHaveTextContent('Key value pairs');
    expect(vi.mocked(assessmentRequest).mock.calls.some(([,body])=>!!body)).toBe(false);
    vi.mocked(assessmentRequest).mockRejectedValueOnce(new AssessmentError('Revision changed; reload before saving',[],409));
    fireEvent.click(within(preview).getByRole('button',{name:'Confirm and save draft'}));
    expect(await within(preview).findByRole('alert')).toHaveTextContent('Revision changed');
    expect(screen.getByLabelText('Assessment job title')).toHaveValue('Test Assessment');
    expect(assessmentRequest).toHaveBeenLastCalledWith('',expect.objectContaining({config:expect.objectContaining({startDate:'2027-01-01T04:30:00.000Z'})}),'POST');
  });

  it('shows a scoped empty state and hides creation actions for read-only users',async()=>{
    render(<AssessmentLibrary canManage={false} onNew={vi.fn()} onEdit={vi.fn()} onAssignments={vi.fn()} onPublished={vi.fn()}/>);
    expect(await screen.findByText('No assessments are available in your access scope.')).toBeVisible();
    expect(screen.queryByRole('button',{name:'New assessment'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'Import assessment CSV'})).not.toBeInTheDocument();
    await chooseSelect(screen.getByLabelText('Assessment language filter'),'DUTCH');
    await waitFor(()=>expect(vi.mocked(assessmentRequest).mock.calls.some(([path])=>path?.includes('language=DUTCH'))).toBe(true));
    fireEvent.click(screen.getByRole('button',{name:'Clear filters'}));
    await waitFor(()=>expect(vi.mocked(assessmentRequest).mock.calls.at(-1)?.[0]).not.toContain('language='));
  });

  it('loads current details and locks publication behind explicit confirmation',async()=>{
    vi.mocked(assessmentRequest).mockImplementation(async path=>path?.startsWith('?')?{items:[record],total:1}:record as any);
    render(<AssessmentLibrary canManage onNew={vi.fn()} onEdit={vi.fn()} onAssignments={vi.fn()} onPublished={vi.fn()}/>);
    fireEvent.click(await screen.findByRole('button',{name:'View'}));
    expect(await screen.findByText('Key value pairs')).toBeVisible();
    fireEvent.click(screen.getByRole('button',{name:'Preview publication'}));
    const dialog=await screen.findByRole('dialog',{name:'Confirm assessment publication'});
    expect(vi.mocked(assessmentRequest).mock.calls.some(([path])=>path?.endsWith('/publish'))).toBe(false);
    fireEvent.click(within(dialog).getByRole('button',{name:'Confirm and publish'}));
    await waitFor(()=>expect(assessmentRequest).toHaveBeenCalledWith('/JOB-test/publish',{expectedRevision:1,confirmed:true}));
  });

  it('shows CSV group validation and requires a second confirmation for import',async()=>{
    const preview:any={previewHash:'a'.repeat(64),fileErrors:[],rows:[{row:2,groupId:'group',status:'valid',errors:[]},{row:3,groupId:'bad',status:'invalid',errors:[{field:'Question prompt',reason:'Required'}]}],
      groups:[{groupId:'group',status:'valid',rows:[2],config:record},{groupId:'bad',status:'invalid',rows:[3],config:null}]};
    vi.mocked(assessmentRequest).mockImplementation(async(path)=>path==='/csv/validate'?preview:{totalRows:2,totalGroups:2,imported:1,failed:1,duplicates:0,rows:preview.rows,items:[]} as any);
    render(<AssessmentCsvDialog onClose={vi.fn()} onImported={vi.fn()}/>);
    const file=new File(['test'],'assessments.csv',{type:'text/csv'});Object.defineProperty(file,'text',{value:async()=> 'test'});
    fireEvent.change(screen.getByLabelText('Assessment CSV file'),{target:{files:[file]}});
    expect(await screen.findByText('Question prompt: Required')).toBeVisible();
    fireEvent.click(screen.getByRole('button',{name:'Import valid questions'}));
    expect(vi.mocked(assessmentRequest).mock.calls.some(([path])=>path==='/csv/import')).toBe(false);
    fireEvent.click(screen.getByRole('button',{name:'Confirm import'}));
    expect(await screen.findByRole('region',{name:'Assessment import summary'})).toHaveTextContent('1 drafts created');
  });

  it('does not reopen details when a request finishes after navigating back',async()=>{
    let resolve!:(value:any)=>void;
    vi.mocked(assessmentRequest).mockImplementation(async path=>path?.startsWith('?')?{items:[record],total:1}:new Promise(done=>{resolve=done;}) as any);
    render(<AssessmentLibrary canManage onNew={vi.fn()} onEdit={vi.fn()} onAssignments={vi.fn()} onPublished={vi.fn()}/>);
    fireEvent.click(await screen.findByRole('button',{name:'View'}));
    const signal=vi.mocked(assessmentRequest).mock.calls.find(([path])=>path==='/JOB-test')?.[3];
    fireEvent.click(screen.getByRole('button',{name:'Back to assessments'}));
    expect(signal?.aborted).toBe(true);
    await act(async()=>resolve(record));
    expect(screen.getByRole('heading',{name:'All assessments'})).toBeVisible();
    expect(screen.queryByRole('button',{name:'Preview publication'})).not.toBeInTheDocument();
  });
});

it('preserves explicit IST windows and maps MCQ expected answers without provider calls',()=>{
  expect(assessmentInputDate(assessmentFormDate('2027-01-01T10:00'))).toBe('2027-01-01T10:00');
  expect(configFromForm({...record,questions:[{...record.questions[0],type:'MCQ',referenceAnswer:undefined,options:['A','B'],correctOption:'B'}]}).questions[0].referenceAnswer).toBe('B');
  expect(configFromForm({...record,roundType:'BASIC',questions:[{...record.questions[0],referenceAnswer:'Imported rubric',criteria:'Updated rubric'}]}).questions[0].referenceAnswer).toBe('Updated rubric');
});

it('lets users correct grouped dates and a question, revalidate, then import the corrected text and hash',async()=>{
 const columns=['Job Title','Job Description','Language Selection','Round Type','Start Date','End Date','Question Type','Max Duration (Seconds)','Max Score','Weightage (%)','Question Prompt / Text','Expected Reference Answer'];
 const values={'Job Title':'Intern','Job Description':'Frontend role','Language Selection':'English','Round Type':'Wrong round','Start Date':'bad date','End Date':'bad date','Question Type':'Invalid type','Max Duration (Seconds)':'120','Max Score':'5','Weightage (%)':'50','Question Prompt / Text':'Explain HTML','Expected Reference Answer':'Markup'};
 const invalid:any={columns,previewHash:'a'.repeat(64),fileErrors:[],rows:[2,3].map(row=>({row,groupId:'Assessment 1',status:'invalid',values:{...values},errors:[{field:'Start Date',reason:'Use a valid date'}]})),groups:[{groupId:'Assessment 1',status:'invalid',rows:[2,3],config:null}]};
 const valid={...invalid,previewHash:'b'.repeat(64),rows:invalid.rows.map((row:any)=>({...row,status:'valid',errors:[]})),groups:[{groupId:'Assessment 1',status:'valid',rows:[2,3],config:record}]};
 let validations=0;
 vi.mocked(assessmentRequest).mockImplementation(async(path)=>path==='/csv/validate'?(++validations===1?invalid:valid):{totalRows:2,totalGroups:1,imported:1,failed:0,duplicates:0,rows:valid.rows,items:[]} as any);
 render(<AssessmentCsvDialog onClose={vi.fn()} onImported={vi.fn()}/>);
 const file=new File(['source'],'source.csv',{type:'text/csv'});Object.defineProperty(file,'text',{value:async()=> 'source'});
 fireEvent.change(screen.getByLabelText('Assessment CSV file'),{target:{files:[file]}});
 await screen.findByText(/0 valid assessments/);
 expect(screen.getByRole('button',{name:'Import valid questions'})).toBeDisabled();
 fireEvent.click(screen.getByText('Edit CSV values before importing'));
 fireEvent.change(screen.getByLabelText('Start Date'),{target:{value:'2027-01-01'}});
 fireEvent.change(screen.getByLabelText('End Date'),{target:{value:'2027-02-01'}});
 fireEvent.change(screen.getByLabelText('Round Type'),{target:{value:'TECHNICAL'}});
 fireEvent.change(screen.getByLabelText('Question Type'),{target:{value:'SPEAK_TO_ANSWER'}});
 fireEvent.change(screen.getByLabelText('Question Prompt / Text'),{target:{value:'Explain "HTML", including\nsemantics'}});
 expect(screen.getByText(/Corrections have not been validated/)).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'Validate corrections'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Import valid questions'})).toBeEnabled());
 const corrected=(vi.mocked(assessmentRequest).mock.calls.filter(([path])=>path==='/csv/validate').at(-1)?.[1] as any).text;
 expect(corrected.match(/2027-01-01/g)).toHaveLength(2);
 expect(corrected).toContain('Explain ""HTML"", including\nsemantics');
 fireEvent.click(screen.getByRole('button',{name:'Import valid questions'}));
 expect(vi.mocked(assessmentRequest).mock.calls.some(([path])=>path==='/csv/import')).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:'Confirm import'}));
 await waitFor(()=>expect(assessmentRequest).toHaveBeenCalledWith('/csv/import',{text:corrected,previewHash:'b'.repeat(64),confirmed:true}));
 expect(await screen.findByText('Import complete')).toBeVisible();
});
