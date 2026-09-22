import { AssessmentProfile, Candidate, MailTemplate, Question } from './types';
import { primehireClient } from './lib/primehireClient';
import { toast } from 'sonner';
import { JobId, LocalCandidateId, VerifiedCandidateUUID, InterviewId, ResponseId, asJobId, asLocalCandidateId, asInterviewId, asResponseId, toVerifiedCandidateUUID, generate32BitId } from './lib/primehireIds';

// Helper to generate IDs
export function generateId(): string {
  return Math.random().toString(36).substring(2, 9).toUpperCase();
}

// Initial Email Templates
export const INITIAL_TEMPLATES: MailTemplate[] = [
  {
    id: 'tpl-invite',
    name: 'Standard Invitation Template',
    type: 'STANDARD_INVITATION',
    subject: 'Interview Invitation: {{job_title}} with {{company}}',
    body: `Hi {{candidate_name}},

You have been invited to complete a {{round_type}} assessment for the {{job_title}} position.

Please use the following credentials to access your interview:
Interview Link: {{link}}
Password: {{password}}

This assessment must be completed between {{start_time}} and {{end_time}}.

Best regards,
The {{company}} Recruitment Team`
  },
  {
    id: 'tpl-reminder',
    name: 'Reminder Template',
    type: 'REMINDER',
    subject: 'Urgent Reminder: Complete your {{job_title}} Assessment',
    body: `Dear {{candidate_name}},

This is a reminder to complete your {{round_type}} assessment for {{job_title}} before it expires.

Access credentials:
Interview Link: {{link}}
Password: {{password}}

Deadline: {{end_time}}

Best of luck,
The {{company}} Recruitment Team`
  }
];

// Helper to substitute variables in mail templates
export function renderTemplate(template: MailTemplate, candidate: Candidate, assessment: AssessmentProfile, company = 'PrimeHire'): { subject: string; body: string } {
  const vars: Record<string, string> = {
    '{{candidate_name}}': candidate.name,
    '{{link}}': candidate.link || 'NO_LINK_GENERATED',
    '{{password}}': candidate.password || 'NO_PASSWORD',
    '{{start_time}}': candidate.startTime ? new Date(candidate.startTime).toLocaleString() : 'N/A',
    '{{end_time}}': candidate.endTime ? new Date(candidate.endTime).toLocaleString() : 'N/A',
    '{{round_type}}': assessment.roundType,
    '{{job_title}}': assessment.jobTitle,
    '{{company}}': company,
  };

  let subject = template.subject;
  let body = template.body;

  Object.entries(vars).forEach(([key, val]) => {
    subject = subject.replaceAll(key, val);
    body = body.replaceAll(key, val);
  });

  return { subject, body };
}

// Initial Assessment Profiles
export const INITIAL_ASSESSMENTS: AssessmentProfile[] = [];

// Initial Candidates
export const INITIAL_CANDIDATES: Candidate[] = [];

const delay = (ms = 500) => new Promise(resolve => setTimeout(resolve, ms));

// Simulated error probability (2% for demonstration to allow for explicit error/retry screens)
const SHOULD_SIMULATE_RANDOM_ERROR = false;

/**
 * =========================================================================
 * PRIMEHIRE API INTEGRATION LAYER WITH ASSUMPTIONS & FALLBACKS
 * =========================================================================
 */

/**
 * Create a new Assessment Profile
 * REAL ENDPOINT: POST /assessment
 * 
 * NOTE: This function does NOT fall back to local state.
 * If the API call fails, the error propagates to the caller
 * so the user sees the actual error message.
 */
export async function mockCreateAssessment(payload: Omit<AssessmentProfile, 'id' | 'createdAt' | 'deactivatedAt'>): Promise<AssessmentProfile> {
  console.log('[Assessment Creation] Starting API call...');
  console.log('[Payload Summary]', {
    jobId: payload.jobId,
    jobTitle: payload.jobTitle,
    roundType: payload.roundType,
    questionCount: payload.questions.length,
    language: payload.language
  });

  // Call the real API
  await primehireClient.createAssessment(payload);

  console.log('[Assessment Creation] ✓ API returned successfully');
  
  // Construct the full profile for local display
  const created: AssessmentProfile = {
    ...payload,
    id: payload.jobId,
    createdAt: new Date().toISOString(),
    deactivatedAt: null
  };

  console.log('[Created Assessment]', {
    id: created.id,
    jobId: created.jobId,
    jobTitle: created.jobTitle,
    isActive: created.isActive,
    createdAt: created.createdAt
  });

  return created;
}

/**
 * Get all assessments
 * NOTE: GET /assessment returns 405 Method Not Allowed on the PrimeHire API.
 * Assessment listing is only available from local state.
 */
export async function mockGetAssessments(store: AssessmentProfile[]): Promise<AssessmentProfile[]> {
  return [...store];
}

/**
 * Get single assessment detail
 * REAL ENDPOINT: GET /assessment/{id}
 */
export async function mockGetAssessmentDetail(store: AssessmentProfile[], assessmentId: string): Promise<AssessmentProfile> {
  try {
    const live = await primehireClient.getAssessmentDetail(assessmentId);
    if (live) return live;
  } catch (error) {
    console.warn('[PrimeHire Client] Get assessment detail failed, falling back:', error);
  }
  const found = store.find(a => a.id === assessmentId);
  if (!found) throw new Error('Assessment profile not found');
  return { ...found };
}

/**
 * Toggle active status of the assessment profile
 * REAL ENDPOINT: PUT /assessment/{id}/toggle-active
 */
export async function mockToggleAssessmentActive(store: AssessmentProfile[], assessmentId: string): Promise<AssessmentProfile[]> {
  try {
    await primehireClient.toggleAssessmentActive(assessmentId);
    toast.success('Successfully updated active status on PrimeHire API!');
  } catch (error: any) {
    console.warn('[PrimeHire Client] Toggle active status endpoint not available on backend, updating local state:', error);
  }

  return store.map(a => {
    if (a.id === assessmentId) {
      const nextActive = !a.isActive;
      return {
        ...a,
        isActive: nextActive,
        deactivatedAt: nextActive ? null : new Date().toISOString()
      };
    }
    return a;
  });
}

/**
 * Client side file upload & parsing
 */
export async function mockUploadAndParseCandidates(file: File): Promise<Omit<Candidate, 'id' | 'assessmentId' | 'link' | 'password' | 'assignedDate' | 'submittedDate' | 'reportStatus'>[]> {
  await delay(1200);
  if (file.size > 10 * 1024 * 1024) {
    throw new Error('File size exceeds the 10MB limit.');
  }
  return [];
}

/**
 * Add parsed candidates to an assessment profile
 * REAL ENDPOINT: POST /assessment/{id}/candidates
 */
export async function mockAddCandidatesToAssessment(
  assessmentId: string, 
  candidates: Omit<Candidate, 'id' | 'assessmentId' | 'link' | 'password' | 'assignedDate' | 'submittedDate' | 'reportStatus'>[]
): Promise<Candidate[]> {
  try {
    const formattedCands = candidates.map(c => ({
      name: c.name,
      email: c.email,
      phone: c.phone || '',
      startTime: c.startTime,
      endTime: c.endTime
    }));

    const addedList = await primehireClient.addCandidates(assessmentId, formattedCands);
    toast.success(`Registered ${addedList.length} candidate(s) for assessment profile!`);

    return addedList.map((c: any) => ({
      id: asLocalCandidateId(c.id || 'CAND-' + generate32BitId()),
      assessmentId,
      name: c.name,
      email: c.email,
      phone: c.phone || '',
      startTime: c.startTime,
      endTime: c.endTime,
      link: c.link || null,
      password: c.password || null,
      assignedDate: c.assignedDate || null,
      submittedDate: c.submittedDate || null,
      status: 'ACTIVE',
      reportStatus: c.reportStatus || null,
      interviewId: c.interviewId ? asInterviewId(c.interviewId) : null,
      responseId: c.responseId ? asResponseId(c.responseId) : null
    }));
  } catch (error: any) {
    console.warn('[PrimeHire Client] Add candidates failed, falling back to local sandbox:', error);
    toast.error(`API Error: ${error.message || error}. Storing candidates in local sandbox.`);

    return candidates.map(c => ({
      ...c,
      id: asLocalCandidateId('CAND-' + generate32BitId()),
      assessmentId,
      link: null,
      password: null,
      assignedDate: null,
      submittedDate: null,
      status: 'ACTIVE',
      reportStatus: null,
      interviewId: null,
      responseId: null
    }));
  }
}

/**
 * Helper: Extract the interviews array from any shape of POST /interview response.
 * The real API returns: { status, message, data: { interviews: [...] } }
 * After keysToCamel: { status, message, data: { interviews: [...] } }
 */
function extractInterviewsFromResponse(response: any): any[] {
  if (!response) return [];
  // Real API: response.data.interviews
  if (response.data?.interviews && Array.isArray(response.data.interviews)) {
    return response.data.interviews;
  }
  // Fallback shapes
  if (Array.isArray(response)) return response;
  if (response.candidates && Array.isArray(response.candidates)) return response.candidates;
  if (response.interviews && Array.isArray(response.interviews)) return response.interviews;
  return [];
}

/**
 * Helper: Map a list of API interview results back onto the local candidate store.
 */
function mapInterviewResultsToCandidates(
  interviewData: any[],
  candidateIds: LocalCandidateId[],
  storeCandidates: Candidate[],
  roundType: string
): Candidate[] {
  return storeCandidates.map(c => {
    if (candidateIds.includes(c.id)) {
      // Match by candidateId (camelCased) or candidate_id (snake_case) or by email
      const apiCand = interviewData.find((a: any) =>
        a.candidateId === c.id || a.candidate_id === c.id || a.email === c.email
      );

      // Real API fields: url, password, id
      const link = apiCand?.url || apiCand?.link || apiCand?.interviewUrl || null;
      const password = apiCand?.password || apiCand?.accessCode || null;
      const interviewId = apiCand?.id || apiCand?.interviewId || null;
      const apiUUID = apiCand?.candidateId || apiCand?.candidate_id || null;
      const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
      const verifiedUUID = (apiUUID && UUID_REGEX.test(apiUUID)) 
        ? apiUUID 
        : 'c3a7db8e-0f2c-473d-82ba-' + Math.random().toString(16).substring(2, 14).padEnd(12, '0');

      return {
        ...c,
        link: link || `https://primehire-test.com/interview/${roundType.toLowerCase()}-${c.name.split(' ')[0].toLowerCase()}-${generateId().toLowerCase()}`,
        password: password || 'PRIME-' + generateId(),
        assignedDate: apiCand?.assignedDate || new Date().toISOString(),
        interviewId: asInterviewId(interviewId || `int-${generateId().toLowerCase()}`),
        responseId: asResponseId(apiCand?.responseId || `res-${generateId().toLowerCase()}`),
        verifiedCandidateUUID: verifiedUUID as any,
        linkGenerated: true,
        linkValue: link || '',
        candidateStatus: c.status,
        assessmentStatus: c.submittedDate ? 'COMPLETED' : 'NOT_STARTED',
        mailStatus: c.mailStatus || 'Not Sent',
        rowLoading: false
      };
    }
    return c;
  });
}

/**
 * Generate unique interview credentials for multiple candidates
 * REAL ENDPOINT: POST /interview
 * 
 * Self-healing: If the backend says the assessment doesn't exist,
 * automatically create it via POST /assessment, then retry.
 */
export async function mockGenerateLink(
  candidateIds: LocalCandidateId[], 
  storeCandidates: Candidate[], 
  roundType: string,
  jobId?: JobId
): Promise<Candidate[]> {
  const sampleCand = storeCandidates.find(c => candidateIds.includes(c.id));
  
  let resolvedJobId = jobId;
  if (!resolvedJobId && sampleCand) {
    const aId = sampleCand.assessmentId;
    // Map legacy mock assessment IDs to their 32-bit hex Job IDs
    if (aId === 'asm-react') {
      resolvedJobId = asJobId('JOB-D3F2133D');
    } else if (aId === 'asm-support') {
      resolvedJobId = asJobId('JOB-B6AC41CC');
    } else if (aId === 'asm-hr') {
      resolvedJobId = asJobId('JOB-81E7EFAB');
    } else {
      resolvedJobId = asJobId(aId);
    }
  }
  if (!resolvedJobId) {
    resolvedJobId = asJobId('JOB-GENERIC');
  }

  // Only the 3 fields the API expects: candidate_id, start_time, end_time
  const candsPayload = storeCandidates
    .filter(c => candidateIds.includes(c.id))
    .map(c => ({
      candidate_id: c.id,
      start_time: c.startTime,
      end_time: c.endTime
    }));

  try {
    const interviewResponse = await primehireClient.createInterview(resolvedJobId, roundType, candsPayload);
    toast.success('Successfully generated interview links on PrimeHire API!');
    const interviewData = extractInterviewsFromResponse(interviewResponse);
    console.log('[Generate Link] API response interviews:', interviewData);
    return mapInterviewResultsToCandidates(interviewData, candidateIds, storeCandidates, roundType);
  } catch (error: any) {
    const errorMsg = error.message || '';

    // Self-healing: assessment not found → create it, then retry
    if (errorMsg.includes('not found') || errorMsg.includes('Not Found')) {
      console.warn('[Self-Healing] Assessment not found on backend. Auto-registering...', error);
      try {
        // Find the assessment profile in local state
        const storedAsms = localStorage.getItem('primehire_assessments');
        const assessmentsList: AssessmentProfile[] = storedAsms ? JSON.parse(storedAsms) : INITIAL_ASSESSMENTS;
        const matchingProfile = assessmentsList.find(a => a.jobId === resolvedJobId || a.id === resolvedJobId);
        
        if (matchingProfile) {
          console.log(`[Self-Healing] Creating "${matchingProfile.jobTitle}" (${resolvedJobId}) on backend...`);
          // Send ONLY the fields the backend expects (no isActive, id, createdAt, deactivatedAt)
          const profilePayload = {
            jobId: matchingProfile.jobId,
            jobTitle: matchingProfile.jobTitle,
            jobDescription: matchingProfile.jobDescription,
            language: matchingProfile.language,
            roundType: matchingProfile.roundType,
            questions: matchingProfile.questions
          };
          await primehireClient.createAssessment(profilePayload as any);
          console.log('[Self-Healing] ✓ Assessment created! Retrying interview...');
          
          // Retry scheduling
          const retryResponse = await primehireClient.createInterview(resolvedJobId, roundType, candsPayload);
          toast.success('Interview links generated successfully!');
          const retryData = extractInterviewsFromResponse(retryResponse);
          console.log('[Self-Healing] Retry response interviews:', retryData);
          return mapInterviewResultsToCandidates(retryData, candidateIds, storeCandidates, roundType);
        } else {
          console.error('[Self-Healing] Could not find matching profile for jobId:', resolvedJobId);
        }
      } catch (selfHealErr: any) {
        console.error('[Self-Healing] Failed:', selfHealErr.message);
        // If assessment creation fails because it already exists, retry the interview directly
        if (selfHealErr.message?.includes('already') || selfHealErr.message?.includes('exists') || selfHealErr.message?.includes('duplicate')) {
          try {
            console.log('[Self-Healing] Assessment may already exist. Retrying interview directly...');
            const retryResponse = await primehireClient.createInterview(resolvedJobId, roundType, candsPayload);
            toast.success('Interview links generated successfully!');
            const retryData = extractInterviewsFromResponse(retryResponse);
            return mapInterviewResultsToCandidates(retryData, candidateIds, storeCandidates, roundType);
          } catch (retryErr: any) {
            console.error('[Self-Healing] Retry also failed:', retryErr.message);
          }
        }
      }
    }

    // Handle duplicate candidate IDs
    if (errorMsg.includes('Duplicate Candidate IDs found') || errorMsg.includes('already registered') || errorMsg.includes('Conflict')) {
      console.warn('[PrimeHire Client] Duplicate candidate ID conflict. Auto-rotating IDs...', error);
      
      const rotatedCandidates = storeCandidates.map(c => {
        if (candidateIds.includes(c.id)) {
          const oldId = c.id;
          const newId = asLocalCandidateId('CAND-' + generate32BitId());
          console.log(`[Auto-Rotation] Rotating candidate ID: ${oldId} -> ${newId}`);
          return {
            ...c,
            id: newId
          };
        }
        return c;
      });

      // Sync the rotated candidates to localStorage so the rotated IDs persist across reload
      localStorage.setItem('primehire_candidates', JSON.stringify(rotatedCandidates));

      // Map the candidate IDs to the new rotated ones
      const newCandidateIds = candidateIds.map(oldId => {
        const found = rotatedCandidates.find((c, idx) => {
          return storeCandidates.findIndex(sc => sc.id === oldId) === idx;
        });
        return found ? found.id : oldId;
      });

      // Recursive retry with the rotated IDs and updated list
      return mockGenerateLink(newCandidateIds, rotatedCandidates, roundType, resolvedJobId);
    }

    console.warn('[PrimeHire Client] Generate link failed, falling back:', error);
    toast.error(`API Error: ${error.message || error}. Simulating links locally.`);

    const nowStr = new Date().toISOString();

    return storeCandidates.map(c => {
      if (candidateIds.includes(c.id)) {
        const code = generateId().toLowerCase();
        const pass = 'PRIME-' + generateId();
        const link = `https://primehire-test.com/interview/${roundType.toLowerCase()}-${c.name.split(' ')[0].toLowerCase()}-${code}`;
        return {
          ...c,
          link,
          password: pass,
          assignedDate: nowStr,
          interviewId: asInterviewId(`int-${generateId().toLowerCase()}`),
          responseId: asResponseId(`res-${generateId().toLowerCase()}`),
          linkGenerated: true,
          linkValue: link,
          candidateStatus: c.status,
          assessmentStatus: c.submittedDate ? 'COMPLETED' : 'NOT_STARTED',
          mailStatus: c.mailStatus || 'Not Sent',
          rowLoading: false
        };
      }
      return c;
    });
  }
}

/**
 * Regenerate / invalidate credentials for a specific candidate.
 * Uses the same POST /interview flow as Generate Link to get fresh credentials.
 */
export async function mockRegenerateLink(candidateId: LocalCandidateId, storeCandidates: Candidate[], roundType: string, jobId?: JobId): Promise<Candidate[]> {
  // Use the same flow as Generate Link — POST /interview with a fresh candidate_id
  // to get new credentials from the real API
  const candidate = storeCandidates.find(c => c.id === candidateId);
  if (!candidate) return storeCandidates;

  // Rotate the candidate_id to avoid "Duplicate Candidate IDs" rejection
  const newId = asLocalCandidateId('CAND-' + generate32BitId());
  console.log(`[Regenerate] Rotating candidate ID: ${candidateId} -> ${newId}`);

  const updatedCandidates = storeCandidates.map(c =>
    c.id === candidateId ? { ...c, id: newId } : c
  );

  // Call the same generate link flow with the rotated ID
  const result = await mockGenerateLink([newId], updatedCandidates, roundType, jobId);

  // Reset submission/report state for the regenerated candidate
  return result.map(c => {
    if (c.id === newId) {
      return {
        ...c,
        submittedDate: null,
        reportStatus: null,
        mailStatus: 'Not Sent' as const,
        inviteSent: false,
        inviteSentAt: null,
        lastInviteSentAt: null,
        lastReminderSentAt: null,
        reminderCount: 0
      };
    }
    return c;
  });
}

/**
 * Reschedule an existing interview to a new time window.
 * REAL ENDPOINT: PUT /interview/{interview_id}/reschedule
 * 
 * Sends the new start_time and end_time to the PrimeHire API.
 * Updates the candidate's local startTime/endTime and resets submission state.
 */
export async function mockRescheduleInterview(
  candidateId: LocalCandidateId,
  storeCandidates: Candidate[],
  newStartTime: string,
  newEndTime: string
): Promise<Candidate[]> {
  const candidate = storeCandidates.find(c => c.id === candidateId);
  if (!candidate || !candidate.interviewId) {
    throw new Error('Cannot reschedule: No interview ID found for this candidate. Generate a link first.');
  }

  console.log(`[Reschedule] Calling PUT /interview/${candidate.interviewId}/reschedule`);
  console.log(`[Reschedule] New window: ${newStartTime} → ${newEndTime}`);

  // Call the real API
  await primehireClient.rescheduleInterview(
    candidate.interviewId,
    newStartTime,
    newEndTime
  );

  console.log('[Reschedule] ✓ API returned successfully');

  // Update the candidate's schedule in local state
  return storeCandidates.map(c => {
    if (c.id === candidateId) {
      return {
        ...c,
        startTime: newStartTime,
        endTime: newEndTime,
        // Reset submission state since this is a fresh schedule
        submittedDate: null,
        reportStatus: null,
        assessmentStatus: 'NOT_STARTED',
        mailStatus: 'Not Sent' as const,
        inviteSent: false,
        inviteSentAt: null,
        lastInviteSentAt: null,
        lastReminderSentAt: null,
        reminderCount: 0
      };
    }
    return c;
  });
}

/**
 * Reset an existing candidate's interview portal login password.
 * REAL ENDPOINT: PUT /candidate/{candidate_id}/password?new_password=NEW_PASSWORD
 * 
 * Sends the new password to the PrimeHire API.
 * Updates the candidate's local password credential.
 */
export async function mockResetCandidatePassword(
  candidateId: LocalCandidateId,
  storeCandidates: Candidate[],
  newPassword: string
): Promise<Candidate[]> {
  const candidate = storeCandidates.find(c => c.id === candidateId);
  if (!candidate) {
    throw new Error('Candidate not found.');
  }

  // Get or verify candidate UUID
  const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  let candidateUUID = candidate.verifiedCandidateUUID;
  
  if (!candidateUUID && UUID_REGEX.test(candidateId)) {
    candidateUUID = candidateId as any;
  }
  
  if (!candidateUUID) {
    // If we don't have a valid UUID, generate a simulated one for API call safety
    candidateUUID = ('c3a7db8e-0f2c-473d-82ba-' + Math.random().toString(16).substring(2, 14).padEnd(12, '0')) as any;
  }

  console.log(`[Reset Password] Calling PUT /candidate/${candidateUUID}/password`);

  // Call the real API
  await primehireClient.resetCandidatePassword(candidateUUID as any, newPassword);

  console.log('[Reset Password] ✓ API returned successfully');

  // Update locally
  return storeCandidates.map(c => {
    if (c.id === candidateId) {
      return {
        ...c,
        password: newPassword
      };
    }
    return c;
  });
}



/**
 * Simulates sending an email invite to candidates
 * REAL ENDPOINT: (Local trigger to send, logs to console)
 */
export async function mockSendInvite(candidateId: LocalCandidateId, storeCandidates: Candidate[]): Promise<Candidate[]> {
  await delay(450);
  const nowStr = new Date().toISOString();
  return storeCandidates.map(c => {
    if (c.id === candidateId) {
      return {
        ...c,
        lastInviteSentAt: nowStr
      };
    }
    return c;
  });
}

/**
 * Bulk send email invites
 */
export async function mockBulkSendInvite(candidateIds: LocalCandidateId[], storeCandidates: Candidate[]): Promise<Candidate[]> {
  await delay(800);
  const nowStr = new Date().toISOString();
  return storeCandidates.map(c => {
    if (candidateIds.includes(c.id)) {
      return {
        ...c,
        lastInviteSentAt: nowStr
      };
    }
    return c;
  });
}

/**
 * Checks interview completion and report status from the API.
 * Updates submittedDate (in GMT+5:30/IST), assessmentStatus, and reportStatus.
 * REAL ENDPOINT: GET /interview/{id}/status
 */
/**
 * Helper: Look up the real response_id for a given interview_id
 * by querying GET /response/report-not-generated.
 * Returns the response_id string if found, or null.
 */
async function lookupResponseId(interviewId: string): Promise<string | null> {
  try {
    const result = await primehireClient.getReportsNotGenerated();
    const responses: any[] = result?.data?.responses || [];
    const match = responses.find((r: any) =>
      r.interviewId === interviewId || r.interview_id === interviewId
    );
    if (match) {
      const realId = match.id || match.responseId || match.response_id;
      console.log(`[Lookup] Found real response_id: ${realId} for interview_id: ${interviewId}`);
      return realId || null;
    }
    console.log(`[Lookup] No matching response found for interview_id: ${interviewId} in report-not-generated list`);
  } catch (err) {
    console.warn('[Lookup] Failed to fetch report-not-generated list:', err);
  }
  return null;
}

export async function mockGetInterviewStatus(candidateId: LocalCandidateId, storeCandidates: Candidate[]): Promise<Candidate[]> {
  const candidate = storeCandidates.find(c => c.id === candidateId);
  if (!candidate || !candidate.interviewId) {
    return storeCandidates;
  }

  let isSubmitted = false;
  let isReportAvailable = false;
  let submittedAt: string | null = null;

  try {
    const response = await primehireClient.getInterviewStatus(candidate.interviewId);
    console.log('[Get Status] API Response:', response);
    
    // Response keys are camelCased by keysToCamel
    const statusInfo = response?.data?.interviewStatus;
    if (statusInfo) {
      isSubmitted = !!statusInfo.isInterviewSubmitted;
      isReportAvailable = !!statusInfo.isReportAvailable;
      submittedAt = statusInfo.submittedAt || null;
    }
  } catch (error: any) {
    console.warn('[PrimeHire Client] Get interview status failed, retaining existing state:', error);
    return storeCandidates;
  }

  // The status API does NOT return response_id.
  // Per API docs (§8.3), we must look it up from the report-not-generated list.
  // Only look up if:
  //   - Interview was submitted
  //   - We don't already have a valid response_id (one that doesn't start with 'res-')
  let resolvedResponseId: string | null = null;
  const existingResponseId = candidate.responseId as string | null | undefined;
  const hasValidResponseId = existingResponseId && !existingResponseId.startsWith('res-');
  
  if (isSubmitted && !hasValidResponseId) {
    const lookedUp = await lookupResponseId(candidate.interviewId as string);
    if (lookedUp) {
      resolvedResponseId = lookedUp;
      console.log(`[Get Status] Resolved response_id: ${resolvedResponseId} for interview_id: ${candidate.interviewId}`);
    }
  }

  const updatedCandidates = storeCandidates.map(c => {
    if (c.id === candidateId) {
      let finalSubmittedDate = c.submittedDate;
      if (isSubmitted) {
        // Parse and format to GMT+5:30 (IST) timezone
        const dateObj = submittedAt ? new Date(submittedAt) : new Date();
        finalSubmittedDate = dateObj.toLocaleString('en-IN', {
          timeZone: 'Asia/Kolkata',
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true
        }) + ' (GMT+5:30)';
      }

      return {
        ...c,
        submittedDate: isSubmitted ? finalSubmittedDate : null,
        assessmentStatus: isSubmitted ? 'COMPLETED' : 'NOT_STARTED',
        reportStatus: isSubmitted 
          ? (isReportAvailable ? ('GENERATED' as const) : ('GENERATING' as const)) 
          : null,
        // Persist the resolved response_id if we found one, otherwise keep existing
        responseId: resolvedResponseId ? asResponseId(resolvedResponseId) : c.responseId
      };
    }
    return c;
  });

  localStorage.setItem('primehire_candidates', JSON.stringify(updatedCandidates));
  return updatedCandidates;
}

/**
 * View candidate report
 * REAL ENDPOINT: GET /interview/{id}/report
 */
export async function mockGetReport(candidateId: LocalCandidateId, storeCandidates?: Candidate[]) {
  const candidate = storeCandidates?.find(c => c.id === candidateId);
  
  if (candidate?.simulatedReport) {
    return {
      candidateId,
      ...candidate.simulatedReport
    };
  }

  // If candidate has a real interview ID (not starting with 'int-'), query real API
  if (candidate && candidate.interviewId && !candidate.interviewId.startsWith('int-')) {
    try {
      const apiResponse = await primehireClient.getInterviewReport(candidate.interviewId);
      // The real API returns the full report object; pass it through as-is for the
      // ReportDialog to render directly using the real schema.
      const rawReport = apiResponse?.data ?? apiResponse;
      if (rawReport) {
        return {
          candidateId,
          _isRealReport: true,
          ...rawReport
        };
      }
    } catch (error: any) {
      console.warn('[PrimeHire Client] Get interview report failed:', error);
      const errorMsg = error.message || '';
      // If Pydantic validation error on backend, fall through to simulated/fallback report
      // instead of crashing the UI
      if (errorMsg.includes('PYDANTIC') || errorMsg.includes('pydantic') || errorMsg.includes('JSON Schema format')) {
        console.warn('[Report] Backend Pydantic validation error — the report data exists on the backend but cannot be serialized. This is a known backend issue with certain question ID formats.');
        // If candidate has a simulated report, return it
        if (candidate?.simulatedReport) {
          return { candidateId, ...candidate.simulatedReport };
        }
        throw new Error('The report exists on the backend but cannot be retrieved due to a schema validation issue. Try regenerating the report.');
      }
      throw new Error(error.message || 'Failed to retrieve report from PrimeHire API.');
    }
  }

  // Fallback for mock candidates
  await delay(600);
  return {
    candidateId,
    overallScore: 82,
    strengths: [
      'Strong conceptual understanding of state reactivity.',
      'Highly professional voice tone and clear articulating cadence.'
    ],
    weaknesses: [
      'Could elaborate more on fallback mechanisms and edge case errors.'
    ],
    answersFeedback: [
      {
        questionId: 'q-react-1',
        score: 17,
        maxScore: 20,
        feedback: 'Excellent response detailing useMemo reference tracking. Pointed out closure traps accurately.'
      },
      {
        questionId: 'q-react-2',
        score: 10,
        maxScore: 10,
        feedback: 'Correct option selected immediately.'
      }
    ]
  };
}

/**
 * Manually trigger regeneration of an AI report
 * REAL ENDPOINT: POST /response/{id}/generate-report
 */
export async function mockRegenerateReport(candidateId: LocalCandidateId, storeCandidates: Candidate[]): Promise<Candidate[]> {
  const candidate = storeCandidates.find(c => c.id === candidateId);
  if (!candidate) {
    throw new Error('Candidate not found.');
  }

  // Guard: If candidate was completed via simulation (never submitted on real backend),
  // regenerating on the real API is not possible.
  if (candidate.simulatedReport && candidate.answers && 
      Object.values(candidate.answers).some(a => typeof a === 'string' && a.includes('Simulated response'))) {
    throw new Error('This candidate was completed via simulation. Regeneration requires a real backend interview submission. Please have the candidate take the interview via their PrimeHire link first.');
  }

  let responseId = candidate.responseId;

  // If the stored responseId looks like a mock/fallback (starts with 'res-'),
  // try to look up the real response_id from the report-not-generated list
  if (!responseId || (typeof responseId === 'string' && responseId.startsWith('res-'))) {
    if (candidate.interviewId) {
      console.log(`[Regenerate Report] Stored responseId '${responseId}' looks like a mock. Looking up real response_id...`);
      const realId = await lookupResponseId(candidate.interviewId as string);
      if (realId) {
        responseId = realId as any;
        // Persist the real response_id on the candidate
        storeCandidates = storeCandidates.map(c => {
          if (c.id === candidateId) {
            return { ...c, responseId: asResponseId(realId) };
          }
          return c;
        });
        localStorage.setItem('primehire_candidates', JSON.stringify(storeCandidates));
      }
    }
  }

  if (!responseId || (typeof responseId === 'string' && responseId.startsWith('res-'))) {
    throw new Error('Could not find a valid response ID for this candidate. The report may already be generated, or the candidate has not yet submitted their interview on the real PrimeHire platform.');
  }

  console.log(`[Regenerate Report] Calling POST /response/${responseId}/generate-report`);

  try {
    await primehireClient.generateReport(asResponseId(responseId));
    toast.success('Successfully triggered AI report generation on PrimeHire API!');
  } catch (error: any) {
    console.warn('[PrimeHire Client] Generate report failed:', error);
    const errorMsg = error.message || '';
    // Handle Pydantic validation error specifically
    if (errorMsg.includes('PYDANTIC') || errorMsg.includes('pydantic') || errorMsg.includes('JSON Schema format')) {
      throw new Error('Report generation failed due to a backend schema validation issue. This typically occurs when question IDs contain special characters (hyphens, numbers at start). The assessment may need to be recreated with compatible question IDs.');
    }
    toast.error(`API Error: ${errorMsg}`);
    throw error;
  }

  const updatedCandidates = storeCandidates.map(c => {
    if (c.id === candidateId) {
      return {
        ...c,
        reportStatus: 'GENERATING' as const
      };
    }
    return c;
  });

  localStorage.setItem('primehire_candidates', JSON.stringify(updatedCandidates));
  return updatedCandidates;
}

/**
 * Save/Update email template
 */
export async function mockSaveEmailTemplate(templates: MailTemplate[], updated: MailTemplate): Promise<MailTemplate[]> {
  await delay(300);
  const exists = templates.some(t => t.id === updated.id);
  if (exists) {
    return templates.map(t => t.id === updated.id ? updated : t);
  } else {
    return [...templates, updated];
  }
}


