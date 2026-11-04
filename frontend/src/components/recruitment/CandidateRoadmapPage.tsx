import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft, FileText, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Application, Tracker, formatTime, recruitmentRequest, stageLabel } from "../../lib/recruitmentApi";
import { roadmapEvents } from "../../lib/recruitmentTimeline";

type Props = { application: Application; onClose: () => void; backLabel?: string; onOpenReview?: () => void };

export function CandidateRoadmapPage(props: Props) {
  // A new application gets its own request and state, never the previous history.
  return <CandidateRoadmapContent key={props.application.applicationId} {...props} />;
}

function CandidateRoadmapContent({ application, onClose, backLabel = "Back to candidates", onOpenReview }: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({preventScroll:true}); }, [application.applicationId]);
  const [tracker, setTracker] = useState<Tracker | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setTracker(null);
    setError("");
    void recruitmentRequest<Tracker>(
      `/tracker?applicationId=${encodeURIComponent(application.applicationId)}`,
      undefined, "GET", controller.signal,
    ).then(result => {
      if (!controller.signal.aborted) setTracker(result);
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : "Please try again.");
    });
    return () => controller.abort();
  }, [application.applicationId, attempt]);

  return (
    <section aria-label="Candidate roadmap" className="mx-auto min-h-[calc(100dvh-6rem)] w-full min-w-0 max-w-7xl bg-background text-foreground">
      <header className="border-b border-border bg-card px-4 py-5 sm:px-8">
      <Button variant="ghost" type="button" onClick={onClose} className="mb-5"><ArrowLeft className="size-4"/>{backLabel}</Button>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Candidate roadmap</p>
      <h1 ref={heading} tabIndex={-1} className="mt-2 break-words text-2xl font-bold outline-none">{application.candidate.name}</h1>
      {application.jobTitle && <p className="mt-1 break-words text-sm text-muted-foreground">{application.jobTitle}</p>}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <span className="rounded-full bg-muted px-3 py-1 text-sm">Application stage: {application.currentStage === "HR_ROUND" ? "HR stage" : stageLabel(application.currentStage)}</span>
        <div className="flex flex-wrap gap-2">
        {onOpenReview && <Button data-interview-open={(application.activeInterview || application.latestInterview)?.interviewId} onClick={onOpenReview}><FileText className="size-4"/>View interview & review</Button>}
        <Button variant="outline" size="sm" disabled={!tracker && !error} onClick={() => setAttempt(n => n + 1)}>
          <RefreshCw className="mr-2 h-3.5 w-3.5" aria-hidden="true" />Refresh roadmap
        </Button>
        </div>
      </div>
      </header>
      <div className="space-y-6 px-4 py-6 sm:px-8">
      <section aria-label="Candidate profile" className="min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-6">
        <h2 className="text-lg font-bold">Candidate profile</h2>
        <dl className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            ["Current designation", application.candidate.currentDesignation],
            ["Experience", application.candidate.experienceYears == null ? null : `${application.candidate.experienceYears} years`],
            ["Assessment score", application.assessment?.score == null ? null : `${application.assessment.score}%`],
            ["Email", application.candidate.email], ["Phone", application.candidate.phone],
          ].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 break-words text-sm font-medium">{value || "Not available"}</dd></div>)}
        </dl>
        {application.candidate.summary && <p className="mt-5 whitespace-pre-wrap break-words text-sm">{application.candidate.summary}</p>}
        {!!application.candidate.skills?.length && <div className="mt-5"><h3 className="text-sm font-semibold">Skills</h3><div className="mt-2 flex flex-wrap gap-2">{application.candidate.skills.map(skill => <span key={skill} className="rounded-lg bg-muted px-3 py-1 text-sm">{skill}</span>)}</div></div>}
        {!!application.candidate.education?.length && <div className="mt-5"><h3 className="text-sm font-semibold">Education</h3><ul className="mt-2 space-y-2 text-sm">{application.candidate.education.map((entry,index) => <li key={index} className="break-words">{entry}</li>)}</ul></div>}
      </section>
      <section className="rounded-2xl border border-border bg-card p-4 sm:p-6">
      <h2 className="mb-4 text-lg font-bold">Recruitment history</h2>
        {error ? (
          <div role="alert" className="rounded-xl border border-destructive/30 p-4">
            <p className="font-semibold">Could not load this candidate’s roadmap.</p>
            <p className="mt-1 break-words text-sm text-muted-foreground">{error}</p>
            <Button className="mt-3" variant="outline" onClick={() => setAttempt(n => n + 1)}>Retry</Button>
          </div>
        ) : !tracker ? (
          <div role="status" aria-label="Loading candidate roadmap" className="space-y-3">
            <span className="sr-only">Loading candidate roadmap…</span>
            <Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" />
          </div>
        ) : tracker.timeline.length ? (
          <>
            <p className="mb-3 text-xs text-muted-foreground">Recruitment history · All times in IST</p>
            <ol aria-label="Candidate recruitment history" className="ml-2 border-l-2 border-primary/25 pl-5">
              {roadmapEvents(tracker.timeline).map((entry, i) => (
                <li key={entry.historyId || i} className="relative py-3">
                  <span aria-hidden="true" className="absolute -left-[27px] top-5 h-3 w-3 rounded-full bg-primary" />
                  <p className="font-semibold">{entry.title}</p>
                  {entry.nextStep && <p className="mt-1 text-sm font-medium text-primary">Next step: {entry.nextStep}</p>}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {entry.transitionAt && Number.isFinite(Date.parse(entry.transitionAt))
                      ? <time dateTime={entry.transitionAt}>{formatTime(entry.transitionAt)}</time>
                      : "Time not recorded"}
                    {(entry.actorName || entry.actorUserId) && <> · {entry.actorName || entry.actorUserId}</>}
                  </p>
                  {entry.reason && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">{entry.reason}</p>}
                </li>
              ))}
            </ol>
          </>
        ) : <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No stage history recorded yet for this candidate.</p>}
      </section>
      </div>
    </section>
  );
}
