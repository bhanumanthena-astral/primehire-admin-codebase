import {render,screen,fireEvent,waitFor,within} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import {MemoryRouter} from 'react-router-dom';
import ReportsWorkspace from '../ReportsWorkspace';
import {StoredReportEvidence} from '../report/StoredReportEvidence';
import {reportingRequest} from '../../lib/reportingApi';
import {chooseSelect} from '../../test-select';
vi.mock('../../lib/reportingApi',()=>({reportingRequest:vi.fn(),reportingResponse:vi.fn(),exportStoredReport:vi.fn()}));
const metadata:any={reportId:'r1',candidateName:'Asha Rao',candidateId:'person1',applicationId:'app1',jobId:'job1',jobTitle:'Backend Engineer',roundId:'round1',roundType:'TECHNICAL',attemptId:'attempt1',version:1,status:'Completed',generationStatus:'Completed',isCurrent:true,isOfficialAttempt:true,canView:true,generatedAt:'2026-11-02T04:30:00Z'};
const metric={label:'Technical',value:0,maximum:null,grade:null,applicable:null};
const content:any={schemaSupported:true,overview:metric,feedback:[metric],skillProfile:[],communication:[],distribution:[],questions:[{reference:'q1',id:'question1',question:'Source question',score:0,maximum:null,status:'Completed',transcript:null,relevancy:null,weightage:0,aiAnalysis:null,feedback:null,strengths:[],areasForImprovement:[],recommendations:[],mediaReference:null}],proctoring:null,aiSummary:null,missingSections:[]};
const capabilities={enabled:true,canRefresh:false,canExport:false,canManageVersions:false,timezone:'Asia/Kolkata'};
function setup({items=[metadata],detail={metadata,content,versions:[metadata],versionCount:1}}:any={}){vi.mocked(reportingRequest).mockImplementation(async path=>path==='/capabilities'?capabilities:path.startsWith('/reports/r1')?detail:{items,total:30,skip:0,limit:25});}
function renderWorkspace(path='/reports'){return render(<MemoryRouter initialEntries={[path]}><ReportsWorkspace/></MemoryRouter>);}
beforeEach(()=>vi.resetAllMocks());
it('lists context and preserves server filters when paginating',async()=>{
 setup();renderWorkspace('/reports?status=Completed');
 await screen.findByText('Asha Rao');
 await chooseSelect(screen.getByRole('combobox',{name:'Report round type'}),'TECHNICAL');
 await waitFor(()=>expect(vi.mocked(reportingRequest).mock.calls.some(([path])=>path.includes('roundType=TECHNICAL')&&path.includes('status=Completed'))).toBe(true));
 fireEvent.click(screen.getByRole('button',{name:'Next reports'}));
 await waitFor(()=>expect(vi.mocked(reportingRequest).mock.calls.some(([path])=>path.includes('skip=25')&&path.includes('roundType=TECHNICAL')&&path.includes('status=Completed'))).toBe(true));
});
it('opens exactly the selected report and preserves zero without inventing a maximum',async()=>{
 setup();renderWorkspace();await screen.findByText('Asha Rao');
 fireEvent.click(screen.getByRole('button',{name:'View report'}));
 await screen.findByRole('heading',{name:'Asha Rao · TECHNICAL report'});
 expect(screen.getByText('Source question · 0',{exact:false})).toBeInTheDocument();
 expect(screen.queryByText('0 / 100')).not.toBeInTheDocument();
 expect(screen.getByText('Proctoring data unavailable.')).toBeVisible();
 expect(screen.queryByRole('button',{name:'Export this version'})).not.toBeInTheDocument();
});
it('shows generation state for completed rounds whose report is still processing',async()=>{
 setup({detail:{metadata:{...metadata,status:'Processing',canView:false},content:null,versions:[metadata]}});renderWorkspace('/reports/r1');
 expect(await screen.findByText(/round may be complete while its report is still processing/)).toBeVisible();
 expect(screen.queryByText('Source question')).not.toBeInTheDocument();
});
it('preserves a direct historical version and displays its context',async()=>{
 setup({detail:{metadata:{...metadata,isCurrent:false},content,versions:[{...metadata,version:2},metadata],versionCount:2}});renderWorkspace('/reports/r1?version=1');
 expect(await screen.findByText(/historical or controlled report/)).toBeVisible();
 expect(vi.mocked(reportingRequest).mock.calls.some(([path])=>path==='/reports/r1?version=1')).toBe(true);
});
it('does not fabricate Technical sections for unsupported round schemas',()=>{
 render(<StoredReportEvidence content={{...content,schemaSupported:false}} reportId="r1" version={1}/>);
 expect(screen.getByRole('heading',{name:'Round-specific schema unavailable'})).toBeVisible();
 expect(screen.queryByText('Question analysis')).not.toBeInTheDocument();
});
it('shows a recoverable permission error without report evidence',async()=>{
 vi.mocked(reportingRequest).mockRejectedValue(new Error('Report not found or not accessible'));
 renderWorkspace('/reports/r1');
 expect(await screen.findByRole('alert')).toHaveTextContent('not accessible');
 expect(screen.getByRole('button',{name:'Retry reports'})).toBeVisible();
 expect(screen.queryByText('Source question')).not.toBeInTheDocument();
});
