import React from "react";
import { ArrowRight, CalendarDays, CheckCircle2, ClipboardList, Clock, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Application, Interview, ReviewerSummary, formatTime } from "../../lib/recruitmentApi";
import { InterviewCandidateCard, roundTitle } from "./InterviewCandidateCard";

export function ReviewerDashboard({ round, summary, interviews, total, onBucket, onOpen, onRoadmap }: {
  round: string; summary?: ReviewerSummary | null; interviews: Interview[]; total: number;
  onBucket: (bucket: string) => void; onOpen: (row: Interview) => void; onRoadmap: (application: Application) => void;
}) {
  const next = interviews.find(row => row.status === "scheduled");
  const pending = summary?.pendingReview || 0;
  return (
    <div className="space-y-6">
      <section aria-label="Your interview overview" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          { label: "Interviews today", value: summary?.today, Icon: CalendarDays, bucket: "today", hint: "Scheduled for today · IST" },
          { label: "Upcoming interviews", value: summary?.upcoming, Icon: Clock, bucket: "upcoming", hint: "Prepare for your conversations" },
          { label: "Awaiting your review", value: summary?.pendingReview, Icon: ClipboardList, bucket: "pending_review", hint: "Interviews finished · feedback needed" },
          { label: "Reviews submitted", value: summary?.completed, Icon: CheckCircle2, bucket: "completed", hint: "Your completed evaluations" },
        ].map(({ label, value, Icon, bucket, hint }) => (
          <button key={label} onClick={() => onBucket(bucket)} className="rounded-2xl border border-border bg-card p-4 text-left shadow-sm transition hover:border-primary/60 focus-visible:outline-2 focus-visible:outline-primary sm:p-5">
            <span className="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground sm:text-sm">{label}<Icon className="h-4 w-4 shrink-0 text-primary" /></span>
            <span className="mt-3 block text-3xl font-bold tabular-nums">{value ?? "—"}</span>
            <span className="mt-2 block text-xs text-muted-foreground">{hint}</span>
          </button>
        ))}
      </section>
      <section aria-label="Interview preparation" className="grid overflow-hidden rounded-2xl border border-border bg-card lg:grid-cols-[1.5fr_1fr]">
        <div className="relative overflow-hidden bg-primary/10 p-6 sm:p-8">
          <span aria-hidden="true" className="pointer-events-none absolute -right-12 -top-16 h-64 w-64 rounded-full border-[35px] border-primary/10" />
          <p className="relative text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{roundTitle(round)} desk · Next interview</p>
          <h2 className="relative mt-4 break-words text-2xl font-bold tracking-tight sm:text-3xl">{next ? next.candidate.name : pending ? `${pending} review${pending === 1 ? "" : "s"} awaiting feedback` : "No upcoming interviews"}</h2>
          <p className="relative mt-2 text-sm text-muted-foreground">{next ? next.jobTitle : pending ? "Complete your recommendation and hand the candidate back to recruiting." : "Your next assigned interview will appear here. You can also check your completed reviews."}</p>
          {next && <p className="relative mt-5 flex items-center gap-2 text-sm font-semibold"><CalendarDays className="h-4 w-4" />{formatTime(next.startsAt)} IST</p>}
          <div className="relative mt-6 flex flex-wrap gap-2">
            {next ? <><Button onClick={() => onOpen(next)}>Prepare for interview<ArrowRight className="ml-2 h-4 w-4" /></Button>{next.meetingLink && <a href={next.meetingLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium"><Video className="h-4 w-4" />Join meeting</a>}</>
              : <Button variant="outline" onClick={() => onBucket(pending ? "pending_review" : "completed")}>{pending ? "Check pending reviews" : "View submitted reviews"}<ArrowRight className="ml-2 h-4 w-4" /></Button>}
          </div>
        </div>
        <div className="p-6 sm:p-8">
          <h3 className="font-semibold">Your interview checklist</h3>
          <ol className="mt-5 space-y-5">{[
            ["Review the candidate brief", round === "managerial" ? "Resume, assessment and the technical reviewer’s feedback." : round === "hr" ? "Resume, previous feedback and your interview questions." : "Resume, key skills, assessment and the job description."],
            ["Join the conversation", "Your assigned schedule and meeting link, in one place."],
            ["Submit your recommendation", "Record strengths, concerns and the next step after the interview."],
          ].map(([title, description], index) => <li key={title} className="flex gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold">{index + 1}</span><div><p className="text-sm font-semibold">{title}</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p></div></li>)}</ol>
        </div>
      </section>
      <section aria-label="Your upcoming candidates" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-bold">Your upcoming candidates</h2><p className="mt-1 text-sm text-muted-foreground">{total} assigned interviews · Only your interview assignments appear here</p></div><Button variant="outline" onClick={() => onBucket("upcoming")}>View all interviews<ArrowRight className="ml-2 h-4 w-4" /></Button></div>
        {interviews.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{interviews.slice(0, 3).map(row => <InterviewCandidateCard key={row.interviewId} row={row} onOpen={onOpen} onRoadmap={onRoadmap} />)}</div>
          : <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center"><CalendarDays className="mx-auto h-7 w-7 text-muted-foreground" /><p className="mt-3 text-sm text-muted-foreground">No interviews in this view. Scheduled candidates will appear here.</p></div>}
      </section>
    </div>
  );
}
