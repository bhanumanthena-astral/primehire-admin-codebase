import {authFetch} from './authFetch';

export interface LeadershipTiming {
  key:string; label:string; samples:number; eligible:number; withoutDuration:number;
  medianHours:number|null; p90Hours:number|null; buckets:number[]; waiting:number; overdue:number;
}
export interface LeadershipRole {
  jobId:string; title:string; department:string; status:string; positions:number; daysOpen:number|null;
  resumesUploaded:number; atsScored:number; atsProcessing:number; linksGenerated:number; linksSent:number;
  assessmentsCompleted:number; technical:number; managerial:number; hr:number; hrWaiting:number; hrOverdue:number;
  stages:Record<string,number>;
}
export interface LeadershipData {
  generatedAt:string; days:number; windowStart:string; timezone:string; selectedJobId:string|null;
  jobOptions:{jobId:string;title:string}[];
  summary:Record<string,number>;
  stages:{key:string;label:string;count:number}[];
  roles:LeadershipRole[];
  trend:{date:string;resumes:number;assessments:number}[];
  timing:LeadershipTiming[];
  aging:{key:string;label:string;under24:number;days1to3:number;over72:number;unknown:number}[];
  quality:{limited:boolean;applicationsAnalyzed:number;notes:string[]};
}
export async function loadLeadership(days:number,jobId:string,signal:AbortSignal):Promise<LeadershipData> {
  const query=new URLSearchParams({days:String(days)});
  if(jobId)query.set('jobId',jobId);
  const response=await authFetch(`/api/leadership/dashboard?${query}`,{signal});
  if(!response.ok)throw new Error(response.status===403?'Your account does not have leadership access.':'Could not load hiring intelligence. Please retry.');
  return response.json();
}
