/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { JobId, LocalCandidateId, VerifiedCandidateUUID, InterviewId, ResponseId } from './lib/primehireIds';

export type RoundType = 'TECHNICAL' | 'BASIC' | 'HR';
export type QuestionType = 'SPEAK_TO_ANSWER' | 'MCQ';
export type CandidateStatus = 'ACTIVE' | 'INACTIVE';
export type ReportStatus = 'GENERATING' | 'GENERATED' | 'FAILED';

export interface Question {
  id: string;
  text: string;
  type: QuestionType;
  maxDuration: number; // in seconds
  // Conditional fields
  referenceAnswer?: string; // TECHNICAL + SPEAK_TO_ANSWER
  criteria?: string;        // BASIC + SPEAK_TO_ANSWER
  options?: string[];       // MCQ options
  correctOption?: string;   // MCQ correct option
  // Scoring fields (TECHNICAL and BASIC only)
  maxScore?: number;
  weightage?: number;
}

export interface AssessmentProfile {
  id: string;
  jobId: JobId;
  jobTitle: string;
  jobDescription: string;
  language: string;
  roundType: RoundType;
  questions: Question[];
  isActive: boolean;
  createdAt: string; // ISO 8601
  deactivatedAt: string | null; // ISO 8601
  startDate?: string; // ISO 8601 — assessment schedule window start
  endDate?: string;   // ISO 8601 — assessment schedule window end
  mongoId?: string;   // MongoDB ObjectId (Phase 3C read cutover); never replaces id/jobId
}

export interface Candidate {
  id: LocalCandidateId;
  assessmentId: string; // Refers to AssessmentProfile
  name: string;
  email: string;
  phone: string;
  startTime: string; // ISO 8601
  endTime: string;   // ISO 8601
  link: string | null;
  password: string | null;
  assignedDate: string | null;
  submittedDate: string | null;
  status: CandidateStatus;
  reportStatus: ReportStatus | null;
  lastInviteSentAt?: string; // For tracking resend behavior and invite-sent state
  answers?: Record<string, string>; // questionId -> candidate's answer text or selected MCQ option
  simulatedReport?: {
    overallScore: number;
    strengths: string[];
    weaknesses: string[];
    answersFeedback: Array<{
      questionId: string;
      score: number;
      maxScore: number;
      feedback: string;
    }>;
  };
  
  // Custom Recruiter Mailing State Fields
  interviewId?: InterviewId | null;
  responseId?: ResponseId | null;
  verifiedCandidateUUID?: VerifiedCandidateUUID | null;
  linkGenerated?: boolean;
  linkValue?: string | null;
  candidateStatus?: CandidateStatus;
  assessmentStatus?: string; // 'NOT_STARTED' | 'COMPLETED' | etc.
  inviteSent?: boolean;
  inviteSentAt?: string | null;
  lastReminderSentAt?: string | null;
  reminderCount?: number;
  interviewExpired?: boolean;
  rowLoading?: boolean;
  mailStatus?: 'Not Sent' | 'Invite Sent' | 'Reminder Sent' | 'Failed' | 'Sending';
  mongoId?: string;   // MongoDB ObjectId (Phase 3C read cutover); never replaces id/candidateKey
}

export interface MailTemplate {
  id: string;
  name: string;
  type: 'STANDARD_INVITATION' | 'REMINDER' | 'CUSTOM';
  subject: string;
  body: string;
}

