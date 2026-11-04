import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {googleRequest} from '../../lib/googleApi';
import {Interview} from '../../lib/recruitmentApi';

export function InterviewCalendarStatus({interview,onChanged}:{interview:Interview;onChanged:()=>void}){
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  if(!interview.googleCalendarStatus)return null;
  const status=interview.googleCalendarStatus;
  const label=status==='synced'?'Google Calendar event and reminder added.':status==='removed'?'Google Calendar event removed.':status==='not_connected'?'Interview scheduled without Google Calendar. The interviewer can connect their account later.':status==='not_configured'?'Google Calendar is not configured. No Google reminder was created.':status==='conflict'?'Google Calendar meeting conflict. Reschedule this interview.':status==='needs_attention'?'Google Calendar needs attention.':'Google Calendar sync pending.';
  async function retry(){setBusy(true);setError('');try{
    await googleRequest(`/interviews/${encodeURIComponent(interview.interviewId)}/retry`,{});onChanged();
  }catch(cause){setError(cause instanceof Error?cause.message:'Calendar sync failed');}finally{setBusy(false);}}
  return <section aria-label="Interview Google Calendar status" className="mt-4 space-y-2 rounded-lg border border-border p-3 text-sm">
    <p role="status">{label}</p>
    {interview.googleCalendarError&&<p className="text-xs text-muted-foreground">{interview.googleCalendarError}</p>}
    {error&&<p role="alert" className="text-destructive">{error}</p>}
    {interview.canManage&&['scheduled','cancelled'].includes(interview.status)&&['pending','needs_attention'].includes(status)&&<Button variant="outline" size="sm" disabled={busy} onClick={()=>void retry()}>{busy?'Syncing…':'Retry calendar sync'}</Button>}
  </section>;
}
