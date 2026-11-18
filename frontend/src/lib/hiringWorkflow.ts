import {authFetch} from './authFetch';
export async function workflowRequest<T=any>(path:string,body?:unknown,method=body===undefined?'GET':'POST'):Promise<T>{
 const res=await authFetch('/api/hiring-workflow'+path,{method,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
 const data=await res.json();if(!res.ok)throw new Error(typeof data.detail==='string'?data.detail:'Could not complete the hiring action');
 return data;
}
export const SOURCE_LABELS:Record<string,string>={unknown:'Unknown',local:'Manual Resume Upload',linkedin:'LinkedIn',naukri:'Naukri',indeed:'Indeed',wellfound:'Wellfound',career_portal:'Company Career Portal',referral:'Employee Referral',agency:'Agency / External Recruiter',email:'Email',other:'Other'};
export const sourceLabel=(value?:string)=>SOURCE_LABELS[value||'unknown']||'Unknown';
export type HiringTemplate={id:string;name:string;category:'rejection'|'candidate_reminder'|'company_reminder'|'report_share';subject:string;body:string};
export type HiringPreferences={revision:number;templates:HiringTemplate[];defaultRejectionId:string|null};
export type Trait={id:string;name:string;description:string;active:boolean};
export type TraitConfiguration={revision:number;traits:Trait[]};
export function templatePreview(value:string,fields:Record<string,string>={}):string{
 const samples:Record<string,string>={
  candidate_name:'Example candidate',job_title:'Example opening',company:'Your company',company_name:'Your company',
  application_reference:'Example application',hr_contact:'Your HR team',report_summary:'Technical and Managerial report summaries',
  round_type:'Technical',start_time:'Selected interview time',end_time:'Selected interview end time',meeting_link:'Selected meeting link',
 };
 return value.replace(/\{\{(\w+)\}\}/g,(token,key)=>fields[key]??samples[key]??token);
}
