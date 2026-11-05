import {useState} from 'react';

export type TeamAvatarRole='hr'|'manager'|'developer'|'admin'|'member';
export function avatarRole(role:string):TeamAvatarRole {
  return ['admin','super_admin'].includes(role)?'admin':role==='hr'?'hr':role.includes('manager')?'manager':['technical_interviewer','developer'].includes(role)?'developer':'member';
}
export function teamRoleLabel(role:string):string {
  return ({hr:'HR professional',recruiter:'Recruiter',technical_interviewer:'Developer',managerial_interviewer:'Manager',admin:'Admin',super_admin:'Super Admin',viewer:'Read-only user'} as Record<string,string>)[role]||role.replaceAll('_',' ');
}
const assets:Record<TeamAvatarRole,string>={hr:'/images/team/hr-static.png',manager:'/images/team/admin-male-static.png',developer:'/images/team/developer-static.png',admin:'/images/team/admin-male-static.png',member:'/images/team/manager-static.png'};
const BHANU_ACCOUNT_ID='4b9e2e41-c708-40c3-8aeb-361c5cbd91df';

/** Static artwork only: no canvas, renderer, animation loop or remote model. */
export function StaticTeamAvatar({role='member',accountId,className='',portrait=false}:{role?:TeamAvatarRole;accountId?:string;className?:string;portrait?:boolean}) {
  const [failed,setFailed]=useState(false);
  const label=role==='hr'?'HR professional':role==='manager'?'Manager':role==='developer'?'Developer':role==='member'?'Team member':'Administrator';
  const source=role==='admin'&&accountId===BHANU_ACCOUNT_ID?'/images/team/bhanu-static.png':assets[role];
  return <div className={`team-avatar ${portrait?'team-avatar-portrait':''} ${className}`}>
    {failed?<span className="team-avatar-fallback" role="img" aria-label={`${label} illustration`}>{role==='hr'?'HR':role==='manager'?'M':role==='developer'?'D':'A'}</span>:<img src={source} alt={`${label} illustration`} decoding="async" onError={()=>setFailed(true)}/>}
  </div>;
}
