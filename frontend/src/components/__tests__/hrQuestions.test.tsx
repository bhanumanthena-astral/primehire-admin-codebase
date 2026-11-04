import React from "react";
import {beforeEach, expect, it, vi} from "vitest";
import {fireEvent, render, screen, waitFor} from "@testing-library/react";
import {InterviewDialog} from "../recruitment/InterviewDialog";
import {recruitmentRequest} from "../../lib/recruitmentApi";

vi.mock("../../lib/recruitmentApi", async original => ({
  ...await original<any>(), recruitmentRequest: vi.fn(),
}));

const initial = {
  interviewId: "hr-interview", applicationId: "application", jobId: "job",
  interviewerId: "hr", round: "hr", status: "scheduled", revision: 4,
  startsAt: "2026-10-28T06:30:00Z", endsAt: "2026-10-28T07:30:00Z",
  candidate: {name: "Synthetic Candidate", skills: ["Python"]},
  application: {currentStage: "HR_ROUND"}, job: {jdText: "Collaborate on Python services"},
  jobTitle: "Backend Engineer", canReview: true, canManage: false,
  canReveal: false, canDownload: false, canCompensate: false, emailStatus: [],
} as any;
const unused = {
  revision: 1, note: "Historical suggestions", questions: [{
    questionId: "q1", question: "Explain Python inheritance.", source: "technical",
    asked: false, answer: "", sourceReviewIds: ["earlier-review"],
  }],
};
function open(questions?: any) {
  render(<InterviewDialog initial={{...initial, questions}} onClose={vi.fn()}
    onChanged={vi.fn()} onReschedule={vi.fn()}/>);
  fireEvent.click(screen.getByRole("tab", {name: "HR questions"}));
}
beforeEach(() => {
  vi.mocked(recruitmentRequest).mockReset();
  vi.mocked(recruitmentRequest).mockResolvedValue(initial);
});

it("generates HR questions using the interview revision", async () => {
  open();
  expect(screen.getByRole("heading", {name: "HR questions based on the JD and resume"})).toBeVisible();
  fireEvent.click(screen.getByRole("button", {name: "Generate 10 HR questions"}));
  await waitFor(() => expect(recruitmentRequest).toHaveBeenCalledWith(
    "/interviews/hr-interview/questions", {expectedRevision: 4},
  ));
});

it("replaces unused old suggestions only after confirmation with both revisions", async () => {
  open(unused);
  expect(screen.getByText("Based on: Earlier interview feedback")).toBeVisible();
  fireEvent.click(screen.getByRole("button", {name: "Regenerate HR questions"}));
  expect(recruitmentRequest).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", {name: "Replace unused questions"}));
  await waitFor(() => expect(recruitmentRequest).toHaveBeenCalledWith(
    "/interviews/hr-interview/questions", {
      expectedRevision: 4, regenerate: true, expectedQuestionRevision: 1,
    },
  ));
});

it("protects unsaved candidate answers and question edits", () => {
  open(unused);
  const regenerate = screen.getByRole("button", {name: "Regenerate HR questions"});
  fireEvent.change(screen.getByLabelText("Answer 1"), {target: {value: "Unsaved candidate answer"}});
  expect(regenerate).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Answer 1"), {target: {value: ""}});
  expect(regenerate).toBeEnabled();
  fireEvent.change(screen.getByLabelText("Question 1"), {target: {value: "What motivates your career goals?"}});
  expect(regenerate).toBeDisabled();
  expect(recruitmentRequest).not.toHaveBeenCalled();
});

it("preserves previously saved edits and answers while allowing individual edits", () => {
  open({...unused, revision: 2, questions: [{...unused.questions[0], asked: true, answer: "Saved answer"}]});
  expect(screen.getByRole("button", {name: "Regenerate HR questions"})).toBeDisabled();
  expect(screen.getByLabelText("Answer 1")).toHaveValue("Saved answer");
  expect(screen.getByRole("button", {name: "Save answer"})).toBeEnabled();
});
