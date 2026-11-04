import { authFetch } from "./authFetch";
const base = `${((import.meta as any).env?.VITE_API_URL || "").replace(/\/+$/, "")}/api/recruitment`;
export type Round = "technical" | "managerial" | "hr";
export type Person = {
  applicantId: string;
  name: string;
  email: string;
  phone: string;
  skills?: string[];
  experienceYears?: number;
  currentDesignation?: string;
  currentCompany?: string;
  summary?: string;
  education?: string[];
  hasResume?: boolean;
  [key: string]: any;
};
export type Application = {
  atsScore?: number | null;
  applicationId: string;
  applicantId: string;
  jobId: string;
  currentStage: string;
  createdAt: string;
  assessment?: { score?: number; status?: string; completedAt?: string; reportAvailable?: boolean; link?: string; password?: string; passwordUnavailable?: boolean; error?: string };
  candidate: Person;
  jobTitle?: string;
  activeInterview?: Booking | null;
  latestInterview?: Pick<Interview, "interviewId" | "round" | "status"> | null;
};
export type Booking = {
  interviewId:string; round:Round; interviewerId:string; interviewerName:string;
  startsAt:string; endsAt:string; meetingLink?:string; location?:string;
  status:string; revision:number; rescheduleReason?:string;
};
export type Interview = {
  googleCalendarStatus?:string;
  googleCalendarError?:string|null;
  googleCalendarSyncedAt?:string;
  interviewId: string;
  applicationId: string;
  jobId: string;
  round: Round;
  interviewerId: string;
  startsAt: string;
  endsAt: string;
  meetingLink: string;
  location: string;
  status: string;
  revision: number;
  reminderMinutes: number;
  candidate: Person;
  application: Application;
  job: any;
  jobTitle: string;
  canManage: boolean;
  canReview: boolean;
  canReveal: boolean;
  canDownload: boolean;
  canCompensate: boolean;
  previousReviews?: any[];
  review?: any;
  evaluationDraft?: any;
  questions?: any;
  compensation?: any;
  offerStatus?: string;
  emailStatus: any[];
  serverTime?:string;
  scheduleChanges?:{changedAt:string;reason:string;before?:{startsAt?:string;endsAt?:string};after?:{startsAt?:string;endsAt?:string}}[];
};
export type Capabilities = {
  enabled: boolean;
  canManage: boolean;
  canReview: boolean;
  canAdmin: boolean;
  workerReady: boolean;
  emailDryRun: boolean;
  emailTestRestricted?: boolean;
};
export type Page<T> = { items: T[]; total: number };
export type Job = {
  jobId: string;
  title: string;
  positionsTotal?: number;
  positionsFilled?: number;
};
export type Staff = { userId: string; name: string; role: string; googleCalendarConnected?: boolean };
export type Tracker = {
  stages: Record<string, number>;
  milestones: Record<string, number>;
  total: number;
  positions: { total: number; filled: number };
  interviews: any[];
  timeline: any[];
  reviewerSummary?: ReviewerSummary | null;
  schedulingPending?: Partial<Record<Round, number>>;
};
export type ReviewerSummary = {
  assigned: number; today: number; upcoming: number; pendingReview: number;
  completed: number; advanced: number; held: number;
};
export async function recruitmentRequest<T>(
  path: string,
  body?: unknown,
  method = "POST",
  signal?: AbortSignal,
): Promise<T> {
  const response = await authFetch(
    base + path,
    body === undefined
      ? { signal }
      : {
          method,
          signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  if (!response.ok) {
    let detail = `Request failed (${response.status}). Please retry.`;
    try {
      const data = await response.json();
      if (typeof data.detail === "string") detail = data.detail;
      else if (Array.isArray(data.detail))
        detail = data.detail
          .map((e: any) => `${e.loc?.slice(1).join(".")}: ${e.msg}`)
          .join("; ");
    } catch {
      /* status only */
    }
    throw new Error(detail);
  }
  return response.json();
}
export async function recruitmentDownload(path: string, name: string) {
  const response = await authFetch(base + path);
  if (!response.ok)
    throw new Error("Download unavailable. Check access and try again.");
  const url = URL.createObjectURL(await response.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const stageLabel = (value: string) =>
  value
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace("Round1", "Technical")
    .replace("Round2", "Managerial");
export const formatTime = (value: string) =>
  new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
export const dateKey = (value: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
export const STAGES = [
  "RESUME_UPLOADED",
  "PARSED",
  "SHORTLISTED",
  "ASSESSMENT_SENT",
  "ASSESSMENT_COMPLETED",
  "ROUND1_PENDING_ASSIGNMENT",
  "ROUND1_SCHEDULED",
  "ROUND1_REVIEW_PENDING",
  "ROUND2_PENDING_ASSIGNMENT",
  "ROUND2_SCHEDULED",
  "ROUND2_REVIEW_PENDING",
  "HR_ROUND",
  "OFFER",
  "HIRED",
  "REJECTION_PENDING_HR_REVIEW",
  "REJECTED",
  "ON_HOLD",
  "TALENT_POOL",
  "WITHDRAWN",
];
