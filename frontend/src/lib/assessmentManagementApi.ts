import { authFetch } from './authFetch';
import { AssessmentProfile, Question } from '../types';

export type ManagedAssessment = AssessmentProfile & {
  revision: number; publicationState: 'draft' | 'publishing' | 'published' | 'uncertain';
  status: string; canEdit: boolean; canPublish: boolean;
  createdBy?: string; updatedBy?: string; createdByName?: string; updatedByName?: string;
  updatedAt?: string; publishError?: string;
};
export type AssessmentCapabilities = { enabled: boolean; canManage: boolean; publishedEditingSupported: boolean };
export type Config = { jobId: string; jobTitle: string; jobDescription: string; language: string; roundType: string;
  startDate: string; endDate: string; questions: Question[] };
export type CsvRow = { row: number; groupId?: string; status: string; errors: { field: string; reason: string }[] };
export type CsvPreview = { previewHash: string; fileErrors: string[]; rows: CsvRow[];
  groups: { groupId: string; status: string; rows: number[]; config: Config | null }[] };
export type ImportSummary = { totalRows: number; totalGroups: number; imported: number; failed: number; duplicates: number;
  rows: CsvRow[]; items: { groupId: string; status: string; reason?: string; assessmentId?: string }[] };

export class AssessmentError extends Error {
  constructor(message: string, public fields: { field: string; reason: string }[] = [], public status = 0) { super(message); }
}
const base = `${((import.meta as any).env?.VITE_API_URL || '').replace(/\/+$/, '')}/api/assessment-management`;
export async function assessmentRequest<T>(path = '', body?: unknown, method = 'POST', signal?: AbortSignal): Promise<T> {
  const response = await authFetch(base + path, { method: body === undefined ? 'GET' : method, signal,
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  if (!response.ok) {
    let detail: any;
    try { detail = (await response.json()).detail; } catch { /* status-only fallback */ }
    const fields = Array.isArray(detail) ? detail.map(error => ({ field: error.loc?.filter((value: any) => !['body', 'config'].includes(value)).join('.'), reason: error.msg })) : [];
    throw new AssessmentError(typeof detail === 'string' ? detail : fields.length ? 'Please correct the highlighted fields.' : `Request failed (${response.status}). Please retry.`, fields, response.status);
  }
  return response.json();
}

export function configFromForm(value: AssessmentProfile | Config): Config {
  const language=(value.language||'').toUpperCase();
  return { jobId: value.jobId, jobTitle: (value.jobTitle||'').trim(), jobDescription: (value.jobDescription||'').trim(),
    language: ({ EN: 'ENGLISH', NL: 'DUTCH' }[language] || language), roundType: value.roundType,
    startDate: value.startDate, endDate: value.endDate,
    questions: (Array.isArray(value.questions)?value.questions:[]).map((question, index) => ({
      id: `q_${index + 1}`, text: (question.text||'').trim(), type: question.type, maxDuration: question.maxDuration,
      referenceAnswer: (value.roundType==='BASIC'&&question.type==='SPEAK_TO_ANSWER'
        ? question.criteria?.trim()||question.referenceAnswer?.trim()
        : question.referenceAnswer?.trim()||question.correctOption?.trim()) || '',
      ...(question.criteria ? { criteria: question.criteria } : {}),
      ...(question.type === 'MCQ' ? { options: question.options, correctOption: question.correctOption } : {}),
      ...(question.maxScore != null ? { maxScore: question.maxScore } : {}), ...(question.weightage != null ? { weightage: question.weightage } : {}),
    })) };
}
export const assessmentInputDate = (iso?: string) => iso && Number.isFinite(Date.parse(iso))
  ? new Date(Date.parse(iso) + 330 * 60000).toISOString().slice(0, 16) : '';
export const assessmentFormDate = (value: string) => value ? new Date(`${value}+05:30`).toISOString() : '';
export const assessmentTime = (value?: string) => value && Number.isFinite(Date.parse(value))
  ? new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) + ' IST' : 'Not available';

export const CSV_HEADERS = ['Job Description','Language Selection','Round Type','Start Date','End Date','Question Type','Max Duration (Seconds)','Max Score','Weightage (%)','Question Prompt / Text','Expected Reference Answer','Job Title','Option A','Option B','Option C','Option D','Correct Answer'];
export function downloadAssessmentTemplate() {
  const year = new Intl.DateTimeFormat('en', {timeZone:'Asia/Kolkata',year:'numeric'}).format(new Date());
  const rows = [CSV_HEADERS,
    ['Build Python services','English','TECHNICAL',`${Number(year)+1}-01-01`,`${Number(year)+1}-01-31`,'SPEAK_TO_ANSWER','120','10','50','Explain a Python dictionary','A dictionary maps unique keys to values','Backend Engineer','','','','',''],
    ['Build Python services','English','TECHNICAL',`${Number(year)+1}-01-01`,`${Number(year)+1}-01-31`,'MCQ','60','10','50','Which structure maps keys to values?','Dictionary','Backend Engineer','List','Dictionary','Tuple','Set','B']];
  const text = rows.map(row => row.map(cell => `"${cell.replaceAll('"','""')}"`).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['\ufeff'+text], {type:'text/csv;charset=utf-8'}));
  const link = document.createElement('a'); link.href=url; link.download='assessment_upload_template.csv'; link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
