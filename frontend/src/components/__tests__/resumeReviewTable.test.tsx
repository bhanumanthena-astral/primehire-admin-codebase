import {render,screen,fireEvent,within,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import {ResumeReviewTable} from '../ResumeReviewTable';
import {intakeGet,intakeMutate} from '../../lib/resumeIntakeApi';
import {fetchJobsPage} from '../../lib/hiringApi';
import {chooseSelect} from '../../test-select';
vi.mock('../../lib/resumeIntakeApi',()=>({intakeGet:vi.fn(),intakeMutate:vi.fn(),intakeDownload:vi.fn(),intakeBlob:vi.fn()}));
vi.mock('../../lib/hiringApi',()=>({fetchJobsPage:vi.fn()}));
const item:any={itemId:'i1',batchId:'b',fileName:'resume.pdf',revision:3,status:'completed',profile:{name:'Asha'},ats:{overall:66,category:'Good',breakdown:{skills:59,experience:null,education:100,keyword:59,role:67},matchedSkills:['Python','SQL'],missingSkills:['AWS'],strengths:['Matched 2 skills'],gaps:['Experience is unavailable'],note:'Local score retained.',llmStatus:'rate_limited',localOverall:66,needsReview:true}};
const caps:any={canUpload:true,canAssign:true,canAdmin:true,canDownload:true};
function props(){return {items:[item],caps,jobs:[],busy:false,onOpen:vi.fn(),onRetry:vi.fn(),onDelete:vi.fn(),onChanged:vi.fn(),onAssociated:vi.fn()};}
beforeEach(()=>{vi.resetAllMocks();vi.mocked(fetchJobsPage).mockResolvedValue({items:[{jobId:'j2',title:'Other job',jobKey:'OTHER',lifecycleStatus:'OPEN'} as any],total:1});vi.mocked(intakeGet).mockImplementation(async path=>path.includes('assignees')?{items:[{userId:'r1',name:'Reviewer One',role:'hr'}],hasMore:false}:{items:[item],hasMore:false});vi.mocked(intakeMutate).mockResolvedValue({...item,revision:4});});
it('expands evaluation and assignment tables without opening a profile modal',async()=>{
 const p=props();render(<ResumeReviewTable {...p}/>);
 fireEvent.click(screen.getByRole('button',{name:'Expand ATS details for Asha'}));
 expect(screen.getByRole('table',{name:'Local scoring breakdown'})).toHaveTextContent('Not assessed');
 expect(screen.getAllByText('Python, SQL').length).toBeGreaterThan(0);
 expect(screen.getAllByText(/Reviewer attention required. Check/).length).toBeGreaterThan(0);
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
 await waitFor(()=>expect(fetchJobsPage).toHaveBeenCalled());
 await chooseSelect(screen.getByRole('combobox',{name:'Assign reviewer'}),'r1');
 fireEvent.click(screen.getByRole('button',{name:'Assign reviewer'}));
 await waitFor(()=>expect(intakeMutate).toHaveBeenCalledWith('/items/i1/assign',{userId:'r1',expectedRevision:3},'POST'));
 expect(await screen.findByText('Reviewer assigned.')).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'View profile'}));expect(p.onOpen).toHaveBeenCalledWith('i1');
});
it('sorts scores including zero and leaves unscored rows last',()=>{
 render(<ResumeReviewTable {...props()} items={[item,{...item,itemId:'i2',profile:{name:'Zero'},ats:{...item.ats,overall:0}},{...item,itemId:'i3',profile:{name:'Pending'},ats:null}]}/>);
 fireEvent.click(screen.getByRole('button',{name:'ATS score'}));
 let rows=within(screen.getByRole('table',{name:'Resume and ATS review'})).getAllByRole('row');
 expect(rows[1]).toHaveTextContent('Asha');expect(rows[2]).toHaveTextContent('Zero');expect(rows[3]).toHaveTextContent('Pending');
 fireEvent.click(screen.getByRole('button',{name:'ATS score'}));
 rows=within(screen.getByRole('table',{name:'Resume and ATS review'})).getAllByRole('row');
 expect(rows[1]).toHaveTextContent('Zero');expect(rows[3]).toHaveTextContent('Pending');
});
it('keeps management controls hidden for read-only access',()=>{
 render(<ResumeReviewTable {...props()} caps={{...caps,canUpload:false,canAssign:false,canAdmin:false}}/>);
 fireEvent.click(screen.getByRole('button',{name:'Expand ATS details for Asha'}));
 expect(screen.queryByRole('button',{name:'Assign reviewer'})).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Recalculate ATS'})).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Delete resume'})).not.toBeInTheDocument();
});

it('shows every ATS dimension, evidence and evaluation note in the main row before expansion',()=>{
 render(<ResumeReviewTable {...props()} items={[{...item,profile:{name:'Asha',currentDesignation:'Backend Engineer',education:['B.Tech'],ugUniversity:'Example University'}}]}/>);
 const table=screen.getByRole('table',{name:'Resume and ATS review'});
 for(const label of ['Skills','Experience','Education','Keyword','Role','Matched skills','Missing skills','Evaluation notes'])expect(within(table).getByRole('columnheader',{name:label})).toBeVisible();
 expect(within(table).getByText('Python, SQL')).toBeVisible();
 expect(within(table).getByText('AWS')).toBeVisible();
 expect(within(table).getByText('Backend Engineer')).toBeVisible();
 expect(within(table).getByText('B.Tech · Example University')).toBeVisible();
 expect(within(table).getByText('Not assessed')).toBeVisible();
 expect(within(table).getByText('Local score retained.')).toBeVisible();
 expect(within(table).getByText('Experience is unavailable')).toBeVisible();
 expect(screen.queryByRole('table',{name:'Local scoring breakdown'})).not.toBeInTheDocument();
});
