import {beforeEach,expect,it,vi} from 'vitest';
import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {LeadershipDashboard,duration} from './LeadershipDashboard';
import {loadLeadership,LeadershipData} from '../lib/leadershipApi';

vi.mock('../lib/authContext',()=>({useAuth:()=>({user:{name:'Leadership User',role:'leadership'},logout:vi.fn()})}));
vi.mock('../lib/leadershipApi',()=>({loadLeadership:vi.fn()}));
vi.mock('../components/ui/primitives',()=>({ModeToggle:()=>null}));
vi.mock('recharts',()=>({ResponsiveContainer:({children}:any)=><div>{children}</div>,ComposedChart:()=>null,Bar:()=>null,Line:()=>null,Area:()=>null,CartesianGrid:()=>null,Cell:()=>null,Pie:()=>null,Tooltip:()=>null,XAxis:()=>null,YAxis:()=>null}));
const fixture:LeadershipData={generatedAt:'2026-11-09T12:00:00Z',days:30,windowStart:'2026-10-11T00:00:00Z',timezone:'Asia/Kolkata',selectedJobId:null,jobOptions:[{jobId:'a',title:'Engineer'}],summary:{openRoles:1,openPositions:2,resumesInWindow:12,assessmentsCompleted:3,linksSent:5,technical:2,managerial:1,hr:1,hired:1,offers:0,atsProcessing:4,atsScored:8,linksGenerated:6,linksUnsent:1},stages:[{key:'technical',label:'Technical',count:2},{key:'hr',label:'HR',count:1}],roles:[{jobId:'a',title:'Engineer',department:'Engineering',status:'OPEN',positions:2,daysOpen:10,resumesUploaded:12,atsScored:8,atsProcessing:4,linksGenerated:6,linksSent:5,assessmentsCompleted:3,technical:2,managerial:1,hr:1,hrWaiting:1,hrOverdue:1,stages:{technical:2,hr:1}}],trend:[{date:'2026-11-09',resumes:2,assessments:1}],timing:[{key:'hrScheduling',label:'Managerial approval → HR booking',samples:1,eligible:2,withoutDuration:1,medianHours:24,p90Hours:24,buckets:[0,0,1,0,0],waiting:1,overdue:1}],aging:[{key:'hr',label:'HR',under24:0,days1to3:0,over72:1,unknown:0}],quality:{limited:false,applicationsAnalyzed:12,notes:['Booking time is created time.']}};
beforeEach(()=>{vi.clearAllMocks();vi.mocked(loadLeadership).mockResolvedValue(structuredClone(fixture));});
const mount=()=>render(<MemoryRouter><LeadershipDashboard/></MemoryRouter>);

it('renders a distinct leadership view with metrics, drilldown and explicit refresh',async()=>{
  mount();
  expect(await screen.findByRole('heading',{name:'Hiring overview'})).toBeVisible();
  await screen.findByText('Current pipeline');
  expect(screen.queryByText('Invite Member')).not.toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Managerial approval → HR booking, 1 waiting 48 hours or more'})).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'HR: 1 applications'}));
  expect(screen.getByText('HR by role')).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'Refresh'}));
  await waitFor(()=>expect(loadLeadership).toHaveBeenCalledTimes(2));
  expect(loadLeadership).toHaveBeenLastCalledWith(30,'',expect.any(AbortSignal));
});

it('filters the role portfolio from a stage and supports the role table search',async()=>{
  mount();
  await screen.findByText('Current pipeline');
  fireEvent.click(screen.getByRole('button',{name:'Role portfolio'}));
  fireEvent.change(screen.getByRole('textbox',{name:'Find a role or department'}),{target:{value:'unmatched'}});
  expect(screen.getByText('No roles match this view.')).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'Hiring overview'}));
  fireEvent.click(screen.getByRole('button',{name:'Technical: 2 applications'}));
  fireEvent.click(screen.getByRole('button',{name:'View Engineer: 2 at this stage'}));
  await waitFor(()=>expect(loadLeadership).toHaveBeenLastCalledWith(30,'a',expect.any(AbortSignal)));
});

it('shows partial coverage and missing timing without inventing a zero',async()=>{
  vi.mocked(loadLeadership).mockResolvedValue({...fixture,quality:{...fixture.quality,limited:true},timing:[{...fixture.timing[0],samples:0,medianHours:null,p90Hours:null,buckets:[0,0,0,0,0]}]});
  mount();
  await screen.findByText(/Some records exceed the analysis limit/);
  fireEvent.click(screen.getByRole('button',{name:'Handoff times'}));
  expect(screen.getAllByText('Unavailable')).toHaveLength(2);
  expect(screen.getByText(/No completed handoffs with valid timestamps/)).toBeVisible();
});

it('handles an error and retries without stale metrics',async()=>{
  vi.mocked(loadLeadership).mockRejectedValueOnce(new Error('Try later'));
  mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('Try later');
  fireEvent.click(screen.getByRole('button',{name:'Try again'}));
  await screen.findByText('Current pipeline');
});

it('aborts work on unmount and formats zero-hour durations correctly',()=>{
  vi.mocked(loadLeadership).mockReturnValue(new Promise(()=>{}));
  const view=mount();
  const signal=vi.mocked(loadLeadership).mock.calls[0][2];
  view.unmount();
  expect(signal.aborted).toBe(true);
  expect(duration(0)).toBe('0m');
  expect(duration(null)).toBe('Unavailable');
});
