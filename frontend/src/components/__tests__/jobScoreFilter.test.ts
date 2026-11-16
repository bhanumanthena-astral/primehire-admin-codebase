import {expect,it,vi} from 'vitest';
import {matchingApplications} from '../JobScoreFilter';
import {recruitmentRequest} from '../../lib/recruitmentApi';

vi.mock('../../lib/recruitmentApi',()=>({recruitmentRequest:vi.fn()}));

it('selects unique matches across pages while retaining the job and score range',async()=>{
  const rows=Array.from({length:101},(_,i)=>({applicationId:String(i)}));
  vi.mocked(recruitmentRequest)
    .mockResolvedValueOnce({items:rows.slice(0,100),total:102})
    .mockResolvedValueOnce({items:rows.slice(99),total:102});
  const query='/applications?jobId=job-A&scoreField=ats&minimum=70&maximum=90';
  const matches=await matchingApplications(query+'&skip=50');
  expect(matches.map(row=>row.applicationId)).toEqual(rows.map(row=>row.applicationId));
  for(const [index,[path]] of vi.mocked(recruitmentRequest).mock.calls.entries()){
    const params=new URL(path,'https://example.test').searchParams;
    expect(Object.fromEntries(params)).toEqual({jobId:'job-A',scoreField:'ats',minimum:'70',maximum:'90',limit:'100',skip:String(index*100)});
  }
});
