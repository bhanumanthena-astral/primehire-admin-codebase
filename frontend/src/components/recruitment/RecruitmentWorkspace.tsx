import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  CalendarDays,
  Users,
  Briefcase,
  ArrowRight,
  Bell,
  RefreshCw,
  Search,
  Video,
  Clock,
  CheckCircle2,
  LogOut,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { AppSelect } from "../ui/AppSelect";
import { ModeToggle } from "../ui/primitives";
import {GoogleCalendarConnection} from '../auth/GoogleCalendarConnection';
import { useAuth } from "../../lib/authContext";
import {
  Application,
  Interview,
  Capabilities,
  Job,
  Page,
  Tracker,
  STAGES,
  recruitmentRequest,
  stageLabel,
  formatTime,
  dateKey,
} from "../../lib/recruitmentApi";
import { RecruitmentCalendar } from "./RecruitmentCalendar";
import { ScheduleDialog } from "./ScheduleDialog";
import { InterviewReviewPage } from "./InterviewDialog";
import { RecruitmentAccess } from "./RecruitmentAccess";
import { TalentPool } from "./TalentPool";
import { CandidateRoadmapPage } from "./CandidateRoadmapPage";
import { ReviewerDashboard } from "./ReviewerDashboard";
import { InterviewCandidateCard } from "./InterviewCandidateCard";
import {ReviewSubmissionSuccess,ReviewCompletion} from './ReviewSubmissionSuccess';

const schedulingFilters: Record<string, {round: "technical" | "managerial" | "hr"; label: string}> = {
  technical_scheduling_pending: {round: "technical", label: "Technical interview scheduling pending"},
  managerial_scheduling_pending: {round: "managerial", label: "Managerial interview scheduling pending"},
  hr_scheduling_pending: {round: "hr", label: "HR interview scheduling pending"},
};
const pendingRound = (app: Application) => app.activeInterview ? null
  : ["ASSESSMENT_COMPLETED", "ROUND1_PENDING_ASSIGNMENT"].includes(app.currentStage) ? "Technical"
  : app.currentStage === "ROUND2_PENDING_ASSIGNMENT" ? "Managerial"
  : app.currentStage === "HR_ROUND" ? "HR" : null;

export function RecruitmentWorkspace({
  standalone = false,
  onOpenJobs,
  scopedJobId,
  initialScheduleApplication,
  onInitialScheduleHandled,
  externalSearch,
  onSearchChange,
}: {
  scopedJobId?: string;
  initialScheduleApplication?: Application;
  onInitialScheduleHandled?: () => void;
  externalSearch?: string;
  onSearchChange?: (value: string) => void;
  standalone?: boolean;
  onOpenJobs?: () => void;
}) {
  const { user, logout, impersonatingUser } = useAuth();
  const role = impersonatingUser?.role || user?.role;
  const reviewer = [
    "technical_interviewer",
    "managerial_interviewer",
    "hr",
  ].includes(role || "");
  const title =
    role === "technical_interviewer"
      ? "Technical Interview Portal"
      : role === "managerial_interviewer"
        ? "Managerial Interview Portal"
        : role === "hr"
          ? "HR Interview Portal"
          : "Recruitment workspace";
  const [view, setView] = useState(externalSearch?.trim() ? "candidates" : "tracker");
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobPage, setJobPage] = useState(0);
  const [jobTotal, setJobTotal] = useState(0);
  const [job, setJob] = useState(scopedJobId || "");
  const [tracker, setTracker] = useState<Tracker | null>(null);
  const [apps, setApps] = useState<Page<Application>>({ items: [], total: 0 });
  const [interviews, setInterviews] = useState<Page<Interview>>({
    items: [],
    total: 0,
  });
  const [notifications, setNotifications] = useState<any>({
    items: [],
    unread: 0,
    total: 0,
  });
  const [search, setSearch] = useState(externalSearch || "");
  const [query, setQuery] = useState(externalSearch?.trim() || "");
  const [stage, setStage] = useState("");
  const [page, setPage] = useState(0);
  const [interviewPage, setInterviewPage] = useState(0);
  const [notificationPage, setNotificationPage] = useState(0);
  const [bucket, setBucket] = useState("upcoming");
  const [round, setRound] = useState("");
  const scheduling = schedulingFilters[view === "interviews" ? bucket : stage];
  const applicationStage = scheduling ? "" : stage;
  const applicationFilter = `jobId=${encodeURIComponent(job)}&stage=${applicationStage}${scheduling ? `&schedulingRound=${scheduling.round}` : ""}`;
  const [month, setMonth] = useState(() =>
    dateKey(new Date().toISOString()).slice(0, 7),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Application[]>([]);
  const [queue, setQueue] = useState<Application[]>([]);
  const [reschedule, setReschedule] = useState<Interview | null>(null);
  const [opened, setOpened] = useState<Interview | null>(null);
  const [openedTab,setOpenedTab]=useState<'brief'|'reviews'>('brief');
  const [reviewCompletion,setReviewCompletion]=useState<ReviewCompletion|null>(null);
  const interviewReturn = useRef<{id:string;scroll:number}|null>(null);
  useEffect(()=>{
    if(opened){if(window.scrollY)window.scrollTo({top:0});return;}
    if(reviewCompletion){interviewReturn.current=null;if(window.scrollY)window.scrollTo({top:0});return;}
    const previous=interviewReturn.current;
    if(!previous)return;
    interviewReturn.current=null;
    const trigger=Array.from(document.querySelectorAll<HTMLButtonElement>('[data-interview-open]')).find(button=>button.dataset.interviewOpen===previous.id);
    (trigger||document.querySelector<HTMLElement>('[data-recruitment-heading]'))?.focus({preventScroll:true});
    if(window.scrollY!==previous.scroll)window.scrollTo({top:previous.scroll});
  },[opened?.interviewId]);
  const [candidate, setCandidate] = useState<Application | null>(null);
  const roadmapReturn = useRef<{id:string;scroll:number}|null>(null);
  function openRoadmap(application: Application) {
    roadmapReturn.current={id:application.applicationId,scroll:window.scrollY};
    setCandidate(application);
  }
  useEffect(()=>{
    if(candidate){if(window.scrollY)window.scrollTo({top:0});return;}
    if(opened)return;
    const previous=roadmapReturn.current;
    if(!previous)return;
    roadmapReturn.current=null;
    const trigger=Array.from(document.querySelectorAll<HTMLButtonElement>('[data-roadmap-open]')).find(button=>button.dataset.roadmapOpen===previous.id);
    (trigger||document.querySelector<HTMLElement>('[data-recruitment-heading]'))?.focus({preventScroll:true});
    if(window.scrollY!==previous.scroll)window.scrollTo({top:previous.scroll});
  },[candidate?.applicationId]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const refresh = () => setRevision((n) => n + 1);
  const canSchedule = (application:Application) => !application.activeInterview && !['HIRED','REJECTED','WITHDRAWN'].includes(application.currentStage);
  useEffect(() => {
    if (externalSearch === undefined || externalSearch === search) return;
    setSearch(externalSearch);
    setQuery(externalSearch.trim());
    setPage(0);
    setSelected([]);
    if (externalSearch.trim()) {
      setView("candidates");
      setStage("");
      setRound("");
      if (!scopedJobId) setJob("");
    }
  }, [externalSearch, scopedJobId]);
  useEffect(() => {
    if (!initialScheduleApplication || !caps) return;
    const application = initialScheduleApplication;
    if (application.jobId !== scopedJobId || !caps.canManage || impersonatingUser) {
      setError('You do not have permission to schedule this candidate.');
      onInitialScheduleHandled?.();
      return;
    }
    if (['HIRED','REJECTED','WITHDRAWN'].includes(application.currentStage)) {
      setError('This candidate is no longer eligible for interview scheduling.');
      onInitialScheduleHandled?.();
      return;
    }
    if (application.activeInterview) {
      const controller = new AbortController();
      void recruitmentRequest<Interview>(`/interviews/${encodeURIComponent(application.activeInterview.interviewId)}`, undefined, 'GET', controller.signal)
        .then(interview => { if(!controller.signal.aborted){setReschedule(interview);setQueue([application]);onInitialScheduleHandled?.();} })
        .catch(cause => {if(!controller.signal.aborted){setError(cause.message);onInitialScheduleHandled?.();}});
      return () => controller.abort();
    } else {
      setReschedule(null);
      setQueue([application]);
      onInitialScheduleHandled?.();
    }
  }, [initialScheduleApplication, caps, scopedJobId, impersonatingUser, onInitialScheduleHandled]);
  const eligibleOnPage = apps.items.filter(canSchedule);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search);
      setPage(0);
      setSelected([]);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    setPage(0);
    setInterviewPage(0);
    setSelected([]);
    setCandidate(null);
  }, [job, stage, bucket, view]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const filter = `jobId=${encodeURIComponent(job)}`;
    const [year, m] = month.split("-").map(Number);
    const next = new Date(Date.UTC(year, m, 1));
    const nextMonth = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
    const calendar =
      view === "calendar"
        ? `&startsFrom=${encodeURIComponent(`${month}-01T00:00:00+05:30`)}&startsTo=${encodeURIComponent(`${nextMonth}-01T00:00:00+05:30`)}`
        : `&bucket=${schedulingFilters[bucket] ? "all" : bucket}${round ? `&round=${round}` : ""}`;
    void Promise.all([
      recruitmentRequest<Capabilities>(
        "/capabilities",
        undefined,
        "GET",
        controller.signal,
      ),
      recruitmentRequest<Page<Job>>(
        `/jobs?skip=${jobPage * 50}`,
        undefined,
        "GET",
        controller.signal,
      ),
      recruitmentRequest<Tracker>(
        `/tracker?${filter}`,
        undefined,
        "GET",
        controller.signal,
      ),
      recruitmentRequest<Page<Application>>(
        `/applications?${applicationFilter}&search=${encodeURIComponent(query)}&skip=${page * 25}`,
        undefined,
        "GET",
        controller.signal,
      ),
      (view === "calendar" || view === "interviews" && !scheduling || reviewer && view === "tracker") ? recruitmentRequest<Page<Interview>>(
        `/interviews?${filter}${calendar}&skip=${interviewPage * 50}`,
        undefined,
        "GET",
        controller.signal,
      ) : Promise.resolve<Page<Interview>>({items: [], total: 0}),
      recruitmentRequest<any>(
        `/notifications?skip=${notificationPage * 25}`,
        undefined,
        "GET",
        controller.signal,
      ),
    ])
      .then(([c, j, t, a, i, n]) => {
        if (controller.signal.aborted) return;
        setCaps(c);
        setJobs(j.items);
        setJobTotal(j.total);
        setTracker(t);
        setApps(a);
        setInterviews(i);
        setNotifications(n);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [
    job,
    stage,
    page,
    interviewPage,
    notificationPage,
    view,
    month,
    bucket,
    round,
    revision,
    query,
    jobPage,
  ]);
  // Refresh notifications and delivery state without disrupting unsaved forms.
  useEffect(() => {
    const id = setInterval(refresh, 30000);
    return () => clearInterval(id);
  }, []);
  async function open(row: Pick<Interview,'interviewId'>, initialTab:'brief'|'reviews'='brief') {
    setError("");
    try {
      interviewReturn.current={id:row.interviewId,scroll:window.scrollY};
      const interview=await recruitmentRequest<Interview>(`/interviews/${row.interviewId}`);
      setOpenedTab(initialTab);setOpened(interview);
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    }
  }
  async function openRoadmapReview(application: Application) {
    const interview=application.activeInterview || application.latestInterview;
    if(!interview)return;
    const previous=roadmapReturn.current;
    if(await open(interview)) {
      roadmapReturn.current=null;
      setCandidate(null);
      if(previous && interviewReturn.current)interviewReturn.current.scroll=previous.scroll;
    }
  }
  async function rescheduleBooking(application:Application) {
    if(!application.activeInterview)return;
    setBulkBusy(true);setError('');
    try{
      const interview=await recruitmentRequest<Interview>(`/interviews/${application.activeInterview.interviewId}`);
      if(interview.status!=='scheduled')throw new Error('This interview has changed. Refresh the candidate card.');
      setQueue([{...interview.application,candidate:interview.candidate,jobTitle:interview.jobTitle}]);
      setReschedule(interview);
    }catch(e:any){setError(e.message);}finally{setBulkBusy(false);}
  }
  async function selectAll() {
    setBulkBusy(true);
    setError("");
    try {
      if (apps.total > 1000)
        throw new Error(
          "Narrow the filters to select up to 1,000 candidates at a time.",
        );
      const rows: Application[] = [];
      for (let skip = 0; skip < apps.total; skip += 100) {
        const p = await recruitmentRequest<Page<Application>>(
          `/applications?${applicationFilter}&search=${encodeURIComponent(query)}&skip=${skip}&limit=100`,
        );
        rows.push(...p.items.filter(canSchedule));
      }
      setSelected(rows);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBulkBusy(false);
    }
  }
  const tabs: [string, string, LucideIcon][] = [
    ["tracker", reviewer ? "Overview" : "Recruitment tracker", Activity],
    ["interviews", reviewer ? "My interviews" : "Interviews", Users],
    ["candidates", "Candidates", Users],
    ["calendar", "Shared calendar", CalendarDays],
    ...(caps?.canManage ? [["talent", "Intelligent talent pool", Users] as [string,string,LucideIcon]] : []),
    [
      "notifications",
      `Notifications${notifications.unread ? ` (${notifications.unread})` : ""}`,
      Bell,
    ],
    ...(caps?.canAdmin
      ? [["access", "Team access", ShieldCheck] as [string, string, LucideIcon]]
      : []),
  ];
  const candidatePipeline = (
              <section className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold">{scheduling?.label || "Candidate pipeline"}</h2>
                    <p className="text-sm text-muted-foreground">
                      {apps.total} matching applications · select a candidate to
                      inspect their roadmap
                    </p>
                  </div>
                  {caps?.canManage && (
                    <Button
                      disabled={!selected.length || bulkBusy}
                      onClick={() => {
                        setQueue(selected);
                        setReschedule(null);
                      }}
                    >
                      Schedule selected ({selected.length})
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                      className="pl-9"
                      aria-label="Search recruitment candidates"
                      placeholder="Search candidate names"
                      value={search}
                      onChange={(e) => {setSearch(e.target.value);onSearchChange?.(e.target.value);}}
                    />
                  </div>
                  {(view === "tracker" || view === "candidates") && <AppSelect
                    aria-label="Pipeline stage filter"
                    value={stage}
                    onValueChange={setStage}
                  >
                    <option value="">All stages</option>
                    {Object.entries(schedulingFilters).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
                    {STAGES.map((s) => (
                      <option key={s} value={s}>
                        {stageLabel(s)}
                      </option>
                    ))}
                  </AppSelect>}
                </div>
                {(search || stage || job && !scopedJobId) && <Button variant="outline" size="sm" onClick={()=>{
                  setSearch("");setQuery("");onSearchChange?.("");setStage("");setPage(0);setSelected([]);
                  if(!scopedJobId)setJob("");
                }}>Clear candidate filters</Button>}
                {view === "candidates" && <p className="text-sm text-muted-foreground">
                  {caps?.canManage ? "Search all application stages, including candidates waiting for their next interview. Use the scheduling action on the candidate card."
                    : "Only candidates assigned to you are visible. A recruiter or administrator must assign your interview before a candidate enters your workspace."}
                </p>}
                {caps?.canManage && apps.items.length > 0 && (
                  <div className="flex flex-wrap items-center gap-4 text-sm">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        aria-label="Select current page"
                        disabled={!eligibleOnPage.length}
                        checked={eligibleOnPage.length>0 && eligibleOnPage.every((a) =>
                          selected.some(
                            (s) => s.applicationId === a.applicationId,
                          ),
                        )}
                        onChange={(e) =>
                          setSelected(e.target.checked ? eligibleOnPage : [])
                        }
                      />
                      Select this page
                    </label>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={bulkBusy}
                      onClick={() => void selectAll()}
                    >
                      Select all eligible candidates
                    </Button>
                    {selected.length > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelected([])}
                      >
                        Clear selection
                      </Button>
                    )}
                  </div>
                )}
                {!apps.items.length ? (
                  <Empty text="No candidates match this scope. Existing job applications will appear here when available." />
                ) : (
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {apps.items.map((a) => (
                      <article
                        key={a.applicationId}
                        className="rounded-2xl border border-border bg-card p-5 shadow-sm"
                      >
                        <div className="flex items-start gap-3">
                          <Avatar name={a.candidate.name} />
                          <div className="min-w-0 flex-1">
                            <h3 className="break-words font-bold">
                              {a.candidate.name}
                            </h3>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {a.jobTitle}
                            </p>
                          </div>
                          {caps?.canManage && canSchedule(a) && (
                            <input
                              type="checkbox"
                              aria-label={`Select ${a.candidate.name}`}
                              checked={selected.some(
                                (s) => s.applicationId === a.applicationId,
                              )}
                              onChange={(e) =>
                                setSelected((p) =>
                                  e.target.checked
                                    ? [...p, a]
                                    : p.filter(
                                        (s) =>
                                          s.applicationId !== a.applicationId,
                                      ),
                                )
                              }
                            />
                          )}
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <Tag>{stageLabel(a.currentStage)}</Tag>
                          {pendingRound(a) && <Tag>{pendingRound(a)} interview scheduling pending</Tag>}
                          {a.assessment?.score != null && (
                            <Tag>Assessment {a.assessment.score}%</Tag>
                          )}
                        </div>
                        <p className="mt-3 text-xs text-muted-foreground">
                          {a.candidate.currentDesignation ||
                            "Candidate profile"}
                          {a.candidate.experienceYears != null
                            ? ` · ${a.candidate.experienceYears} years`
                            : ""}
                        </p>
                        <p className="mt-2 break-words text-xs text-muted-foreground">{a.candidate.email} · {a.candidate.phone}</p>
                        <div className="mt-3 flex flex-wrap gap-1">
                          {a.candidate.skills?.slice(0, 4).map((s) => (
                            <span
                              key={s}
                              className="rounded bg-muted px-2 py-1 text-xs"
                            >
                              {s}
                            </span>
                          ))}
                        </div>
                        {a.activeInterview && <section aria-label="Scheduled interview" className="mt-4 space-y-2 rounded-xl border border-primary/25 bg-primary/5 p-3 text-sm">
                          <p className="font-semibold capitalize">{a.activeInterview.round} interview</p>
                          <p className="text-xs text-muted-foreground">Interviewer: <span className="font-medium text-foreground">{a.activeInterview.interviewerName}</span></p>
                          <p className="flex items-start gap-2 text-xs"><CalendarDays className="mt-0.5 h-3.5 w-3.5 shrink-0"/><span>{formatTime(a.activeInterview.startsAt)}<br/>to {formatTime(a.activeInterview.endsAt)} · IST</span></p>
                          {a.activeInterview.rescheduleReason&&<p className="break-words text-xs text-muted-foreground"><strong>Last reschedule reason: </strong>{a.activeInterview.rescheduleReason}</p>}
                          {a.activeInterview.meetingLink&&<a href={a.activeInterview.meetingLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-primary"><Video className="h-3.5 w-3.5"/>Meeting link</a>}
                        </section>}
                        <div className="mt-5 flex flex-wrap gap-2">
                          <Button
                            data-roadmap-open={a.applicationId}
                            variant="outline"
                            size="sm"
                            onClick={() => openRoadmap(a)}
                          >
                            Candidate roadmap
                          </Button>
                          {!a.activeInterview && a.latestInterview && <Button data-interview-open={a.latestInterview.interviewId} variant="outline" size="sm" onClick={()=>void open(a.latestInterview!)}>View candidate & reviews</Button>}
                          {a.activeInterview&&<Button data-interview-open={a.activeInterview.interviewId} variant="outline" size="sm" onClick={()=>void open(a.activeInterview!)}>View interview</Button>}
                          {caps?.canManage && a.activeInterview && <Button size="sm" disabled={bulkBusy} onClick={()=>void rescheduleBooking(a)}>Reschedule interview</Button>}
                          {caps?.canManage && canSchedule(a) && (
                              <Button
                                size="sm"
                                onClick={() => {
                                  setQueue([a]);
                                  setReschedule(null);
                                }}
                              >
                                {pendingRound(a) === "HR" ? "Schedule HR interview" : "Schedule interview"}
                              </Button>
                            )}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
                <Pagination
                  page={page}
                  size={25}
                  total={apps.total}
                  change={setPage}
                />
              </section>
  );
  const content = (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Hiring ·{" "}
            {reviewer
              ? "Your assigned workspace"
              : "People, progress and next steps"}
          </p>
          <h1 data-recruitment-heading tabIndex={-1} className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl outline-none">
            {title}
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            {reviewer
              ? "Know the candidate, join the conversation and share a clear recommendation."
              : "Follow each candidate from first application to joining, with one shared calendar and a complete decision history."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onOpenJobs && (
            <Button variant="outline" onClick={onOpenJobs}>
              <Briefcase className="mr-2 h-4 w-4" />
              Jobs & resumes
            </Button>
          )}
          <Button variant="outline" onClick={refresh} disabled={loading}>
            <RefreshCw
              className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
          {standalone && (
            <Button variant="ghost" onClick={logout}>
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </Button>
          )}
        </div>
      </div>
      <nav
        className="flex flex-wrap gap-1 rounded-xl border border-border bg-card p-2"
        aria-label="Recruitment workspace"
      >
        {tabs.map(([id, label, Icon]) => (
          <Button
            key={id}
            variant={view === id ? "secondary" : "ghost"}
            onClick={() => {
              setView(id);
              setInterviewPage(0);
              if (id === "candidates") {setStage("");setPage(0);}
              if (reviewer && id === "tracker") setBucket("upcoming");
            }}
            aria-current={view === id ? "page" : undefined}
          >
            <Icon className="mr-2 h-4 w-4" />
            {label}
          </Button>
        ))}
      </nav>
      {view==='interviews'&&reviewCompletion&&<ReviewSubmissionSuccess key={reviewCompletion.interviewId}
        completion={reviewCompletion} interviewerName={user?.name}
        onContinue={()=>{setReviewCompletion(null);document.querySelector<HTMLElement>('[data-recruitment-heading]')?.focus({preventScroll:true});}}
        onViewReview={()=>void open({interviewId:reviewCompletion.interviewId},'reviews')}/>}
      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm"
        >
          <span>{error}</span>
          <Button variant="outline" onClick={refresh}>
            Retry
          </Button>
        </div>
      )}
      <div className="flex justify-end"><Button variant="outline" onClick={()=>window.location.assign("/reports")}>Reports & previous round summaries</Button></div>
      {caps && !caps.workerReady && (
        <p
          role="status"
          className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground"
        >
          Interview data is available. Reminder and email delivery is waiting
          for the recruitment worker.
        </p>
      )}
      {caps?.emailDryRun && caps.canManage && (
        <p className="text-xs text-muted-foreground">
          Email is currently in dry-run mode. Messages are recorded and
          labelled; they are not delivered.
        </p>
      )}
      {caps && !caps.emailDryRun && caps.emailTestRestricted && caps.canManage && <p className="text-xs text-muted-foreground">Live recruitment email is restricted to configured test recipients. Other recipients require an update to the delivery allowlist.</p>}
      {!scopedJobId && view !== "access" && view !== "notifications" && (
        <div className="flex flex-wrap items-center gap-3">
          <label className="min-w-56 flex-1 text-xs font-semibold text-muted-foreground">
            Job scope
            <AppSelect
              aria-label="Recruitment job scope"
              value={job}
              onValueChange={setJob}
            >
              <option value="">All accessible jobs</option>
              {jobs.map((j) => (
                <option key={j.jobId} value={j.jobId}>
                  {j.title}
                </option>
              ))}
            </AppSelect>
          </label>
          {jobTotal > 50 && (
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="ghost"
                disabled={!jobPage}
                onClick={() => setJobPage((n) => n - 1)}
              >
                Previous jobs
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={(jobPage + 1) * 50 >= jobTotal}
                onClick={() => setJobPage((n) => n + 1)}
              >
                More jobs
              </Button>
            </div>
          )}
          <span className="text-xs text-muted-foreground">
            {reviewer ? "Your assigned interviews" : job ? "Job recruitment tracker" : "Global recruitment tracker"} ·
            IST
          </span>
        </div>
      )}
      {loading && !caps ? (
        <div
          className="grid gap-4 sm:grid-cols-3"
          aria-label="Loading recruitment workspace"
        >
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 rounded-2xl" />
          ))}
        </div>
      ) : (
        <>
          {view === "talent" && caps?.canManage && <TalentPool jobId={job} onReused={refresh}/>}
          {view === "candidates" && (loading ? <Skeleton aria-label="Loading recruitment candidates" className="h-64"/> : candidatePipeline)}
          {view === "tracker" && reviewer && (
            <ReviewerDashboard
              round={role === "managerial_interviewer" ? "managerial" : role === "hr" ? "hr" : "technical"}
              summary={tracker?.reviewerSummary} interviews={interviews.items} total={interviews.total}
              onBucket={value => {setBucket(value); setInterviewPage(0); setView("interviews");}}
              onOpen={row => void open(row)} onRoadmap={openRoadmap}
            />
          )}
          {view === "tracker" && !reviewer && tracker && (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Stat
                  label="Open positions remaining"
                  value={Math.max(
                    0,
                    tracker.positions.total - tracker.positions.filled,
                  )}
                  hint={`${tracker.positions.filled} filled of ${tracker.positions.total}`}
                />
                <Stat
                  label="Candidates in scope"
                  value={tracker.total}
                  hint="Unique job applications"
                />
                <Stat
                  label="Assessments completed"
                  value={
                    tracker.milestones.ASSESSMENT_COMPLETED ||
                    tracker.stages.ASSESSMENT_COMPLETED ||
                    0
                  }
                  hint="Recorded completion milestone"
                />
                <Stat
                  label="Joined / hired"
                  value={tracker.stages.HIRED || 0}
                  hint="Confirmed human decisions"
                />
              </div>
              <section className="rounded-2xl border border-border bg-card p-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold">Recruitment roadmap</h2>
                  <span className="text-xs text-muted-foreground">
                    Assessment totals · other tiles show current stages
                  </span>
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  {[
                    ["PARSED", "Resume reviewed"],
                    ["ASSESSMENT_SENT", "Assessment sent"],
                    ["ASSESSMENT_COMPLETED", "Assessment completed"],
                    ["ROUND1_SCHEDULED", "Technical scheduled"],
                    ["ROUND2_SCHEDULED", "Managerial scheduled"],
                    ["HR_ROUND", "HR round"],
                    ["OFFER", "Offer"],
                    ["HIRED", "Hired"],
                    ["ON_HOLD", "On hold"],
                    ["REJECTION_PENDING_HR_REVIEW", "Rejection review"],
                    ["REJECTED", "Rejected"],
                    ["TALENT_POOL", "Talent pool"],
                  ].map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      disabled={key === 'ASSESSMENT_SENT' || key === 'ASSESSMENT_COMPLETED'}
                      title={key === 'ASSESSMENT_SENT' || key === 'ASSESSMENT_COMPLETED' ? 'Cumulative total, including candidates now in later rounds' : 'Filter by current stage'}
                      onClick={() => setStage(stage === key ? "" : key)}
                      aria-pressed={stage === key}
                      className={`rounded-xl border p-4 text-left transition hover:border-primary/50 ${stage === key ? "border-primary bg-primary/10" : "border-border bg-muted/10"}`}
                    >
                      <span className="text-2xl font-bold">
                        {(key === 'ASSESSMENT_SENT' || key === 'ASSESSMENT_COMPLETED' ? tracker.milestones[key] : tracker.stages[key]) || 0}
                      </span>
                      <span className="mt-2 block text-xs text-muted-foreground">
                        {label}
                      </span>
                    </button>
                  ))}
                </div>
                <p className="mt-4 text-xs text-muted-foreground">
                  Assessment sent and completed are cumulative totals, including
                  candidates who have moved to interviews. All other tiles show
                  current stages. A completed assessment is also counted as sent.
                </p>
              </section>
              {caps?.canManage && <section aria-label="Pending interview scheduling" className="grid gap-3 sm:grid-cols-3">
                {Object.entries(schedulingFilters).map(([key, value]) => <button key={key} type="button"
                  onClick={()=>{setStage(key);setSearch("");setQuery("");setPage(0);}}
                  aria-label={`${tracker.schedulingPending?.[value.round] || 0} ${value.label}`}
                  aria-pressed={stage===key} className={`rounded-xl border p-4 text-left ${stage===key?"border-primary bg-primary/10":"border-border bg-card"}`}>
                  <span className="block text-2xl font-bold tabular-nums">{tracker.schedulingPending?.[value.round] || 0}</span>
                  <span className="mt-2 block text-sm">{value.label}</span>
                </button>)}
              </section>}
              <section
                className="grid gap-4 sm:grid-cols-3"
                aria-label="Interview round outcomes"
              >
                {(["technical", "managerial", "hr"] as const).map(
                  (roundName) => {
                    const outcomes = tracker.interviews.filter(
                      (item: any) => item.round === roundName,
                    );
                    const count = (predicate: (item: any) => boolean) =>
                      outcomes
                        .filter(predicate)
                        .reduce(
                          (sum: number, item: any) => sum + item.count,
                          0,
                        );
                    return (
                      <article
                        key={roundName}
                        className="rounded-2xl border border-border bg-card p-5"
                      >
                        <h3 className="font-bold capitalize">
                          {roundName} round
                        </h3>
                        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                          {[
                            [
                              "Scheduled",
                              count((item) => item.status === "scheduled"),
                            ],
                            [
                              "Completed",
                              count((item) => item.status === "reviewed"),
                            ],
                            [
                              "Advanced",
                              count((item) =>
                                ["advance", "hire"].includes(item.decision),
                              ),
                            ],
                            [
                              "Rejected",
                              count((item) => item.decision === "reject"),
                            ],
                            [
                              "On hold",
                              count((item) => item.decision === "hold"),
                            ],
                          ].map(([label, value]) => (
                            <div key={label}>
                              <dt className="text-xs text-muted-foreground">
                                {label}
                              </dt>
                              <dd className="mt-1 font-bold tabular-nums">
                                {value}
                              </dd>
                            </div>
                          ))}
                        </dl>
                        <p className="mt-3 text-xs text-muted-foreground">
                          Latest interview outcome per candidate and round.
                        </p>
                      </article>
                    );
                  },
                )}
              </section>
              {candidatePipeline}
            </>
          )}
          {view === "calendar" && (
            <>
              <RecruitmentCalendar
                month={month}
                onMonth={(v) => {
                  setMonth(v);
                  setInterviewPage(0);
                }}
                items={interviews.items}
                onOpen={(i) => void open(i)}
              />
              <Pagination
                page={interviewPage}
                size={50}
                total={interviews.total}
                change={setInterviewPage}
              />
            </>
          )}
          {view === "interviews" && (
            <>
              <div className="flex flex-wrap items-end gap-3">
                <label className="text-xs font-semibold text-muted-foreground">
                  Show
                  <AppSelect
                    aria-label="Interview view filter"
                    value={bucket}
                    onValueChange={(v) => {
                      setBucket(v);
                      setInterviewPage(0);
                    }}
                  >
                    <option value="upcoming">Upcoming interviews</option>
                    {caps?.canManage && Object.entries(schedulingFilters).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
                    <option value="pending_review">Pending reviews</option>
                    <option value="completed">Completed reviews</option>
                    <option value="today">Today’s interviews</option>
                    <option value="held">On hold / follow-up</option>
                    <option value="all">All interviews</option>
                  </AppSelect>
                </label>
                {!reviewer && !scheduling && <label className="text-xs font-semibold text-muted-foreground">
                  Round
                  <AppSelect
                    aria-label="Round filter"
                    value={round}
                    onValueChange={(v) => {
                      setRound(v);
                      setInterviewPage(0);
                    }}
                  >
                    <option value="">All rounds</option>
                    <option value="technical">Technical</option>
                    <option value="managerial">Managerial</option>
                    <option value="hr">HR</option>
                  </AppSelect>
                </label>}
              </div>
              {scheduling ? (loading ? <Skeleton aria-label="Loading scheduling queue" className="h-64"/> : candidatePipeline) : <>{!interviews.items.length ? (
                <Empty
                  text={
                    bucket === "pending_review"
                      ? "You have no outstanding interview reviews."
                      : bucket === "completed" ? "No submitted reviews in this view."
                      : bucket === "today" ? "No interviews scheduled for today."
                      : bucket === "held" ? "No interviews on hold in this view."
                      : "No upcoming interviews. Candidates awaiting a booking are in the scheduling-pending filters; submitted reviews are in Completed reviews."
                  }
                />
              ) : (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {interviews.items.map((row) => (
                    <InterviewCandidateCard key={row.interviewId} row={row}
                      onOpen={item => void open(item)} onRoadmap={openRoadmap} />
                  ))}
                </div>
              )}
              <Pagination
                page={interviewPage}
                size={50}
                total={interviews.total}
                change={setInterviewPage}
              /></>}
            </>
          )}
          {view === "notifications" && (
            <section className="rounded-2xl border border-border bg-card p-5">
              <h2 className="text-lg font-bold">Your notifications</h2>
              {notifications.items.length ? (
                notifications.items.map((n: any) => (
                  <article
                    key={n.notificationId}
                    className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-4"
                  >
                    <div className="flex items-center gap-3">
                      <Bell className="h-4 w-4 text-primary" />
                      <div>
                        <p className="font-semibold">{stageLabel(n.kind)}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatTime(n.createdAt)}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          void recruitmentRequest<Interview>(
                            `/interviews/${n.interviewId}`,
                          )
                            .then(open)
                            .catch((e) => setError(e.message))
                        }
                      >
                        Open interview
                      </Button>
                      {!n.readAt && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            void recruitmentRequest(
                              `/notifications/${n.notificationId}/read`,
                              {},
                            )
                              .then(refresh)
                              .catch((e) => setError(e.message))
                          }
                        >
                          Mark read
                        </Button>
                      )}
                    </div>
                  </article>
                ))
              ) : (
                <Empty text="You’re up to date. Interview assignments and review updates will appear here." />
              )}
              <Pagination
                page={notificationPage}
                size={25}
                total={notifications.total}
                change={setNotificationPage}
              />
            </section>
          )}
          {view === "access" && caps?.canAdmin && <RecruitmentAccess />}
        </>
      )}
      {!!queue.length && (
        <ScheduleDialog
          key={`${queue[0].applicationId}:${reschedule?.interviewId || "new"}`}
          application={queue[0]}
          existing={reschedule || undefined}
          onClose={() => {
            setQueue([]);
            setReschedule(null);
          }}
          onSaved={() => {
            refresh();
            setQueue((q) => q.slice(1));
            setReschedule(null);
            setSelected((s) =>
              s.filter((a) => a.applicationId !== queue[0].applicationId),
            );
          }}
        />
      )}
    </div>
  );
  const workspace = opened ? <InterviewReviewPage key={opened.interviewId} initial={opened} initialTab={openedTab}
    onReviewSubmitted={interview=>{
      setReviewCompletion({interviewId:interview.interviewId,candidateName:interview.candidate.name,round:interview.round});
      setOpened(null);setView('interviews');setBucket('completed');setInterviewPage(0);
    }}
    onClose={()=>setOpened(null)} onChanged={refresh} onReschedule={interview=>{
      setOpened(null);
      setQueue([{...interview.application,candidate:interview.candidate,jobTitle:interview.jobTitle}]);
      setReschedule(interview);
    }}/>:candidate ? <>
      {error && <p role="alert" className="rounded-xl border border-destructive/30 p-4 text-sm text-destructive">{error}</p>}
      <CandidateRoadmapPage application={candidate} onClose={()=>setCandidate(null)}
        backLabel={view==='interviews'?'Back to interviews':view==='candidates'?'Back to candidates':'Back to overview'}
        onOpenReview={candidate.activeInterview || candidate.latestInterview ? ()=>void openRoadmapReview(candidate) : undefined}/>
    </>:content;
  return standalone ? (
    <div className="min-h-screen bg-background text-foreground">
      <header className="apple-toolbar border-b border-border">
        <div className={`mx-auto flex items-center justify-between gap-4 py-4 ${opened ? "w-full px-4 sm:px-8" : "max-w-7xl px-5"}`}>
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary font-semibold text-primary-foreground">
              EH
            </span>
            <span className="font-bold">
              Elite HR{" "}
              <span className="ml-2 hidden text-xs font-normal text-muted-foreground sm:inline">
                Hiring intelligence
              </span>
            </span>
          </div>
          <div className="flex items-center gap-3"><GoogleCalendarConnection/><ModeToggle/><span className="text-sm">{user?.name}</span></div>
        </div>
      </header>
      <main className={opened||candidate?'w-full':'mx-auto max-w-7xl px-4 py-6 sm:px-6'}>{workspace}</main>
    </div>
  ) : (
    workspace
  );
}
function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p className="mt-3 text-3xl font-bold tabular-nums">{value}</p>
      <p className="mt-2 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
function Avatar({ name }: { name: string }) {
  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/20 text-sm font-bold">
      {name
        .split(" ")
        .map((v) => v[0])
        .slice(0, 2)
        .join("")}
    </span>
  );
}
function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
      {children}
    </span>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card px-6 py-12 text-center">
      <CheckCircle2 className="mx-auto h-7 w-7 text-muted-foreground" />
      <p className="mx-auto mt-3 max-w-lg text-sm text-muted-foreground">
        {text}
      </p>
    </div>
  );
}
function Pagination({
  page,
  size,
  total,
  change,
}: {
  page: number;
  size: number;
  total: number;
  change: (p: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
      <span>
        {total
          ? `${page * size + 1}–${Math.min((page + 1) * size, total)} of ${total}`
          : "0 results"}
      </span>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!page}
          onClick={() => change(page - 1)}
        >
          <ChevronLeft className="mr-1 h-3 w-3" />
          Previous
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={(page + 1) * size >= total}
          onClick={() => change(page + 1)}
        >
          Next
          <ChevronRight className="ml-1 h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}
