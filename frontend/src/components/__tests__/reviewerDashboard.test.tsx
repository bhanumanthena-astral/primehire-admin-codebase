import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ReviewerDashboard } from "../recruitment/ReviewerDashboard";
import { InterviewCandidateCard } from "../recruitment/InterviewCandidateCard";
import { Interview } from "../../lib/recruitmentApi";

const row = {
  interviewId: "test-interview", round: "managerial", status: "scheduled",
  startsAt: "2026-10-17T06:30:00Z", endsAt: "2026-10-17T07:30:00Z", serverTime: "2026-10-16T06:30:00Z",
  jobTitle: "Backend Engineer", meetingLink: "https://meet.google.com/test",
  application: { applicationId: "app", currentStage: "HR_ROUND", assessment: { score: 82 } },
  candidate: { name: "Test Candidate", experienceYears: 4, skills: ["Python"], summary: "Builds backend systems" },
} as Interview;

describe("Personal reviewer dashboard", () => {
  it("shows server-wide personal totals and working queue shortcuts", () => {
    const bucket = vi.fn(), open = vi.fn();
    render(<ReviewerDashboard round="managerial" summary={{ assigned: 70, today: 2, upcoming: 60, pendingReview: 3, completed: 7, advanced: 5, held: 1 }} interviews={[row]} total={60} onBucket={bucket} onOpen={open} onRoadmap={vi.fn()} />);
    const overview = screen.getByRole("region", { name: "Your interview overview" });
    expect(within(overview).getByRole("button", { name: /Upcoming interviews/ })).toHaveTextContent("60");
    fireEvent.click(within(overview).getByRole("button", { name: /Awaiting your review/ }));
    expect(bucket).toHaveBeenLastCalledWith("pending_review");
    fireEvent.click(within(overview).getByRole("button", { name: /Reviews submitted/ }));
    expect(bucket).toHaveBeenLastCalledWith("completed");
    fireEvent.click(within(overview).getByRole("button", { name: /Interviews today/ }));
    expect(bucket).toHaveBeenLastCalledWith("today");
    fireEvent.click(screen.getByRole("button", { name: "Prepare for interview" }));
    expect(open).toHaveBeenCalledWith(row);
    expect(screen.queryByText("Recruitment roadmap")).not.toBeInTheDocument();
    expect(screen.getByText(/technical reviewer’s feedback/)).toBeVisible();
  });

  it("labels the completed managerial interview separately from the HR application stage", () => {
    const roadmap = vi.fn();
    render(<InterviewCandidateCard row={{ ...row, status: "reviewed", review: { decision: "advance" } }} onOpen={vi.fn()} onRoadmap={roadmap} />);
    const card = screen.getByRole("article");
    expect(card).toHaveTextContent("Managerial interview");
    expect(card).toHaveTextContent("Review submitted");
    expect(card).toHaveTextContent("Recommended for HR interview");
    expect(card).not.toHaveTextContent("Hr Round");
    expect(screen.queryByRole("link", { name: "Join meeting" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Candidate roadmap" }));
    expect(roadmap).toHaveBeenCalledWith(expect.objectContaining({ applicationId: "app", candidate: row.candidate }));
  });
});
