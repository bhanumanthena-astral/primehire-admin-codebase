import {PreviousRoundReport} from '../report/PreviousRoundReport';
import {InterviewCalendarStatus} from './InterviewCalendarStatus';
import {ReviewSubmissionSuccess} from './ReviewSubmissionSuccess';
import React, { useCallback, useEffect, useRef, useState } from "react";
import DOMPurify from "dompurify";
import {
  Video,
  Download,
  Clock,
  CheckCircle2,
  Loader2,
  MessageSquare,
  ShieldCheck,
  FileText,
  ArrowLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AppSelect } from "../ui/AppSelect";
import {
  Interview,
  recruitmentRequest,
  recruitmentDownload,
  formatTime,
  stageLabel,
} from "../../lib/recruitmentApi";

function ReviewCard({ review }: { review: any }) {
  return (
    <article className="min-w-0 break-words rounded-2xl border border-border bg-card p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-semibold">{roundLabel(review.round)} review</h4>
        <span className="rounded-full bg-primary/15 px-2 py-1 text-xs font-semibold">
          {stageLabel(review.decision)}
        </span>
      </div>
      <section aria-label={`${roundLabel(review.round)} review ratings`} className="mt-4">
        <h5 className="mb-3 text-sm font-semibold">Interview ratings</h5>
        {Object.keys(review.scorecard || {}).length ? <dl className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,11rem),1fr))]">
          {Object.entries(review.scorecard).map(([key, value]) => <div key={key} className="rounded-xl border border-primary/25 bg-[var(--primary-soft)] p-4">
            <dt className="text-sm font-semibold">{ratingLabel(key)}</dt>
            <dd className="mt-2 text-3xl font-semibold tabular-nums text-accent">{String(value)}<span className="ml-1 text-sm font-medium text-muted-foreground">/ 5</span></dd>
            <RatingScale value={Number(value)}/>
          </div>)}
        </dl> : <p className="text-sm text-muted-foreground">No ratings recorded for this round.</p>}
      </section>
      <p className="mt-3 whitespace-pre-wrap text-sm">
        <strong>Strengths: </strong>
        {review.strengths}
      </p>
      {review.concerns && (
        <p className="mt-2 whitespace-pre-wrap text-sm">
          <strong>Concerns: </strong>
          {review.concerns}
        </p>
      )}
      <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
        {review.comments}
      </p>
      {review.notes && <p className="mt-3 whitespace-pre-wrap text-sm"><strong>Managerial notes: </strong>{review.notes}</p>}
      {review.managerialSummary && <section className="mt-4 space-y-2 rounded-lg border border-border p-4">
        <h4 className="font-semibold">AI managerial summary · {review.managerialSummary.status}</h4>
        <p className="text-xs text-muted-foreground">AI-assisted feedback for human review. The interviewer’s recommendation remains authoritative.</p>
        {review.managerialSummary.error && <p role="status" className="text-sm">{review.managerialSummary.error}</p>}
        {review.managerialSummary.content && <>
          <p className="whitespace-pre-wrap text-sm">{review.managerialSummary.content.overview}</p>
          {([['strengths', 'Strengths'], ['concerns', 'Concerns'], ['hrFollowUps', 'HR follow-ups']] as const).map(([key, label]) => <div key={key}><h5 className="text-sm font-semibold">{label}</h5><ul className="list-disc pl-5 text-sm">{review.managerialSummary.content[key].map((item: string, i: number) => <li key={i}>{item}</li>)}</ul></div>)}
          <p className="text-xs text-muted-foreground">Generated {formatTime(review.managerialSummary.generatedAt)} · Evaluation {review.managerialSummary.evaluationId}{review.managerialSummary.sourceReport?.sourceReportVersion ? ` · Source report v${review.managerialSummary.sourceReport.sourceReportVersion}` : ''}</p>
        </>}
      </section>}
      {review.followUpAt && (
        <p className="mt-2 text-xs">
          Follow-up: {formatTime(review.followUpAt)}
        </p>
      )}
      <p className="mt-3 flex items-center gap-1 text-xs text-muted-foreground">
        <ShieldCheck className="h-3 w-3" />
        Submitted {formatTime(review.createdAt)} · locked
      </p>
    </article>
  );
}

function roundLabel(round = 'interview') { return round === 'hr' ? 'HR' : round.charAt(0).toUpperCase() + round.slice(1); }
function ratingLabel(key: string) {
  const label = key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').toLowerCase();
  return label.charAt(0).toUpperCase() + label.slice(1);
}
function RatingScale({value}: {value: number}) {
  return <div aria-hidden="true" className="mt-3 flex gap-1">{[1,2,3,4,5].map(number=><span key={number} className={`h-1.5 flex-1 rounded-full ${number<=value?'bg-primary':'bg-border'}`}/>)}</div>;
}

export function InterviewReviewPage({
  initial,
  onClose,
  onChanged,
  onReschedule,
  onReviewSubmitted,
  initialTab='brief',
}: {
  initial: Interview;
  onClose: () => void;
  onChanged: () => void;
  onReschedule: (i: Interview) => void;
  onReviewSubmitted?: (interview:Interview) => void;
  initialTab?: 'brief'|'reviews';
}) {
  const [row, setRow] = useState(initial);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(()=>{headingRef.current?.focus({preventScroll:true});},[initial.interviewId]);
  const [tab, setTab] = useState<string>(initialTab);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reviewSubmitted,setReviewSubmitted]=useState(false);
  const reviewSubmissionStarted=useRef(false);
  const [confirmQuestions, setConfirmQuestions] = useState(false);
  const [dirtyQuestions, setDirtyQuestions] = useState<Set<string>>(new Set());
  const questionDirty = useCallback((id: string, dirty: boolean) => {
    setDirtyQuestions(previous => {
      if (previous.has(id) === dirty) return previous;
      const next = new Set(previous);
      if (dirty) next.add(id); else next.delete(id);
      return next;
    });
  }, []);
  const questionsUsed = row.questions && (
    row.questions.revision !== (row.questions.generatedRevision ?? 1) ||
    row.questions.questions.some((q: any) => q.asked || q.answer)
  );
  const [reveal, setReveal] = useState<any>(null);
  const [decision, setDecision] = useState(initial.evaluationDraft?.decision || "advance");
  const [strengths, setStrengths] = useState(initial.evaluationDraft?.strengths || "");
  const [concerns, setConcerns] = useState(initial.evaluationDraft?.concerns || "");
  const [comments, setComments] = useState(initial.evaluationDraft?.comments || "");
  const [notes, setNotes] = useState(initial.evaluationDraft?.notes || "");
  const [evaluationDirty, setEvaluationDirty] = useState(false);
  const [followup, setFollowup] = useState(initial.evaluationDraft?.followUpAt ? new Date(Date.parse(initial.evaluationDraft.followUpAt) + 330 * 60000).toISOString().slice(0,16) : "");
  const [scorecard, setScorecard] = useState<Record<string, number>>({
    communication: 3,
    ...initial.evaluationDraft?.scorecard,
  });
  const [action, setAction] = useState<
    "cancel" | "send-invitation" | "confirm-rejection" | null
  >(null);
  const [reason, setReason] = useState("");
  const [clock, setClock] = useState(()=>Date.now());
  const [clockOffset, setClockOffset] = useState(()=>{const value=Date.parse(initial.serverTime||'');return Number.isFinite(value)?value-Date.now():0;});
  useEffect(()=>{
    const server=Date.parse(row.serverTime||'');
    if(Number.isFinite(server))setClockOffset(server-Date.now());
  },[row.serverTime]);
  useEffect(()=>{
    const update=()=>setClock(Date.now());
    const timer=setInterval(update,1000);
    window.addEventListener('focus',update);
    document.addEventListener('visibilitychange',update);
    return()=>{clearInterval(timer);window.removeEventListener('focus',update);document.removeEventListener('visibilitychange',update);};
  },[]);
  const reviewOpensAt=Date.parse(row.startsAt);
  const reviewNotStarted=!Number.isFinite(reviewOpensAt)||clock+clockOffset<reviewOpensAt;
  const refresh = async () =>
    setRow(
      await recruitmentRequest<Interview>(`/interviews/${row.interviewId}`),
    );
  async function run(fn: () => Promise<any>, message = "Saved.") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await refresh();
      onChanged();
      setNotice(message);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    setRow(initial);
  }, [initial.interviewId]);
  const criteria =
    row.round === "technical"
      ? ["technicalDepth", "problemSolving", "communication"]
      : row.round === "managerial"
        ? ["ownership", "leadership", "communication", "cultureFit"]
        : ["communication", "cultureFit"];
  const close = () => {
    if ((evaluationDirty || dirtyQuestions.size > 0) && !window.confirm('Discard unsaved interview review or question changes?')) return;
    onClose();
  };
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (evaluationDirty || dirtyQuestions.size > 0) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [evaluationDirty, dirtyQuestions.size]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if(busy||reviewSubmissionStarted.current||row.review||!row.canReview||reviewNotStarted)return;
    reviewSubmissionStarted.current=true;
    setBusy(true);setError('');setNotice('');
    let saved:Interview;
    try {
      saved=await recruitmentRequest<Interview>(`/interviews/${row.interviewId}/review`, {
          expectedRevision: row.revision,
          decision,
          strengths,
          concerns,
          comments,
          ...(row.round === "managerial" ? { notes } : {}),
          scorecard: Object.fromEntries(
            criteria.map((key) => [key, scorecard[key] || 3]),
          ),
          followUpAt: followup
            ? new Date(`${followup}+05:30`).toISOString()
            : null,
        });
    } catch(cause) {
      reviewSubmissionStarted.current=false;
      setBusy(false);setError(cause instanceof Error?cause.message:'Your review could not be submitted. Please try again.');
      return;
    }
    // The successful POST is authoritative; a later list refresh cannot turn a
    // saved review into a failed submission or encourage a duplicate POST.
    setRow(saved);setEvaluationDirty(false);setReviewSubmitted(true);setBusy(false);
    onChanged();onReviewSubmitted?.(saved);
  };
  if(reviewSubmitted)return <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-8"><ReviewSubmissionSuccess
    completion={{interviewId:row.interviewId,candidateName:row.candidate.name,round:row.round}}
    onContinue={onClose} onViewReview={()=>{setReviewSubmitted(false);setTab('reviews');}}/></div>;
  return (
    <section aria-label={`${row.candidate.name} interview workspace`} className="w-full min-w-0 min-h-[calc(100dvh-6rem)] bg-background text-foreground">
      <div className="border-b border-border bg-card px-4 py-5 sm:px-8">
        <Button type="button" variant="ghost" disabled={busy} onClick={close} className="mb-5"><ArrowLeft className="size-4"/>Back to interviews</Button>
        <div className="flex items-start gap-4 pr-6">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary/20 text-lg font-bold">
            {row.candidate.name
              .split(" ")
              .map((v) => v[0])
              .slice(0, 2)
              .join("")}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              {row.round} interview
            </p>
            <h2 ref={headingRef} tabIndex={-1} className="mt-1 break-words text-2xl font-bold outline-none">
              {row.candidate.name}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {row.jobTitle}
            </p>
            <p className="mt-1 break-all text-xs text-muted-foreground">Candidate {row.candidate.applicantId} · Application {row.applicationId} · Round {row.interviewId}</p>
            <p className="mt-1 text-xs text-muted-foreground">Application stage: {row.application.currentStage === "HR_ROUND" ? "HR stage" : stageLabel(row.application.currentStage)} · This interview: {row.round === "hr" ? "HR" : stageLabel(row.round)}</p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3 text-sm">
          <span className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" />
            {formatTime(row.startsAt)}
          </span>
          <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold capitalize">
            {row.status}
          </span>
          <InterviewCalendarStatus interview={row} onChanged={()=>{void recruitmentRequest<Interview>(`/interviews/${row.interviewId}`).then(setRow).catch(cause=>setError(cause.message));}}/>
          {row.meetingLink && row.status === "scheduled" && (
            <a
              href={row.meetingLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
            >
              <Video className="h-4 w-4" />
              Join meeting
            </a>
          )}
        </div>
      </div>
      <div
        className="flex flex-wrap gap-1 border-b border-border bg-card px-4 py-2 sm:px-8"
        role="tablist"
        aria-label="Interview details"
      >
        {[
          ["brief", "Candidate brief"],
          ["reviews", "Reviews & decision"],
          ...(row.round === "hr"
            ? [
                ["questions", "HR questions"],
                ...(row.canCompensate
                  ? [["salary", "Offer & negotiation"]]
                  : []),
              ]
            : []),
          ...(row.canManage ? [["schedule", "Schedule & delivery"]] : []),
        ].map(([id, label]) => (
          <Button
            key={id}
            type="button"
            variant={tab === id ? "secondary" : "ghost"}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
          </Button>
        ))}
      </div>
      <div className="space-y-6 px-4 py-6 sm:px-8">
        {error && (
          <p
            role="alert"
            className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
          >
            {error}
          </p>
        )}
        {notice && (
          <p
            role="status"
            className="flex items-center gap-2 rounded-lg bg-primary/10 p-3 text-sm"
          >
            <CheckCircle2 className="h-4 w-4" />
            {notice}
          </p>
        )}
        {tab === "brief" && (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <Metric
                label="Assessment score"
                value={
                  row.application.assessment?.score == null
                    ? "Not available"
                    : `${row.application.assessment.score}%`
                }
              />
              <Metric
                label="Experience"
                value={
                  row.candidate.experienceYears == null
                    ? "Not available"
                    : `${row.candidate.experienceYears} years`
                }
              />
              <Metric
                label="Current role"
                value={row.candidate.currentDesignation || "Not available"}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-4">
              <div className="text-sm">
                <p>{reveal?.email || row.candidate.email}</p>
                <p className="mt-1 text-muted-foreground">
                  {reveal?.phone || row.candidate.phone}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {row.canReveal && !reveal && (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        async () =>
                          setReveal(
                            await recruitmentRequest(
                              `/interviews/${row.interviewId}/reveal`,
                              {
                                reason:
                                  "Contact details required for the assigned interview",
                              },
                            ),
                          ),
                        "Contact reveal recorded in the audit history.",
                      )
                    }
                  >
                    Reveal contact
                  </Button>
                )}
                {row.canDownload && (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () =>
                          recruitmentDownload(
                            `/interviews/${row.interviewId}/resume`,
                            "candidate-resume",
                          ),
                        "Resume downloaded.",
                      )
                    }
                  >
                    <Download className="mr-2 h-4 w-4" />
                    Resume
                  </Button>
                )}
              </div>
            </div>
            {row.candidate.summary && (
              <section>
                <h3 className="font-bold">Candidate summary</h3>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                  {row.candidate.summary}
                </p>
              </section>
            )}
            {row.candidate.skills && (
              <section>
                <h3 className="font-bold">Skills</h3>
                <div className="mt-3 flex flex-wrap gap-2">
                  {row.candidate.skills.length ? (
                    row.candidate.skills.map((s) => (
                      <span
                        key={s}
                        className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium"
                      >
                        {s}
                      </span>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No skills recorded.
                    </p>
                  )}
                </div>
              </section>
            )}
            {row.candidate.education && (
              <p className="text-sm">
                Education:{" "}
                {row.candidate.education.join(", ") || "Not available"}
              </p>
            )}
            <section className="rounded-xl border border-border p-5">
              <h3 className="flex items-center gap-2 font-bold">
                <FileText className="h-4 w-4" />
                Job brief
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                {row.job.jobRole} · {row.job.location} · {row.job.workMode}
              </p>
              <div
                className="mt-3 break-words text-sm leading-relaxed [&_p]:mb-2"
                dangerouslySetInnerHTML={{
                  __html: DOMPurify.sanitize(
                    row.job.jdHtml ||
                      row.job.jdText ||
                      "No description available.",
                  ),
                }}
              />
            </section>
          </>
        )}
        {tab === "reviews" && (
          <>
            {row.previousReviews?.map((r) => (
              <ReviewCard key={r.reviewId} review={r} />
            ))}
            {row.review ? (
              <><ReviewCard review={row.review} />{row.round === 'managerial' && row.interviewerId === row.review.reviewerId && row.review.managerialSummary?.status !== 'completed' && <Button disabled={busy} variant="outline" onClick={() => void run(() => recruitmentRequest(`/interviews/${row.interviewId}/managerial-summary`, {}), 'AI summary generation finished.')}>Retry AI summary</Button>}</>
            ) : row.canReview ? (
              <form className="flex min-w-0 flex-col gap-5 rounded-2xl border border-border bg-card p-4 sm:p-6" onSubmit={submit} onChange={() => setEvaluationDirty(true)}>
                {reviewNotStarted&&<p id="review-availability" role="status" className="rounded-xl border border-primary/25 bg-primary/5 p-4 text-sm">Review submission opens at <strong>{formatTime(row.startsAt)} IST</strong>. You can prepare your feedback now; Submit review becomes available automatically when the interview starts.</p>}
                <h3 className="flex items-center gap-2 font-bold">
                  <MessageSquare className="h-4 w-4" />
                  Your interview review
                </h3>
                <fieldset className="rounded-2xl border border-primary/25 bg-[var(--primary-soft)] p-4 sm:p-5">
                  <legend className="px-2 text-base font-semibold">Your ratings</legend>
                  <p className="mb-4 text-sm text-muted-foreground">Rate each area out of 5, then add the evidence and your recommendation below.</p>
                  <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,12rem),1fr))]">
                  {criteria.map((c) => (
                    <label key={c} className="flex min-w-0 flex-col rounded-xl border border-primary/20 bg-card p-4 text-sm font-semibold">
                      <span className="block min-h-10 leading-5">{ratingLabel(c)}</span>
                      <span aria-hidden="true" className="mt-2 block text-3xl font-semibold tabular-nums text-accent">{scorecard[c] || 3}<span className="ml-1 text-sm text-muted-foreground">/ 5</span></span>
                      <RatingScale value={scorecard[c] || 3}/>
                      <AppSelect
                        aria-label={`${ratingLabel(c)} rating`}
                        className="mt-4 w-full"
                        value={String(scorecard[c] || 3)}
                        onValueChange={(v) =>
                          { setScorecard((s) => ({ ...s, [c]: Number(v) })); setEvaluationDirty(true); }
                        }
                      >
                        {[1, 2, 3, 4, 5].map((n) => (
                          <option key={n} value={n}>
                            {n} / 5
                          </option>
                        ))}
                      </AppSelect>
                    </label>
                  ))}
                  </div>
                </fieldset>
                <label className="block space-y-2 text-sm font-medium">
                  Strengths
                  <Textarea
                    aria-label="Candidate strengths"
                    value={strengths}
                    onChange={(e) => setStrengths(e.target.value)}
                    minLength={3}
                    maxLength={3000}
                    required
                  />
                </label>
                <label className="block space-y-2 text-sm font-medium">
                  Concerns / development areas
                  <Textarea
                    value={concerns}
                    onChange={(e) => setConcerns(e.target.value)}
                    maxLength={3000}
                  />
                </label>
                <label className="block space-y-2 text-sm font-medium">
                  Review and decision reasons
                  <Textarea
                    aria-label="Review reasons"
                    value={comments}
                    onChange={(e) => setComments(e.target.value)}
                    minLength={3}
                    maxLength={5000}
                    required
                  />
                </label>
                {row.round === 'managerial' && <label className="block space-y-2 text-sm font-medium">Managerial notes
                  <Textarea aria-label="Managerial notes" value={notes} onChange={e => setNotes(e.target.value)} maxLength={10000} placeholder="Additional observations from this interview" />
                  <span className="text-xs text-muted-foreground">{notes.length}/10000 · {row.evaluationDraft ? `Draft saved ${formatTime(row.evaluationDraft.updatedAt)}` : 'Not saved'}</span>
                </label>}
                <label className="block space-y-2 text-sm font-medium">
                  Recommendation
                  <AppSelect
                    aria-label="Review decision"
                    value={decision}
                    onValueChange={(v) => { setDecision(v); if (row.round === "managerial") setEvaluationDirty(true); }}
                  >
                    <option value="advance">
                      {row.round === "technical"
                        ? "Proceed to managerial"
                        : row.round === "managerial"
                          ? "Proceed to HR"
                          : "Recommend offer"}
                    </option>
                    <option value="reject">
                      {row.round === "hr"
                        ? "Do not hire"
                        : "Recommend rejection"}
                    </option>
                    <option value="hold">Hold — follow up later</option>
                    {row.round !== "hr" && (
                      <option value="another_round">
                        Another interview in this round
                      </option>
                    )}
                  </AppSelect>
                </label>
                {decision === "hold" && (
                  <label className="block space-y-2 text-sm font-medium">
                    Follow-up date · IST
                    <Input
                      type="datetime-local"
                      required
                      value={followup}
                      onChange={(e) => setFollowup(e.target.value)}
                    />
                  </label>
                )}
                <p className="text-xs text-muted-foreground">
                  Your submitted review is locked and recorded in the shared
                  timeline. Recommendations never send a candidate email
                  automatically.
                </p>
                {row.round === 'managerial' && <Button type="button" variant="outline" disabled={busy} onClick={() => void run(async () => {
                  await recruitmentRequest(`/interviews/${row.interviewId}/evaluation-draft`, { expectedRevision: row.revision, strengths, concerns, comments, notes, decision, scorecard: Object.fromEntries(criteria.map(key => [key, scorecard[key] || 3])), followUpAt: followup ? new Date(`${followup}+05:30`).toISOString() : null });
                  setEvaluationDirty(false);
                }, 'Managerial draft saved. The evaluation has not been submitted.')}>Save draft</Button>}
                <Button
                  type="submit"
                  className="self-start"
                  disabled={
                    busy || reviewNotStarted
                  }
                  aria-describedby={reviewNotStarted?'review-availability':undefined}
                >
                  {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Submit review
                </Button>
              </form>
            ) : (
              <p className="text-sm text-muted-foreground">
                The assigned interviewer has not submitted a review.
              </p>
            )}
            <PreviousRoundReport key={row.interviewId} interviewId={row.interviewId}/>
          </>
        )}
        {tab === "questions" && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-bold">
                  HR questions based on the JD and resume
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Motivation, communication, teamwork, ownership and role expectations.
                  Review suggestions and record the candidate’s answers.
                </p>
              </div>
              <Button
                disabled={busy || !!questionsUsed || dirtyQuestions.size > 0}
                onClick={() => row.questions ? setConfirmQuestions(true) :
                  void run(
                    () =>
                      recruitmentRequest(
                        `/interviews/${row.interviewId}/questions`,
                        { expectedRevision: row.revision },
                      ),
                    "HR question set ready.",
                  )
                }
              >
                {busy ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                {row.questions
                  ? "Regenerate HR questions"
                  : "Generate 10 HR questions"}
              </Button>
            </div>
            {confirmQuestions && (
              <section aria-label="Confirm HR question regeneration" className="space-y-3 rounded-xl border border-border bg-muted/30 p-4">
                <p className="text-sm">Replace these unused suggestions with 10 HR questions based on the current JD and resume?</p>
                <div className="flex gap-2">
                  <Button disabled={busy || !!questionsUsed || dirtyQuestions.size > 0} onClick={() => {
                    setConfirmQuestions(false);
                    void run(() => recruitmentRequest(`/interviews/${row.interviewId}/questions`, {
                      expectedRevision: row.revision, regenerate: true,
                      expectedQuestionRevision: row.questions.revision,
                    }), "HR questions regenerated.");
                  }}>Replace unused questions</Button>
                  <Button variant="ghost" disabled={busy} onClick={() => setConfirmQuestions(false)}>Keep current questions</Button>
                </div>
              </section>
            )}
            {(questionsUsed || dirtyQuestions.size > 0) && <p className="text-sm text-muted-foreground">
              Your edits and answers are protected. Edit individual questions as needed; regeneration is available only for unused suggestions without unsaved changes.
            </p>}
            {row.questions && (
              <>
                <p role="status" className="rounded-lg bg-muted p-3 text-sm">
                  {row.questions.note}
                </p>
                {row.questions.questions.map((q: any, index: number) => (
                  <QuestionEditor
                    key={`${q.questionId}:${row.questions.revision}`}
                    question={q}
                    index={index}
                    busy={busy}
                    onDirty={questionDirty}
                    onSave={(value: any) =>
                      run(
                        () =>
                          recruitmentRequest(
                            `/interviews/${row.interviewId}/questions`,
                            {
                              ...value,
                              expectedRevision: row.questions.revision,
                            },
                            "PUT",
                          ),
                        "Answer saved.",
                      )
                    }
                  />
                ))}
              </>
            )}
          </>
        )}
        {tab === "salary" && (
          <CompensationEditor
            row={row}
            busy={busy}
            onSave={(value) =>
              run(
                () =>
                  recruitmentRequest(
                    `/interviews/${row.interviewId}/compensation`,
                    { ...value, expectedRevision: row.revision },
                    "PUT",
                  ),
                "Compensation saved.",
              )
            }
            onOffer={(status, why) =>
              run(
                () =>
                  recruitmentRequest(`/interviews/${row.interviewId}/offer`, {
                    expectedRevision: row.revision,
                    status,
                    reason: why,
                  }),
                "Offer status updated.",
              )
            }
          />
        )}
        {tab === "schedule" && (
          <>
            {!!row.scheduleChanges?.length&&<section aria-label="Rescheduling history" className="space-y-3 rounded-xl border border-border p-4">
              <h3 className="font-semibold">Rescheduling history</h3>
              {row.scheduleChanges.map((change,index)=><div key={`${change.changedAt}:${index}`} className="border-t border-border pt-3 text-sm">
                <p className="text-xs text-muted-foreground">Changed {formatTime(change.changedAt)} · IST</p>
                {change.before?.startsAt&&<p className="mt-1 text-xs">Previous: {formatTime(change.before.startsAt)} – {formatTime(change.before.endsAt!)} IST</p>}
                {change.after?.startsAt&&<p className="mt-1 text-xs">Updated: {formatTime(change.after.startsAt)} – {formatTime(change.after.endsAt!)} IST</p>}
                <p className="mt-2 whitespace-pre-wrap"><strong>Reason: </strong>{change.reason}</p>
              </div>)}
            </section>}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={busy || row.status !== "scheduled"}
                onClick={() => onReschedule(row)}
              >
                Reschedule / reassign
              </Button>
              <Button
                variant="outline"
                disabled={busy || row.status !== "scheduled"}
                onClick={() => {
                  setAction("send-invitation");
                  setReason("");
                }}
              >
                Send candidate invitation
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run(
                    () =>
                      recruitmentDownload(
                        `/interviews/${row.interviewId}/invitation.pdf`,
                        "interview-invitation.pdf",
                      ),
                    "Invitation downloaded.",
                  )
                }
              >
                <Download className="mr-2 h-4 w-4" />
                Professional invitation PDF
              </Button>
              <Button
                variant="outline"
                disabled={busy || row.status !== "scheduled"}
                onClick={() => {
                  setAction("cancel");
                  setReason("");
                }}
              >
                Cancel interview
              </Button>
              {row.application.currentStage ===
                "REJECTION_PENDING_HR_REVIEW" && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setAction("confirm-rejection");
                    setReason("");
                  }}
                >
                  Confirm rejection
                </Button>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              Reminder: {row.reminderMinutes} minutes before ·{" "}
              {row.location || "Online meeting"}
            </p>
            {action && (
              <form
                className="space-y-3 rounded-xl border border-border p-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(
                    async () => {
                      await recruitmentRequest(
                        `/interviews/${row.interviewId}/${action}`,
                        { expectedRevision: row.revision, reason },
                      );
                      setAction(null);
                    },
                    action === "send-invitation"
                      ? "Invitation request recorded. Check delivery status below."
                      : "Action recorded.",
                  );
                }}
              >
                <h4 className="font-semibold">
                  {action === "cancel"
                    ? "Cancel this interview?"
                    : action === "confirm-rejection"
                      ? "Approve this rejection?"
                      : "Send this candidate the current schedule?"}
                </h4>
                <label className="block text-sm">
                  Reason
                  <Textarea
                    aria-label="Action reason"
                    required
                    minLength={3}
                    maxLength={500}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <div className="flex gap-2">
                  <Button disabled={busy} type="submit">
                    Confirm
                  </Button>
                  <Button
                    disabled={busy}
                    type="button"
                    variant="ghost"
                    onClick={() => setAction(null)}
                  >
                    Back
                  </Button>
                </div>
              </form>
            )}
            <section>
              <h3 className="font-semibold">Email delivery</h3>
              {row.emailStatus.length ? (
                row.emailStatus.map((s, i) => (
                  <div
                    key={i}
                    className="mt-2 flex flex-wrap justify-between gap-2 rounded-lg bg-muted/40 p-3 text-sm"
                  >
                    <span>{stageLabel(s.kind)}</span>
                    <span>
                      {s.status}
                      {s.sentVia === "dry_run"
                        ? " · recorded only, not sent"
                        : ""}
                      {s.lastError ? ` · ${s.lastError}` : ""}
                    </span>
                  </div>
                ))
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  No delivery recorded yet. The background worker queues
                  interviewer assignments automatically.
                </p>
              )}
            </section>
          </>
        )}
      </div>
    </section>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted/40 p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-2 break-words text-lg font-bold">{value}</p>
    </div>
  );
}
function QuestionEditor({
  question,
  index,
  busy,
  onSave,
  onDirty,
}: {
  question: any;
  index: number;
  busy: boolean;
  onSave: (v: any) => void;
  onDirty: (id: string, dirty: boolean) => void;
}) {
  const [q, setQ] = useState(question.question);
  const [answer, setAnswer] = useState(question.answer || "");
  const [asked, setAsked] = useState(question.asked);
  useEffect(() => {
    onDirty(question.questionId, q !== question.question || answer !== (question.answer || "") || asked !== question.asked);
    return () => onDirty(question.questionId, false);
  }, [q, answer, asked, question, onDirty]);
  return (
    <form
      className="space-y-3 rounded-xl border border-border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ questionId: question.questionId, question: q, answer, asked });
      }}
    >
      <div className="flex justify-between text-xs font-semibold text-muted-foreground">
        <span>HR QUESTION {index + 1}</span>
        <span className="capitalize">
          Based on: {question.source === "job" ? "Job description" : question.source === "profile" ? "Resume" : "Earlier interview feedback"}
        </span>
      </div>
      <Textarea
        aria-label={`Question ${index + 1}`}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        minLength={5}
        maxLength={500}
        required
      />
      <Textarea
        aria-label={`Answer ${index + 1}`}
        placeholder="Record the candidate’s answer"
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        maxLength={3000}
      />
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={asked}
            onChange={(e) => setAsked(e.target.checked)}
          />
          Asked
        </label>
        <Button type="submit" size="sm" variant="outline" disabled={busy}>
          Save answer
        </Button>
      </div>
    </form>
  );
}
function CompensationEditor({
  row,
  busy,
  onSave,
  onOffer,
}: {
  row: Interview;
  busy: boolean;
  onSave: (v: any) => void;
  onOffer: (status: string, reason: string) => void;
}) {
  const [values, setValues] = useState<any>({
    currency: "INR",
    period: "annual",
    budget: "",
    candidateExpectation: "",
    proposedOffer: "",
    agreedAmount: "",
    notes: "",
    ...row.compensation,
  });
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState("offered");
  return (
    <>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const payload = { ...values, reason };
          for (const field of [
            "budget",
            "candidateExpectation",
            "proposedOffer",
            "agreedAmount",
          ])
            payload[field] =
              values[field] === "" || values[field] == null
                ? null
                : Number(values[field]);
          onSave(payload);
        }}
      >
        <h3 className="font-bold">Salary discussion</h3>
        <p className="text-sm text-muted-foreground">
          Amounts share the selected currency and pay period. Saving a
          discussion does not send an offer.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm">
            Currency
            <AppSelect
              value={values.currency}
              onValueChange={(v) =>
                setValues((p: any) => ({ ...p, currency: v }))
              }
            >
              {["INR", "USD", "EUR", "GBP"].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </AppSelect>
          </label>
          <label className="text-sm">
            Pay period
            <AppSelect
              value={values.period}
              onValueChange={(v) =>
                setValues((p: any) => ({ ...p, period: v }))
              }
            >
              <option value="annual">Annual</option>
              <option value="monthly">Monthly</option>
            </AppSelect>
          </label>
          {[
            ["budget", "Approved budget"],
            ["candidateExpectation", "Candidate expectation"],
            ["proposedOffer", "Proposed offer"],
            ["agreedAmount", "Agreed amount"],
          ].map(([key, label]) => (
            <label key={key} className="text-sm">
              {label}
              <Input
                aria-label={label}
                type="number"
                min={0}
                max={1000000000}
                step="0.01"
                value={values[key] ?? ""}
                onChange={(e) =>
                  setValues((p: any) => ({ ...p, [key]: e.target.value }))
                }
              />
            </label>
          ))}
        </div>
        <label className="block text-sm">
          Discussion notes
          <Textarea
            value={values.notes}
            onChange={(e) =>
              setValues((p: any) => ({ ...p, notes: e.target.value }))
            }
            maxLength={3000}
          />
        </label>
        <label className="block text-sm">
          Reason for change
          <Textarea
            aria-label="Compensation reason"
            required
            minLength={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <Button disabled={busy} type="submit">
          Save compensation
        </Button>
      </form>
      <section className="space-y-3 border-t border-border pt-5">
        <h3 className="font-bold">
          Offer status · {stageLabel(row.offerStatus || "not_started")}
        </h3>
        <p className="text-sm text-muted-foreground">
          A positive submitted HR review is required. Mark joined only after the
          candidate actually joins.
        </p>
        <div className="flex flex-wrap gap-2">
          <AppSelect
            aria-label="Offer outcome"
            value={status}
            onValueChange={setStatus}
          >
            {["negotiating", "offered", "accepted", "declined", "joined"].map(
              (s) => (
                <option key={s} value={s}>
                  {stageLabel(s)}
                </option>
              ),
            )}
          </AppSelect>
          <Button
            variant="outline"
            disabled={busy || reason.trim().length < 3}
            onClick={() => onOffer(status, reason)}
          >
            Record offer outcome
          </Button>
        </div>
      </section>
    </>
  );
}

// Compatibility for existing callers; the review workspace is a page.
export { InterviewReviewPage as InterviewDialog };
