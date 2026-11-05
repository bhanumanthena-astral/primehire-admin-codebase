import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as renderWithRouter, screen, fireEvent, waitFor, within } from "@testing-library/react";
import {MemoryRouter} from 'react-router-dom';
function render(ui:React.ReactNode){return renderWithRouter(<MemoryRouter>{ui}</MemoryRouter>);}
import { RecruitmentWorkspace } from "../recruitment/RecruitmentWorkspace";
import { RecruitmentCalendar } from "../recruitment/RecruitmentCalendar";
import { TalentPool } from "../recruitment/TalentPool";
import { ScheduleDialog } from "../recruitment/ScheduleDialog";
import { recruitmentRequest } from "../../lib/recruitmentApi";
import { useAuth } from "../../lib/authContext";
vi.mock("../../lib/recruitmentApi", async (original) => ({
  ...(await original<any>()),
  recruitmentRequest: vi.fn(),
}));
vi.mock("../../lib/authContext", () => ({ useAuth: vi.fn() }));
beforeEach(() => {
  vi.mocked(useAuth).mockReturnValue({
    user: { role: "technical_interviewer", name: "Test Interviewer" },
    logout: vi.fn(),
  } as any);
  vi.mocked(recruitmentRequest).mockImplementation(async (path: string) => {
    if (path === "/capabilities")
      return {
        enabled: true,
        canManage: false,
        canReview: true,
        canAdmin: false,
        workerReady: true,
        emailDryRun: true,
      } as any;
    if (path.startsWith("/tracker"))
      return {
        stages: {},
        milestones: {},
        total: 0,
        positions: { total: 0, filled: 0 },
        interviews: [],
        timeline: [],
      } as any;
    return { items: [], total: 0, unread: 0 } as any;
  });
});
describe("Recruitment workspace", () => {
  it('opens the selected report candidate directly in the existing scheduling dialog',async()=>{
    vi.mocked(useAuth).mockReturnValue({user:{role:'admin'},logout:vi.fn()} as any);
    vi.mocked(recruitmentRequest).mockImplementation(async path=>{
      if(path==='/capabilities')return {enabled:true,canManage:true,canAdmin:true,workerReady:true,emailDryRun:true} as any;
      if(path.startsWith('/tracker'))return {stages:{},milestones:{},total:0,positions:{total:1,filled:0},interviews:[],timeline:[]} as any;
      return {items:[],total:0,unread:0} as any;
    });
    const handled=vi.fn();
    render(<RecruitmentWorkspace scopedJobId="job" initialScheduleApplication={{applicationId:'report-app',jobId:'job',currentStage:'ASSESSMENT_COMPLETED',candidate:{name:'Report Candidate'},jobTitle:'Engineer'} as any} onInitialScheduleHandled={handled}/>);
    expect(await screen.findByRole('heading',{name:'Schedule an interview'})).toBeVisible();
    expect(screen.getByRole('dialog')).toHaveTextContent('Report Candidate');
    expect(handled).toHaveBeenCalledOnce();
    expect(vi.mocked(recruitmentRequest).mock.calls.some(([path,body])=>path==='/interviews'&&body!==undefined)).toBe(false);
  });
  it('loads an existing booking for rescheduling instead of opening a duplicate creation',async()=>{
    vi.mocked(useAuth).mockReturnValue({user:{role:'admin'},logout:vi.fn()} as any);
    const application={applicationId:'report-app',jobId:'job',currentStage:'ROUND1_SCHEDULED',candidate:{name:'Booked Report Candidate'},activeInterview:{interviewId:'booking'}};
    vi.mocked(recruitmentRequest).mockImplementation(async path=>{
      if(path==='/capabilities')return {enabled:true,canManage:true,canAdmin:true,workerReady:true,emailDryRun:true} as any;
      if(path==='/interviews/booking')return {interviewId:'booking',round:'technical',status:'scheduled',revision:2,interviewerId:'reviewer',startsAt:'2026-11-02T06:30:00Z',endsAt:'2026-11-02T07:30:00Z'} as any;
      if(path.startsWith('/tracker'))return {stages:{},milestones:{},total:0,positions:{total:1,filled:0},interviews:[],timeline:[]} as any;
      return {items:[],total:0,unread:0} as any;
    });
    render(<RecruitmentWorkspace scopedJobId="job" initialScheduleApplication={application as any} onInitialScheduleHandled={vi.fn()}/>);
    expect(await screen.findByRole('heading',{name:'Reschedule interview'})).toBeVisible();
    expect(screen.getByLabelText('Rescheduling reason')).toBeRequired();
  });
  it("shows an assigned interviewer workspace without scheduling or admin controls", async () => {
    render(<RecruitmentWorkspace standalone />);
    expect(
      await screen.findByText(
        "No interviews in this view. Scheduled candidates will appear here.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Technical Interview Portal" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Team access" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Schedule selected/ }),
    ).not.toBeInTheDocument();
  });
  it("requests the shared calendar using an explicit IST month boundary", async () => {
    render(<RecruitmentWorkspace />);
    await screen.findByText(
      "No interviews in this view. Scheduled candidates will appear here.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Shared calendar" }));
    await screen.findByRole("region", { name: "Shared interview calendar" });
    await waitFor(() =>
      expect(
        vi
          .mocked(recruitmentRequest)
          .mock.calls.some(
            ([path]) =>
              path.startsWith("/interviews?") &&
              path.includes("startsFrom=") &&
              path.includes("%2B05%3A30"),
          ),
      ).toBe(true),
    );
  });
  it("shows retryable load errors instead of a fabricated pipeline", async () => {
    vi.mocked(recruitmentRequest).mockRejectedValue(
      new Error("Recruitment portals are not enabled"),
    );
    render(<RecruitmentWorkspace />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Recruitment portals are not enabled",
    );
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
it("calendar month navigation preserves year boundaries", () => {
  const change = vi.fn();
  render(
    <RecruitmentCalendar
      month="2026-12"
      onMonth={change}
      items={[]}
      onOpen={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Next month" }));
  expect(change).toHaveBeenCalledWith("2027-01");
});

it('shows the required out-of-sequence scheduling reason before submitting',async()=>{
  render(<ScheduleDialog application={{applicationId:'app',currentStage:'PARSED',candidate:{name:'Test candidate'}} as any} onClose={vi.fn()} onSaved={vi.fn()}/>);
  const reason=screen.getByLabelText('Manual exception reason');
  expect(reason).toBeVisible();
  expect(reason).toBeRequired();
  expect(screen.getByText(/Current stage: PARSED/)).toBeInTheDocument();
});

it('requires a target job before comparing talent profiles',()=>{
  render(<TalentPool jobId="" onReused={vi.fn()}/>);
  expect(screen.getByRole('button',{name:'Compare talent pool'})).toBeDisabled();
  expect(screen.getByText(/Choose a job above/)).toBeVisible();
});

it('shows an existing booking on the admin card and opens rescheduling instead of creating another interview',async()=>{
  const booking={interviewId:'booked',round:'technical',interviewerId:'reviewer',interviewerName:'Test Technical Reviewer',
    startsAt:'2026-10-17T06:30:00Z',endsAt:'2026-10-17T07:30:00Z',status:'scheduled',revision:2,rescheduleReason:'Candidate requested a later slot'};
  const application={applicationId:'app',currentStage:'ROUND1_SCHEDULED',candidate:{name:'Booked Candidate'},jobTitle:'Backend Engineer',activeInterview:booking};
  vi.mocked(useAuth).mockReturnValue({user:{role:'super_admin'},logout:vi.fn()} as any);
  vi.mocked(recruitmentRequest).mockImplementation(async path=>{
    if(path==='/capabilities')return {canManage:true,canAdmin:true,workerReady:true,emailDryRun:true} as any;
    if(path.startsWith('/tracker'))return {stages:{ROUND1_SCHEDULED:1},milestones:{},total:1,positions:{total:2,filled:0},interviews:[],timeline:[]} as any;
    if(path.startsWith('/applications?'))return {items:[application],total:1} as any;
    if(path==='/interviews/booked')return {...booking,application,candidate:application.candidate,jobTitle:'Backend Engineer'} as any;
    return {items:[],total:0,unread:0} as any;
  });
  render(<RecruitmentWorkspace/>);
  expect(await screen.findByRole('region',{name:'Scheduled interview'})).toHaveTextContent('Test Technical Reviewer');
  expect(screen.getByRole('region',{name:'Scheduled interview'})).toHaveTextContent('Candidate requested a later slot');
  expect(screen.queryByRole('button',{name:'Schedule interview'})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Reschedule interview'}));
  expect(await screen.findByRole('heading',{name:'Reschedule interview'})).toBeVisible();
  expect(screen.getByLabelText('Rescheduling reason')).toBeRequired();
});

it('opens a visible candidate-specific roadmap from the tracker card',async()=>{
  vi.mocked(useAuth).mockReturnValue({user:{role:'super_admin'},logout:vi.fn()} as any);
  vi.mocked(recruitmentRequest).mockImplementation(async path=>{
    if(path==='/capabilities')return {enabled:true,canManage:true,canAdmin:true,workerReady:true,emailDryRun:true} as any;
    if(path.startsWith('/applications?'))return {items:[{applicationId:'selected-app',currentStage:'HR_ROUND',candidate:{name:'Roadmap Candidate'},jobTitle:'Backend Engineer'}],total:1} as any;
    if(path.startsWith('/tracker'))return {stages:{HR_ROUND:1},milestones:{},total:1,positions:{total:2,filled:0},interviews:[],timeline:path.includes('applicationId=')?[{historyId:'history',toStage:'HR_ROUND',transitionAt:'2026-10-16T06:30:00Z',reason:'Approved for the HR round'}]:[]} as any;
    return {items:[],total:0,unread:0} as any;
  });
  render(<RecruitmentWorkspace/>);
  fireEvent.click(await screen.findByRole('button',{name:'Candidate roadmap'}));
  expect(await screen.findByRole('region',{name:'Candidate roadmap'})).toBeVisible();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByRole('heading',{name:'Recruitment workspace'})).not.toBeInTheDocument();
  expect(await screen.findByText('Approved for the HR round')).toBeVisible();
  expect(recruitmentRequest).toHaveBeenCalledWith('/tracker?applicationId=selected-app',undefined,'GET',expect.any(AbortSignal));
  fireEvent.click(screen.getByRole('button',{name:'Back to overview'}));
  await waitFor(()=>expect(screen.queryByRole('region',{name:'Candidate roadmap'})).not.toBeInTheDocument());
  expect(screen.getByRole('button',{name:'Candidate roadmap'})).toHaveFocus();
});

it('opens HR candidate details and interview review as full pages and returns to the interview list',async()=>{
  vi.mocked(useAuth).mockReturnValue({user:{role:'hr',name:'HR Reviewer'},logout:vi.fn()} as any);
  const application={applicationId:'hr-app',applicantId:'hr-person',jobId:'job',currentStage:'HR_ROUND',candidate:{name:'HR Candidate',email:'h***@example.test'}};
  const interview={interviewId:'hr-interview',applicationId:'hr-app',round:'hr',status:'scheduled',revision:1,
    startsAt:'2026-10-16T06:00:00Z',endsAt:'2026-10-16T07:00:00Z',candidate:application.candidate,application,
    job:{jdText:'HR interview context'},jobTitle:'Engineer',canReview:true,emailStatus:[]};
  vi.mocked(recruitmentRequest).mockImplementation(async path=>{
    if(path==='/capabilities')return {canManage:false,canReview:true,workerReady:true} as any;
    if(path.startsWith('/tracker'))return {stages:{HR_ROUND:1},milestones:{},total:1,positions:{total:1,filled:0},interviews:[],timeline:[]} as any;
    if(path.startsWith('/applications?'))return {items:[application],total:1} as any;
    if(path.startsWith('/interviews?'))return {items:[interview],total:1} as any;
    if(path==='/interviews/hr-interview')return interview as any;
    return {items:[],total:0,unread:0} as any;
  });
  render(<RecruitmentWorkspace standalone/>);
  fireEvent.click(await screen.findByRole('button',{name:'My interviews'}));
  fireEvent.click(await screen.findByRole('button',{name:'Candidate roadmap'}));
  expect(await screen.findByRole('region',{name:'Candidate roadmap'})).toBeVisible();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByRole('heading',{name:'HR Interview Portal'})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'View interview & review'}));
  const page=await screen.findByRole('region',{name:'HR Candidate interview workspace'});
  expect(screen.queryByRole('region',{name:'Candidate roadmap'})).not.toBeInTheDocument();
  fireEvent.click(within(page).getByRole('tab',{name:'Reviews & decision'}));
  expect(within(page).getByLabelText('Candidate strengths')).toBeVisible();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(within(page).getByRole('button',{name:'Back to interviews'}));
  expect(await screen.findByRole('heading',{name:'HR Interview Portal'})).toBeVisible();
  expect(screen.getByRole('button',{name:'View candidate & review'})).toHaveFocus();
});

it('requires human review and a reason before reusing a talent profile',async()=>{
  const run={runId:'run',jobId:'job',status:'completed',createdAt:'2026-10-16T04:00:00Z',total:1,processed:1,skipped:0,failed:0,cursor:1,poolTotal:1,skip:0,maxCandidates:100};
  const candidate={name:'Historic Candidate',skills:['Python']};
  vi.mocked(recruitmentRequest).mockImplementation(async path=>{
    if(path.startsWith('/talent/runs?'))return {items:[run],hasMore:false} as any;
    if(path==='/talent/runs/run')return run as any;
    if(path.startsWith('/talent/matches?'))return {items:[{matchId:'match',candidate,score:78,localScore:72,method:'local_rules',providerStatus:'not_configured',previousStage:'HR_ROUND',previousAssessment:{score:85},reviewCount:1,reasons:['Relevant skills'],cautions:['Reconfirm availability'],missingSkills:[]}],total:1} as any;
    if(path==='/talent/matches/match')return {candidate,reviews:[],rejection:{reason:'Previous joining mismatch'},timeline:[],stale:false} as any;
    return {applicationId:'new-app',currentStage:'PARSED'} as any;
  });
  const saved=vi.fn();
  render(<TalentPool jobId="job" onReused={saved}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Review history & reuse'}));
  expect(await screen.findByText('Previous joining mismatch')).toBeVisible();
  const reuse=screen.getByRole('button',{name:'Add to this job for review'});
  expect(reuse).toBeDisabled();
  expect(vi.mocked(recruitmentRequest).mock.calls.some(([path])=>path.endsWith('/reuse'))).toBe(false);
  fireEvent.change(screen.getByLabelText('Talent reuse reason'),{target:{value:'Recruiter approved reconsideration'}});
  fireEvent.click(reuse);
  await waitFor(()=>expect(saved).toHaveBeenCalledOnce());
  expect(recruitmentRequest).toHaveBeenCalledWith('/talent/matches/match/reuse',{reason:'Recruiter approved reconsideration'});
});
