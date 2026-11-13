import {render,screen,fireEvent,within,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ResumeReviewTable} from '../ResumeReviewTable';
import {normalizeColumnLayout} from '../../lib/useTableColumnSettings';
vi.mock('../../lib/resumeIntakeApi',()=>({intakeGet:vi.fn().mockResolvedValue({items:[]}),intakeMutate:vi.fn()}));
vi.mock('../../lib/hiringApi',()=>({fetchJobsPage:vi.fn().mockResolvedValue({items:[],total:0})}));
const item:any={itemId:'i',fileName:'resume.pdf',profile:{name:'Asha',currentDesignation:'Backend Engineer'},revision:1,status:'completed',ats:{overall:66,category:'Good',breakdown:{skills:59},matchedSkills:[],missingSkills:[],strengths:[],gaps:[],note:'Checked'}};
const props={items:[item],caps:{canUpload:true,canAdmin:true,canAssign:false} as any,jobs:[],busy:false,onOpen:vi.fn(),onRetry:vi.fn(),onDelete:vi.fn(),onChanged:vi.fn(),onAssociated:vi.fn()};
const key='columns:tenant-a:user-a';
beforeEach(()=>localStorage.clear());afterEach(()=>vi.restoreAllMocks());
async function open(){fireEvent.click(screen.getByRole('button',{name:'Columns'}));await screen.findByRole('dialog',{name:'Table columns'});}
function headers(){return within(screen.getByRole('table',{name:'Resume and ATS review'})).getAllByRole('columnheader').map(cell=>cell.textContent);}
it('hides a column while keeping the name, controls and expanded-row span correct',async()=>{
 render(<ResumeReviewTable {...props} preferenceKey={key}/>);await open();
 expect(screen.getByRole('checkbox',{name:'Show Name'})).toHaveAttribute('aria-disabled','true');
 fireEvent.click(screen.getByRole('checkbox',{name:'Show Skills'}));
 expect(headers()).not.toContain('Skills');expect(headers()).toContain('Name');expect(headers()).toContain('Actions');
 fireEvent.click(screen.getByRole('button',{name:'Close column settings'}));
 fireEvent.click(screen.getByRole('button',{name:'Expand ATS details for Asha'}));
 expect(document.querySelector('#resume-details-i > td')).toHaveAttribute('colspan','14');
});
it('reorders headers and matching data cells and preserves sorting',async()=>{
 render(<ResumeReviewTable {...props} preferenceKey={key}/>);await open();
 fireEvent.click(screen.getByRole('button',{name:'Move ATS score left'}));
 expect(headers().slice(0,4)).toEqual(['Details','Name','ATS score','Current designation']);
 const row=within(screen.getByRole('table',{name:'Resume and ATS review'})).getAllByRole('row')[1];
 expect(within(row).getAllByRole('cell')[2]).toHaveTextContent('66 / 100');expect(within(row).getAllByRole('cell')[3]).toHaveTextContent('Backend Engineer');
 fireEvent.click(screen.getByRole('button',{name:'Close column settings'}));fireEvent.click(screen.getByRole('button',{name:'ATS score'}));
 expect(screen.getByRole('columnheader',{name:'ATS score'})).toHaveAttribute('aria-sort','descending');
});
it('persists visibility and order on remount and restores defaults',async()=>{
 const view=render(<ResumeReviewTable {...props} preferenceKey={key}/>);await open();fireEvent.click(screen.getByRole('checkbox',{name:'Show Evaluation notes'}));fireEvent.click(screen.getByRole('button',{name:'Move ATS score left'}));view.unmount();
 render(<ResumeReviewTable {...props} preferenceKey={key}/>);expect(headers()).not.toContain('Evaluation notes');expect(headers()[2]).toBe('ATS score');await open();fireEvent.click(screen.getByRole('button',{name:'Reset to default'}));
 expect(headers()).toContain('Evaluation notes');expect(headers()[2]).toBe('Current designation');
});
it('keeps preferences isolated when the signed-in account changes',async()=>{
 const view=render(<ResumeReviewTable {...props} preferenceKey={key}/>);await open();fireEvent.click(screen.getByRole('checkbox',{name:'Show Education'}));fireEvent.click(screen.getByRole('button',{name:'Close column settings'}));
 view.rerender(<ResumeReviewTable {...props} preferenceKey="columns:tenant-a:user-b"/>);expect(headers()).toContain('Education');
 view.rerender(<ResumeReviewTable {...props} preferenceKey={key}/>);await waitFor(()=>expect(headers()).not.toContain('Education'));
 expect(localStorage.getItem('columns:tenant-a:user-b')).toBeNull();
});
it('handles malformed saved settings and blocked browser storage',async()=>{
 localStorage.setItem(key,'broken json');const view=render(<ResumeReviewTable {...props} preferenceKey={key}/>);expect(headers()).toContain('Skills');view.unmount();
 vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw new Error('Blocked');});vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('Blocked');});
 render(<ResumeReviewTable {...props} preferenceKey={key}/>);await open();fireEvent.click(screen.getByRole('checkbox',{name:'Show Skills'}));expect(headers()).not.toContain('Skills');
});
it('rejects unknown/duplicate keys, keeps required columns, and adds new columns',()=>{
 const options=[{key:'name',label:'Name',required:true},{key:'score',label:'Score'},{key:'new',label:'New'}];
 expect(normalizeColumnLayout(options,{version:1,order:['score','unknown','score'],hidden:['name','score','unknown']})).toEqual({version:1,order:['score','name','new'],hidden:['score']});
 expect(normalizeColumnLayout(options,{version:99,order:['score']})).toEqual({version:1,order:['name','score','new'],hidden:[]});
});



