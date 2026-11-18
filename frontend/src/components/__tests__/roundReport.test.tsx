import {fireEvent,render,screen} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import RoundReport from '../report/RoundReport';
vi.mock('../report/QuestionReview',()=>({default:()=> <p>Question review</p>}));
vi.mock('../report/InsightPanels',()=>({default:()=>null}));
vi.mock('../report/ProctoringAudit',()=>({default:()=>null}));
it('switches report views and preserves real zero scores and missing metrics',()=>{
 const report:any={meta:{roundType:'TECHNICAL'},overall:{overallScore:0,confidenceScore:null,communication:null},questions:[],violations:null};
 render(<RoundReport report={report} insights={{} as any}/>);
 expect(screen.getAllByText('0/100').length).toBeGreaterThan(0);
 fireEvent.click(screen.getByRole('button',{name:/HR readiness/}));
 expect(screen.getByText('These metrics have not been evaluated.')).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:/Question by question/}));
 expect(screen.getByText('No questions match this filter.')).toBeVisible();
});
