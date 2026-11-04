import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { CandidateRoadmapPage } from "../recruitment/CandidateRoadmapPage";
import { Application, Tracker, recruitmentRequest } from "../../lib/recruitmentApi";

vi.mock("../../lib/recruitmentApi", async original => ({
  ...(await original<any>()), recruitmentRequest: vi.fn(),
}));
const application = (id = "app-a"): Application => ({
  applicationId: id, applicantId: id, jobId: "job", currentStage: "HR_ROUND",
  createdAt: "2026-10-15T06:30:00Z", jobTitle: "Backend Engineer",
  candidate: { applicantId: id, name: `Test Candidate ${id}`, email: "", phone: "" },
});
const tracker = (reason: string): Tracker => ({
  stages: {}, milestones: {}, total: 1, positions: { total: 1, filled: 0 }, interviews: [],
  timeline: [{ historyId: "event", toStage: "ROUND1_SCHEDULED", transitionAt: "2026-10-15T06:30:00Z", actorName: "Test Recruiter", reason }],
});
beforeEach(() => vi.mocked(recruitmentRequest).mockReset());

describe("Candidate roadmap page", () => {
  it("loads the selected application and shows its history in IST", async () => {
    let resolve!: (value: Tracker) => void;
    vi.mocked(recruitmentRequest).mockReturnValue(new Promise<Tracker>(done => { resolve = done; }));
    const close = vi.fn();
    render(<CandidateRoadmapPage application={application("app/a")} onClose={close} />);
    const dialog = screen.getByRole("region", { name: "Candidate roadmap" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(within(dialog).getByRole("heading", { name: "Test Candidate app/a" })).toHaveFocus();
    expect(within(dialog).getByRole("heading", { name: "Test Candidate app/a" })).toBeVisible();
    expect(within(dialog).getByRole("status", { name: "Loading candidate roadmap" })).toBeVisible();
    expect(recruitmentRequest).toHaveBeenCalledWith("/tracker?applicationId=app%2Fa", undefined, "GET", expect.any(AbortSignal));
    await act(async () => resolve(tracker("Recruiter approved technical screening")));
    expect(await within(dialog).findByRole("list", { name: "Candidate recruitment history" })).toHaveTextContent("Technical Scheduled");
    expect(dialog).toHaveTextContent("Recruiter approved technical screening");
    expect(dialog).toHaveTextContent("Test Recruiter");
    expect(dialog).toHaveTextContent(/12:00 pm/i);
    expect(dialog).toHaveTextContent("All times in IST");
    fireEvent.click(within(dialog).getByRole("button", { name: "Back to candidates" }));
    expect(close).toHaveBeenCalledOnce();
  });

  it("shows request failures within the page and retries the same candidate", async () => {
    vi.mocked(recruitmentRequest).mockRejectedValueOnce(new Error("Temporary connection failure"))
      .mockResolvedValueOnce({ ...tracker(""), timeline: [] });
    render(<CandidateRoadmapPage application={application()} onClose={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Temporary connection failure");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("No stage history recorded yet for this candidate.")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(recruitmentRequest).toHaveBeenCalledTimes(2);
    expect(vi.mocked(recruitmentRequest).mock.calls.every(([path]) => path === "/tracker?applicationId=app-a")).toBe(true);
  });

  it("shows managerial feedback once with HR clearly marked as the next step", async () => {
    const event = { historyId: "review", fromStage: "ROUND2_SCHEDULED", toStage: "ROUND2_REVIEW_PENDING", transitionAt: "2026-10-16T07:30:00Z", actorUserId: "manager", actorName: "Test Manager", reason: "Managerial feedback supports the next round" };
    vi.mocked(recruitmentRequest).mockResolvedValue({ ...tracker(""), timeline: [event, { ...event, historyId: "handoff", fromStage: "ROUND2_REVIEW_PENDING", toStage: "HR_ROUND" }] });
    render(<CandidateRoadmapPage application={application()} onClose={vi.fn()} />);
    expect(await screen.findByText("Managerial review completed")).toBeVisible();
    expect(screen.getByText("Next step: Ready for HR interview assignment")).toBeVisible();
    expect(screen.getAllByText(event.reason)).toHaveLength(1);
    expect(screen.queryByText("Hr Round")).not.toBeInTheDocument();
  });

  it("cancels old requests and never displays another application's history", async () => {
    let resolveOld!: (value: Tracker) => void;
    vi.mocked(recruitmentRequest).mockReturnValueOnce(new Promise<Tracker>(done => { resolveOld = done; }))
      .mockResolvedValueOnce(tracker("Second application history"));
    const { rerender, unmount } = render(<CandidateRoadmapPage application={application()} onClose={vi.fn()} />);
    const oldSignal = vi.mocked(recruitmentRequest).mock.calls[0][3]!;
    rerender(<CandidateRoadmapPage application={application("app-b")} onClose={vi.fn()} />);
    expect(oldSignal.aborted).toBe(true);
    expect(await screen.findByText("Second application history")).toBeVisible();
    await act(async () => resolveOld(tracker("Old application history")));
    expect(screen.queryByText("Old application history")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Test Candidate app-b" })).toBeVisible();
    const latestSignal = vi.mocked(recruitmentRequest).mock.calls[1][3]!;
    unmount();
    await waitFor(() => expect(latestSignal.aborted).toBe(true));
  });
});

it('shows the projected profile and links to the existing review without adding a modal',async()=>{
  vi.mocked(recruitmentRequest).mockResolvedValue(tracker('Authorized HR history'));
  const onReview=vi.fn();
  const person=application();
  person.candidate={...person.candidate,currentDesignation:'Engineer',skills:['Python'],education:['B.Tech'],email:'s***@example.test',experienceYears:0};
  person.assessment={score:0};
  render(<CandidateRoadmapPage application={person} onClose={vi.fn()} onOpenReview={onReview}/>);
  expect(screen.getByRole('region',{name:'Candidate profile'})).toHaveTextContent('Engineer');
  expect(screen.getByRole('region',{name:'Candidate profile'})).toHaveTextContent('0 years');
  expect(screen.getByRole('region',{name:'Candidate profile'})).toHaveTextContent('0%');
  expect(screen.getByText('B.Tech')).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'View interview & review'}));
  expect(onReview).toHaveBeenCalledOnce();
});
