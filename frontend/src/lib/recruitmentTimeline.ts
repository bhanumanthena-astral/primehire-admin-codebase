import { stageLabel } from "./recruitmentApi";

export type RoadmapEvent = {
  historyId?: string; fromStage?: string; toStage: string; transitionAt?: string;
  actorName?: string; actorUserId?: string; reason?: string;
};
export type RoadmapDisplayEvent = RoadmapEvent & { title: string; nextStep?: string };

const nextStep = (stage: string) => ({
  ROUND2_PENDING_ASSIGNMENT: "Ready for managerial interview assignment",
  HR_ROUND: "Ready for HR interview assignment",
  OFFER: "Ready for offer review",
  REJECTION_PENDING_HR_REVIEW: "Awaiting HR rejection review",
  ON_HOLD: "On hold",
}[stage] || stageLabel(stage));

/** Present the review journal's two stage writes as one review and its handoff.
 * The stored history is unchanged; unrelated events are never combined. */
export function roadmapEvents(events: RoadmapEvent[]): RoadmapDisplayEvent[] {
  const result: RoadmapDisplayEvent[] = [];
  for (let index = 0; index < events.length; index++) {
    const event = events[index];
    const round = event.toStage === "ROUND1_REVIEW_PENDING" ? "Technical"
      : event.toStage === "ROUND2_REVIEW_PENDING" ? "Managerial" : null;
    const next = events[index + 1];
    const difference = next ? Date.parse(next.transitionAt || "") - Date.parse(event.transitionAt || "") : NaN;
    const handoff = round && next && next.fromStage === event.toStage &&
      next.actorUserId === event.actorUserId && next.reason === event.reason &&
      difference >= 0 && difference <= 5000;
    if (handoff) {
      result.push({ ...event, toStage: next.toStage, title: `${round} review completed`, nextStep: nextStep(next.toStage) });
      index++;
    } else if (event.toStage === "HR_ROUND" && event.fromStage?.startsWith("ROUND2_")) {
      result.push({ ...event, title: "Managerial review completed", nextStep: nextStep(event.toStage) });
    } else {
      result.push({ ...event, title: round ? `${round} review recorded`
        : event.toStage === "HR_ROUND" ? "Moved to HR stage" : stageLabel(event.toStage) });
    }
  }
  return result;
}
