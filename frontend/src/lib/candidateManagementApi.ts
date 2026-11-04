import {authFetch} from './authFetch';

const base=((import.meta as any).env?.VITE_API_URL||'').replace(/\/$/,'')+'/api/candidate-management';
export type Page<T>={items:T[];total:number};
export type Education={qualification:string;specialization:string;institution:string;graduationYear:number|null};
export type Profile={name:string;email:string;phone:string;currentLocation?:string;preferredLocations?:string[];experienceYears?:number|null;
  currentCompany?:string;currentDesignation?:string;department?:string;role?:string;industry?:string;skills?:string[];headline?:string;summary?:string;educationRecords?:Education[];education?:string[]};
export type Application={applicationId:string;jobId:string;jobTitle?:string;stage?:string;applicationDate?:string};
export type Person={candidateId:string;profile:Profile;revision:number;canManage:boolean;createdAt?:string;updatedAt?:string};
export type PersonRow=Person&{applicationDate?:string;applications:Application[];applicationCount:number;assessmentStatuses:string[]};
export type Assignment={assignmentId:string;candidateId:string;assessmentId:string;assessmentTitle:string;applicationId?:string;jobId?:string;startDate:string;endDate:string;
  status:string;linkStatus:string;revision:number;createdAt:string;canEditDates:boolean;canGenerate:boolean;inviteLink?:string;accessCode?:string;error?:string};
export type AvailableAssessment={assessmentId:string;title:string;roundType:string;language:string;startDate?:string;endDate?:string;questionCount:number};
export class CandidateManagementError extends Error {
  constructor(message:string,public status:number,public fields:Record<string,string>={}){super(message);}
}
export async function candidateRequest<T>(path='',body?:unknown,method='POST',signal?:AbortSignal):Promise<T>{
  const response=await authFetch(base+path,{method:body===undefined?'GET':method,signal,
    ...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
  if(!response.ok){let detail:any;try{detail=(await response.json()).detail;}catch{}
    const fields:Record<string,string>={};if(Array.isArray(detail))detail.forEach((v:any)=>{fields[(v.loc||[]).filter((s:string)=>s!=='body'&&s!=='profile').join('.')]=v.msg;});
    throw new CandidateManagementError(typeof detail==='string'?detail:Object.values(fields).join('; ')||'Candidate request failed. Please retry.',response.status,fields);}
  return response.json();
}
const utcDate=(value:string|Date)=>new Date(typeof value==='string'&&/^\d{4}-\d\d-\d\dT/.test(value)&&!/(Z|[+-]\d\d:\d\d)$/i.test(value)?value+'Z':value);
export const candidateTime=(value?:string)=>value&&!Number.isNaN(utcDate(value).getTime())?new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'}).format(utcDate(value))+' IST':'Not available';
export function inputIST(value:string|Date){const date=utcDate(value);return new Date(date.getTime()+330*60000).toISOString().slice(0,16);}
export function isoIST(value:string){return new Date(value+':00+05:30').toISOString();}
export async function downloadCandidateResume(key:string){
  const response=await authFetch(base+'/'+encodeURIComponent(key)+'/resume');
  if(!response.ok){let message='Resume download failed';try{message=(await response.json()).detail||message;}catch{}throw new Error(message);}
  const disposition=response.headers.get('content-disposition')||'';
  let filename=/filename="([^"]+)"/i.exec(disposition)?.[1]||'candidate-resume';
  const encoded=/filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  if(encoded){try{filename=decodeURIComponent(encoded);}catch{/* Use the safe fallback filename. */}}
  filename=filename.split(/[\\/]/).pop()?.replace(/[\u0000-\u001f]/g,'')||'candidate-resume';
  const url=URL.createObjectURL(await response.blob());const anchor=document.createElement('a');anchor.href=url;anchor.download=filename;anchor.click();URL.revokeObjectURL(url);
}
