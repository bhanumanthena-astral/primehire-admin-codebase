import type {Application} from './recruitmentApi';

export function assessmentState(row:Application){return (row.assessment?.status||'').toLowerCase().replaceAll(' ','_');}
export function assessmentStatusLabel(row:Application){
  const state=assessmentState(row);
  const labels:Record<string,string>={send_requested:'Generating link',upstream_pending:'Generating link',link_created:'Link ready',
    email_queued:'Invitation queued',email_sent:'Invitation sent',in_progress:'In progress',report_pending:'Report pending',completed:'Completed',failed:'Failed'};
  return labels[state]||row.assessment?.status?.replaceAll('_',' ')||'Not invited';
}
export function assessmentScoreLabel(row:Application):string|number{
  if(row.assessment?.score!=null)return row.assessment.score;
  const state=assessmentState(row);
  if(state==='in_progress')return 'In progress';
  if(['report_pending','submitted','completed','assessment_submitted'].includes(state)||row.currentStage==='ASSESSMENT_COMPLETED')return 'Pending';
  if(['send_requested','upstream_pending'].includes(state))return 'Generating link';
  return 'Not attempted';
}
export function assessmentNeedsRefresh(row:Application){
  return row.assessment?.score==null&&['send_requested','upstream_pending','link_created','email_queued','email_sent','in_progress','report_pending','submitted','assessment_submitted'].includes(assessmentState(row));
}
