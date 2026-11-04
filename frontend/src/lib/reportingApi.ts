import {authFetch} from './authFetch';
const base=((import.meta as any).env?.VITE_API_URL||'').replace(/\/$/,'')+'/api/reporting';
export type ReportStatus='Not Started'|'Processing'|'Completed'|'Partial'|'Failed'|'Archived'|'Invalidated';
export type ReportMetadata={reportId:string;candidateId:string;candidateName:string;applicationId:string;jobId:string;jobTitle:string;roundId:string;roundType:string;attemptId:string;version:number;status:ReportStatus;generationStatus:ReportStatus;generatedAt?:string|null;generatedBy?:string;capturedAt?:string;updatedAt?:string;roundCompletedAt?:string|null;generationReason?:string;isCurrent:boolean;isOfficialAttempt:boolean;canView:boolean;syncError?:string};
export type ReportMetric={label:string;value:number|null;grade:string|null;maximum:number|null;applicable:boolean|null};
export type ReportQuestion={reference:string;id:string|null;question:string|null;responseReference?:unknown;correctOptionReference?:unknown;score:number|null;maximum:number|null;status:string|null;transcript:string|null;relevancy:unknown;weightage:number|null;aiAnalysis:string|null;feedback:string|null;strengths:string[];areasForImprovement:string[];recommendations:string[];mediaReference:string|null};
export type AiSummary={status:string|null;strengths:string[];areasForImprovement:string[];recommendations:string[]};
export type ReportContent={schemaSupported:boolean;overview:ReportMetric;feedback:ReportMetric[];skillProfile:ReportMetric[];communication:ReportMetric[];distribution:ReportMetric[];questions:ReportQuestion[];proctoring:Record<string,unknown>|null;aiSummary:AiSummary|null;missingSections:string[]};
export type ReportDetail={metadata:ReportMetadata;versions:ReportMetadata[];content:ReportContent|null;summaryId:string;canExport:boolean;canRefresh:boolean;canManageVersions:boolean;versionCount:number};
export type ReportSummary=ReportMetadata&{summaryId:string;sourceReportId:string;sourceReportVersion:number;sourceRoundId:string;sourceAttemptId:string;summaryStatus:string;summaryGeneratedAt:string;sourceValidity?:string|null;sourceIsCurrent?:boolean;snapshot:Omit<ReportContent,'questions'|'media'|'missingSections'|'distribution'>};
export type ReportCapabilities={enabled:boolean;canRefresh:boolean;canExport:boolean;canManageVersions:boolean;timezone:string};
export type ReportHistory={application:{applicationId:string;currentStage:string};candidate:{applicantId:string;name:string;skills?:string[];education?:string[];currentDesignation?:string;summary?:string};job:{jobId:string;title:string};reports:ReportMetadata[];summaries:ReportSummary[];humanEvaluations:{reviewId:string;round:string;createdAt:string;decision?:string;notes?:string;scorecard?:Record<string,number>}[]};
export type InterviewReportSnapshot={reference:{status:string;reason?:string;sourceReportId?:string;sourceReportVersion?:number};summary:ReportSummary|null;canRefresh:boolean};
export class ReportingError extends Error {constructor(message:string,public status:number){super(message);}}
export async function reportingResponse(path:string,body?:unknown,signal?:AbortSignal){
 const response=await authFetch(base+path,{method:body===undefined?'GET':'POST',signal,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
 if(!response.ok){let detail:any;try{detail=(await response.json()).detail;}catch{}throw new ReportingError(typeof detail==='string'?detail:detail?.message||`Report request failed (${response.status}). Please retry.`,response.status);}
 return response;
}
export async function reportingRequest<T>(path:string,body?:unknown,signal?:AbortSignal):Promise<T>{return (await reportingResponse(path,body,signal)).json();}
export async function exportStoredReport(key:string,version:number){const response=await reportingResponse(`/reports/${encodeURIComponent(key)}/export?version=${version}`);const url=URL.createObjectURL(await response.blob());const anchor=document.createElement('a');anchor.href=url;anchor.download=`report-${key}-v${version}.json`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
