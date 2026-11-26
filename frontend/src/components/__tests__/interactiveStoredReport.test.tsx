import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import {InteractiveStoredReport,storedPercentage} from '../report/InteractiveStoredReport';
vi.mock('../report/StoredReportEvidence',async importOriginal=>({...await importOriginal<typeof import('../report/StoredReportEvidence')>(),StoredReportEvidence:()=>null,QuestionVideo:({reportId,version,reference}:any)=><div data-testid="question-video">{reportId}:{version}:{reference}</div>}));
it('switches views and components while keeping source scales and transcripts',async()=>{
 const metric={label:'Technical',value:0,maximum:100,grade:null,applicable:true};
 const content:any={schemaSupported:true,overview:metric,feedback:[metric],skillProfile:[metric,{...metric,label:'Reasoning',value:80}],communication:[{...metric,label:'Fluency',value:70}],questions:[{reference:'q',question:'Explain indexes',score:0,maximum:10,transcript:'An index speeds up reads.',strengths:[],areasForImprovement:[],recommendations:[]}],aiSummary:null};
 render(<InteractiveStoredReport content={content} metadata={{jobTitle:'Engineer',candidateName:'Asha',roundType:'TECHNICAL',reportId:'r',version:1} as any}/>);
 expect(screen.getAllByRole('button',{name:'Technical 0 / 100'})[0]).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'Next component'}));
 expect(screen.getByRole('heading',{name:'Reasoning'})).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:/HR readiness/}));
 expect(screen.getByRole('heading',{name:'Fluency'})).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:/Question by question/}));
 expect(screen.getByRole('region',{name:'Round summary'})).toBeVisible();
 fireEvent.click(screen.getByRole('tab',{name:'Transcript'}));
 await waitFor(()=>expect(screen.getAllByText('An index speeds up reads.')[0]).toBeVisible());
 fireEvent.click(screen.getByRole('button',{name:'pending'}));
 expect(screen.getByText('No questions match this filter.')).toBeVisible();
 expect(storedPercentage({...metric,maximum:null})).toBeNull();
 expect(storedPercentage(metric)).toBe(0);
});

it('uses the selected question and preserved version for authorized videos',()=>{
 const metric={label:'Overall',value:73,maximum:null,grade:null,applicable:null};
 const question={score:0,maximum:null,status:'Completed',transcript:'Recorded response',strengths:[],areasForImprovement:[],recommendations:[]};
 const content:any={schemaSupported:true,overview:metric,feedback:[],skillProfile:[],communication:[],questions:[
  {...question,reference:'q1',question:'First question',mediaReference:'q1'},
  {...question,reference:'q2',question:'Second question',mediaReference:'q2'},
 ],aiSummary:null};
 render(<InteractiveStoredReport content={content} metadata={{roundType:'BASIC',reportId:'preserved-report',version:3} as any}/>);
 expect(screen.getByRole('region',{name:'Round summary'})).toHaveTextContent('73');
 expect(screen.queryByText('73/100')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:/Question by question/}));
 expect(screen.getByTestId('question-video')).toHaveTextContent('preserved-report:3:q1');
 fireEvent.click(screen.getByRole('button',{name:/Q2 Second question/}));
 expect(screen.getByTestId('question-video')).toHaveTextContent('preserved-report:3:q2');
 expect(screen.getAllByTestId('question-video')).toHaveLength(1);
 expect(screen.queryByText('0 / 100')).not.toBeInTheDocument();
 expect(screen.queryByText('0 / 0')).not.toBeInTheDocument();
});
