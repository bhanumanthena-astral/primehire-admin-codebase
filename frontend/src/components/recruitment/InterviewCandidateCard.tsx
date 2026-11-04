import React from "react";
import { ArrowUpRight, CalendarDays, CheckCircle2, Clock, FileText, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Application, Interview, formatTime, stageLabel } from "../../lib/recruitmentApi";

export const roundTitle = (round: string) => round === "hr" ? "HR" : stageLabel(round);
export function interviewOutcome(row: Interview) {
  const decision = row.review?.decision;
  if (decision === "advance") return row.round === "technical" ? "Recommended for managerial interview"
    : row.round === "managerial" ? "Recommended for HR interview" : "Recommended for offer review";
  return ({ hire: "Offer recommended", reject: "Rejection recommended", hold: "On hold · follow-up required",
    another_round: "Additional interview requested" }[decision as string] || "Review submitted");
}

export function InterviewCandidateCard({ row, onOpen, onRoadmap }: {
  row: Interview; onOpen: (row: Interview) => void; onRoadmap: (application: Application) => void;
}) {
  const clock = Date.parse(row.serverTime || "") || Date.now();
  const pending = row.status === "scheduled" && Date.parse(row.endsAt) <= clock;
  const status = row.status === "reviewed" ? "Review submitted" : row.status === "cancelled" ? "Cancelled"
    : pending ? "Awaiting your review" : "Scheduled";
  return (
    <article className="group flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/20 px-5 py-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{roundTitle(row.round)} interview</span>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${row.status === "reviewed" ? "bg-success/10 text-success dark:text-success" : "bg-primary/15 text-foreground"}`}>
          {row.status === "reviewed" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}{status}
        </span>
      </div>
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-base font-bold">
            {row.candidate.name.split(" ").map(part => part[0]).slice(0, 2).join("")}
          </span>
          <div className="min-w-0">
            <h2 className="break-words text-lg font-bold tracking-tight">{row.candidate.name}</h2>
            <p className="mt-1 break-words text-sm text-muted-foreground">{row.jobTitle}</p>
          </div>
        </div>
        <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-border bg-background/60 p-3">
          <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div><p className="text-sm font-semibold">{formatTime(row.startsAt)} IST</p>
            <p className="mt-1 text-xs text-muted-foreground">{Math.max(0, Math.round((Date.parse(row.endsAt) - Date.parse(row.startsAt)) / 60000))} minute interview{row.location ? ` · ${row.location}` : ""}</p></div>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3 border-b border-border pb-4">
          <div><dt className="text-xs text-muted-foreground">Assessment score</dt><dd className="mt-1 text-base font-bold">{row.application.assessment?.score != null ? `${row.application.assessment.score}%` : "Not recorded"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Experience</dt><dd className="mt-1 text-base font-bold">{row.candidate.experienceYears != null ? `${row.candidate.experienceYears} years` : "Not recorded"}</dd></div>
        </dl>
        <p className="mt-4 line-clamp-2 text-sm text-muted-foreground">{row.candidate.summary || row.candidate.currentDesignation || "Open the candidate brief to prepare for this interview."}</p>
        {!!row.candidate.skills?.length && <div className="mt-3 flex flex-wrap gap-1.5">{row.candidate.skills.slice(0, 5).map(skill => <span key={skill} className="rounded-md bg-muted px-2 py-1 text-xs">{skill}</span>)}</div>}
        {row.status === "reviewed" && <p className="mt-4 flex items-start gap-2 rounded-lg bg-success/5 p-3 text-sm"><ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-primary" />{interviewOutcome(row)}</p>}
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-5">
          <Button data-interview-open={row.interviewId} size="sm" onClick={() => onOpen(row)}><FileText className="mr-1.5 h-3.5 w-3.5" />View candidate & review</Button>
          {row.meetingLink && row.status === "scheduled" && <a className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-2 text-xs font-semibold hover:bg-muted" href={row.meetingLink} target="_blank" rel="noopener noreferrer"><Video className="h-3.5 w-3.5" />Join meeting</a>}
          <Button data-roadmap-open={row.applicationId} variant="ghost" size="sm" onClick={() => onRoadmap({ ...row.application, candidate: row.candidate, jobTitle: row.jobTitle, latestInterview: {interviewId:row.interviewId,round:row.round,status:row.status} })}>Candidate roadmap</Button>
        </div>
      </div>
    </article>
  );
}
