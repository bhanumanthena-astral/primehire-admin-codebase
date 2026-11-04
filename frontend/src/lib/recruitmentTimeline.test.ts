import { describe, expect, it } from "vitest";
import { roadmapEvents } from "./recruitmentTimeline";

const review = { historyId: "manager-review", fromStage: "ROUND2_SCHEDULED", toStage: "ROUND2_REVIEW_PENDING",
  transitionAt: "2026-10-16T07:30:00Z", actorUserId: "manager", actorName: "Test Manager", reason: "Evidence supports progression" };
const handoff = { ...review, historyId: "handoff", fromStage: "ROUND2_REVIEW_PENDING", toStage: "HR_ROUND",
  transitionAt: "2026-10-16T07:30:01Z" };

describe("Roadmap review and handoff presentation", () => {
  it("shows managerial completion once and labels HR as the next step", () => {
    const events = [review, handoff];
    const result = roadmapEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ title: "Managerial review completed", nextStep: "Ready for HR interview assignment", actorName: "Test Manager", reason: review.reason });
    expect(events).toEqual([review, handoff]);
  });
  it("keeps separate actors or separate reasons as distinct events", () => {
    expect(roadmapEvents([review, { ...handoff, actorUserId: "hr" }])).toHaveLength(2);
    expect(roadmapEvents([review, { ...handoff, reason: "Another decision" }])).toHaveLength(2);
  });
  it("never presents a general HR-stage transition as a completed HR interview", () => {
    expect(roadmapEvents([{ ...handoff, fromStage: "ON_HOLD" }])[0].title).toBe("Moved to HR stage");
    expect(roadmapEvents([{ ...review, toStage: "ROUND1_REVIEW_PENDING" },
      { ...handoff, fromStage: "ROUND1_REVIEW_PENDING", toStage: "ROUND2_PENDING_ASSIGNMENT" }])[0])
      .toMatchObject({ title: "Technical review completed", nextStep: "Ready for managerial interview assignment" });
  });
});
