import React, {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Modal} from '../ui/Modal';
import {assessmentRequest, assessmentInputDate, assessmentFormDate, ManagedAssessment} from '../../lib/assessmentManagementApi';

export function AssessmentDatesDialog({assessment,onClose,onSaved}:{assessment:ManagedAssessment;onClose:()=>void;onSaved:(row:ManagedAssessment)=>void}) {
  const [start,setStart]=useState(assessmentInputDate(assessment.startDate));
  const [end,setEnd]=useState(assessmentInputDate(assessment.endDate));
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  async function save(event:React.FormEvent) {
    event.preventDefault();setError('');
    if (!start||!end||Date.parse(assessmentFormDate(end))<=Date.now()||end<=start) {
      setError('Choose a future deadline later than the start date.');return;
    }
    setBusy(true);
    try {
      const row=await assessmentRequest<ManagedAssessment>(`/${encodeURIComponent(assessment.id)}/dates`,{
        expectedRevision:assessment.revision,startDate:assessmentFormDate(start),endDate:assessmentFormDate(end),
      },'PUT');
      onSaved(row);
    }catch(cause){setError(cause instanceof Error?cause.message:'Could not update assessment dates');}
    finally{setBusy(false);}
  }
  return <Modal label="Edit assessment dates" onClose={onClose} dismissible={!busy}>
    <h2 className="text-xl font-bold">Edit assessment dates</h2>
    <p className="mt-2 text-sm text-muted-foreground">{assessment.jobTitle}. Extend the deadline, including after it has passed. Questions and candidate records are preserved. All times are IST.</p>
    <form onSubmit={save} className="mt-5 space-y-4">
      <label className="block text-sm">Start date (IST)<Input type="datetime-local" required disabled={busy} value={start} onChange={e=>setStart(e.target.value)}/></label>
      <label className="block text-sm">End date (IST)<Input type="datetime-local" required disabled={busy} value={end} onChange={e=>setEnd(e.target.value)}/></label>
      {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>{busy?'Updating…':'Save dates'}</Button></div>
    </form>
  </Modal>;
}
