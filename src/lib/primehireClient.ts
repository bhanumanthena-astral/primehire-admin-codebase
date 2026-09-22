import { AssessmentProfile, Candidate, Question } from '../types';
import { JobId, LocalCandidateId, VerifiedCandidateUUID, InterviewId, ResponseId, PASSWORD_RESET_ENABLED, generate32BitId } from './primehireIds';

/**
 * PrimeHire v1 API Client Module
 * All calls are proxied through local Express server under "/api/primehire/*" 
 * to secure sensitive credentials.
 */

// Helper to convert snake_case to camelCase
function keysToCamel(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(v => keysToCamel(v));
  } else if (obj !== null && obj !== undefined && obj.constructor === Object) {
    return Object.keys(obj).reduce((result, key) => {
      const camelKey = key.replace(/_([a-z])/g, (_, g) => g.toUpperCase());
      result[camelKey] = keysToCamel(obj[key]);
      return result;
    }, {} as any);
  }
  return obj;
}

// Helper to convert camelCase to snake_case
function keysToSnake(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(v => keysToSnake(v));
  } else if (obj !== null && obj !== undefined && obj.constructor === Object) {
    return Object.keys(obj).reduce((result, key) => {
      const snakeKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
      result[snakeKey] = keysToSnake(obj[key]);
      return result;
    }, {} as any);
  }
  return obj;
}

async function apiRequest<T = any>(method: string, path: string, body?: any): Promise<T> {
  const url = `/api/primehire${path}`;
  const options: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
  };

  if (body) {
    options.body = JSON.stringify(keysToSnake(body));
  }

  console.log(`[API Client] ${method} ${url}`, body);

  const response = await fetch(url, options);

  // Log response status
  const statusIcon = response.ok ? '✓' : '✗';
  console.log(`[Response Status] ${statusIcon} ${response.status} ${response.statusText}`);

  if (!response.ok) {
    const errorText = await response.text();
    let errorJson: any;
    try {
      errorJson = JSON.parse(errorText);
    } catch {
      errorJson = { error: errorText };
    }
    
    let msg = `Request failed with status ${response.status}`;
    if (typeof errorJson.detail === 'string') {
      msg = errorJson.detail;
    } else if (Array.isArray(errorJson.detail)) {
      msg = errorJson.detail.map((d: any) => d.msg || JSON.stringify(d)).join(', ');
    } else if (errorJson.message) {
      msg = errorJson.message;
    } else if (errorJson.error) {
      msg = errorJson.error;
    } else if (errorJson.details) {
      msg = errorJson.details;
    }

    throw new Error(msg);
  }

  const result = await response.json();
  return keysToCamel(result) as T;
}

// Helper to map frontend AssessmentProfile structure to backend schema.
// The backend uses strict Pydantic validation — only send the exact fields it expects.
// Profile: job_id, job_title, job_description, language, round_type, questions
// Question: question, type, max_duration, answer, max_score, weightage
function mapFrontendProfileToBackend(profile: any): any {
  if (!profile) return profile;
  
  const roundType = profile.roundType || profile.round_type;
  
  const mappedQuestions = Array.isArray(profile.questions) 
    ? profile.questions.map((q: any) => {
      // Sanitize the question ID to be a valid Python identifier (alphanumeric and underscores only)
      let sanitizedId = q.id || '';
      sanitizedId = sanitizedId.replace(/[^a-zA-Z0-9_]/g, '_');
      if (!sanitizedId || /^[0-9]/.test(sanitizedId)) {
        sanitizedId = 'q_' + (sanitizedId || Math.random().toString(36).substring(2, 5));
      }

      // Only include fields the API accepts
      const mapped: any = {
        id: sanitizedId,
        question: q.text || q.question || '',
        type: q.type,
        max_duration: q.maxDuration || q.max_duration || 120,
      };

      // Handle MCQ options and answer mapping
      if (q.type === 'MCQ') {
        if (Array.isArray(q.options)) {
          mapped.options = q.options.map((opt: string, optIdx: number) => ({
            id: `opt_${optIdx + 1}`,
            data: opt
          }));
        }
        
        const correctOpt = q.correctOption || q.correct_option || '';
        if (correctOpt) {
          const optIdx = Array.isArray(q.options) ? q.options.indexOf(correctOpt) : -1;
          if (optIdx !== -1) {
            mapped.answer = `opt_${optIdx + 1}`;
          } else {
            mapped.answer = correctOpt;
          }
        }
      } else {
        // answer (from referenceAnswer or answer or criteria)
        const answer = q.referenceAnswer || q.answer || q.criteria || '';
        if (answer) mapped.answer = answer;
      }

      // max_score and weightage: only TECHNICAL and BASIC rounds accept these scoring fields.
      // Strip them out for HR round questions to prevent validation/model compilation errors.
      if (roundType !== 'HR') {
        if (q.maxScore !== undefined) mapped.max_score = q.maxScore;
        if (q.max_score !== undefined) mapped.max_score = q.max_score;
        if (q.weightage !== undefined) mapped.weightage = q.weightage;
      }
      
      return mapped;
    })
    : [];

  // Include start_date and end_date if provided
  return {
    job_id: profile.jobId || profile.job_id,
    job_title: profile.jobTitle || profile.job_title,
    job_description: profile.jobDescription || profile.job_description,
    language: profile.language,
    round_type: roundType,
    questions: mappedQuestions,
    start_date: profile.startDate || null,
    end_date: profile.endDate || null
  };
}

// Helper to map backend AssessmentProfile structure back to frontend schema
function mapBackendProfileToFrontend(profile: any): any {
  if (!profile) return profile;
  
  if (Array.isArray(profile)) {
    return profile.map(mapBackendProfileToFrontend);
  }

  const mappedQuestions = Array.isArray(profile.questions)
    ? profile.questions.map((q: any) => {
      const mappedQ = { ...q };
      
      // Rename question -> text
      if ('question' in mappedQ) {
        mappedQ.text = mappedQ.question;
        delete mappedQ.question;
      }
      
      // Rename answer -> referenceAnswer
      if ('answer' in mappedQ) {
        mappedQ.referenceAnswer = mappedQ.answer;
        delete mappedQ.answer;
      }

      // Map options from Option[] to string[]
      if (Array.isArray(mappedQ.options)) {
        mappedQ.options = mappedQ.options.map((opt: any) => 
          opt && typeof opt === 'object' ? (opt.data || opt.id) : opt
        );
      }

      // Map correctOption for MCQ type questions
      if (mappedQ.type === 'MCQ' && mappedQ.referenceAnswer) {
        if (mappedQ.referenceAnswer.startsWith('opt_')) {
          const optIdx = parseInt(mappedQ.referenceAnswer.substring(4), 10) - 1;
          if (Array.isArray(mappedQ.options) && optIdx >= 0 && optIdx < mappedQ.options.length) {
            mappedQ.correctOption = mappedQ.options[optIdx];
          } else {
            mappedQ.correctOption = mappedQ.referenceAnswer;
          }
        } else {
          mappedQ.correctOption = mappedQ.referenceAnswer;
        }
      }
      
      return mappedQ;
    })
    : [];

  return {
    ...profile,
    questions: mappedQuestions,
    startDate: profile.startDate || profile.start_date || undefined,
    endDate: profile.endDate || profile.end_date || undefined
  };
}

export const primehireClient = {
  /**
   * 1. Create Assessment Profile
   * POST /assessment
   * REAL API ENDPOINT: https://api.placement.vils.ai/primehire/api/v1/assessment
   */
  async createAssessment(profile: Omit<AssessmentProfile, 'id' | 'createdAt' | 'deactivatedAt'>): Promise<AssessmentProfile> {
    console.log('[PrimeHire Client] Creating Assessment Profile via Backend API...');
    console.log('[Endpoint] POST /api/primehire/assessment');
    const backendPayload = mapFrontendProfileToBackend(profile);
    const result = await apiRequest<AssessmentProfile>('POST', '/assessment', backendPayload);
    return mapBackendProfileToFrontend(result);
  },

  /**
   * 2. Get All Assessments
   * GET /assessment
   */
  async getAssessments(): Promise<AssessmentProfile[]> {
    const result = await apiRequest<AssessmentProfile[]>('GET', '/assessment');
    return mapBackendProfileToFrontend(result);
  },

  /**
   * 3. Get Single Assessment Detail
   * GET /assessment/{id}
   */
  async getAssessmentDetail(id: string): Promise<AssessmentProfile> {
    const result = await apiRequest<AssessmentProfile>('GET', `/assessment/${id}`);
    return mapBackendProfileToFrontend(result);
  },

  /**
   * 4. Toggle Active Status
   * PUT /assessment/{id}/toggle-active
   */
  async toggleAssessmentActive(id: string): Promise<any> {
    return apiRequest('PUT', `/assessment/${id}/toggle-active`);
  },

  /**
   * 5. Add Candidates to Assessment Profile
   * Candidates are registered locally and synchronized to backend upon link generation (POST /interview).
   */
  async addCandidates(assessmentId: string, candidates: Array<{ name: string; email: string; phone?: string; startTime: string; endTime: string }>): Promise<any[]> {
    console.log(`[PrimeHire Client] Registered ${candidates.length} candidate(s) for assessment ${assessmentId}. Syncing to backend via POST /interview upon scheduling.`);
    return candidates.map(c => ({
      id: 'CAND-' + generate32BitId(),
      assessmentId,
      ...c
    }));
  },

  /**
   * 6. Generate Credentials & Schedule Interview
   * POST /interview
   */
  async createInterview(jobId: JobId, roundType: string, candidates: Array<{ candidate_id: LocalCandidateId; start_time: string; end_time: string }>): Promise<any> {
    return apiRequest('POST', '/interview', {
      job_id: jobId,
      round_type: roundType,
      candidates
    });
  },

  /**
   * 7. Reschedule / Update Candidate Schedule
   * PUT /interview/{interview_id}/reschedule
   */
  async rescheduleInterview(interviewId: InterviewId, startTime: string, endTime: string): Promise<any> {
    return apiRequest('PUT', `/interview/${interviewId}/reschedule`, {
      start_time: startTime,
      end_time: endTime
    });
  },

  /**
   * 8. Fetch Interview Status / Completion check
   * GET /interview/{interview_id}/status
   */
  async getInterviewStatus(interviewId: InterviewId): Promise<any> {
    return apiRequest('GET', `/interview/${interviewId}/status`);
  },

  /**
   * 9. Fetch Evaluation Report
   * GET /interview/{interview_id}/report
   */
  async getInterviewReport(interviewId: InterviewId): Promise<any> {
    return apiRequest('GET', `/interview/${interviewId}/report`);
  },

  /**
   * 10. Regenerate Evaluation Report
   * POST /response/{response_id}/generate-report
   */
  async generateReport(responseId: ResponseId): Promise<any> {
    return apiRequest('POST', `/response/${responseId}/generate-report`);
  },

  /**
   * 11. Retrieve Not Generated Reports list
   * GET /response/report-not-generated
   */
  async getReportsNotGenerated(): Promise<any> {
    return apiRequest('GET', '/response/report-not-generated');
  },

  /**
   * 12. Reset Candidate Password
   * PUT /candidate/{candidate_id}/password?new_password=...
   */
  async resetCandidatePassword(candidateId: VerifiedCandidateUUID, newPassword: string): Promise<any> {
    if (!PASSWORD_RESET_ENABLED) {
      throw new Error('Password reset feature is not yet available.');
    }
    return apiRequest('PUT', `/candidate/${candidateId}/password?new_password=${encodeURIComponent(newPassword)}`);
  }
};
