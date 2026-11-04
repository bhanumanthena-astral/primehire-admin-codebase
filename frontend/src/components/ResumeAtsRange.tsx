import {useEffect, useState} from 'react';
import {Slider} from '@/components/ui/slider';
import {Input} from '@/components/ui/input';
import {SlidersHorizontal, Loader2} from 'lucide-react';
import {IntakeBatch, intakeMutate} from '../lib/resumeIntakeApi';
import {PAButton} from './ui/primitives';

export function ResumeAtsRange({batch, onSaved}: {batch: IntakeBatch; onSaved: () => void}) {
  const [values, setValues] = useState([batch.atsRange?.minimum ?? 60, batch.atsRange?.maximum ?? 100]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setValues([batch.atsRange?.minimum ?? 60, batch.atsRange?.maximum ?? 100]);
    setError('');
  }, [batch.batchId, batch.atsRangeRevision]);
  const changed = !batch.atsRange || values[0] !== batch.atsRange.minimum || values[1] !== batch.atsRange.maximum;
  const allowed = batch.canSetAtsRange === true;
  async function save() {
    setBusy(true); setError('');
    try {
      await intakeMutate(`/batches/${batch.batchId}/ats-range`, {minimum: values[0], maximum: values[1], expectedRevision: batch.atsRangeRevision ?? 0}, 'PUT');
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save the ATS range.'); }
    finally { setBusy(false); }
  }
  return <section aria-label="ATS score range" className="m-5 rounded-2xl border border-primary/30 bg-primary/5 p-5 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div>
      <h3 className="flex items-center gap-2 text-base font-bold"><SlidersHorizontal size={18} className="text-primary"/>{batch.atsRange ? 'ATS range for this upload' : 'Choose your ATS range'}</h3>
      <p className="mt-2 max-w-2xl text-xs leading-relaxed text-muted-foreground">Set the scores you want to consider before creating candidates. Both endpoints are included. You can lower the minimum to 50% or any score from 0 to 100.</p>
    </div><output aria-live="polite" className="rounded-xl border border-primary/30 bg-card px-4 py-2 text-xl font-bold tabular-nums">{values[0]}–{values[1]}<span className="ml-1 text-sm text-muted-foreground">%</span></output></div>
    <Slider className="my-5" value={values} min={0} max={100} step={1} minStepsBetweenValues={0}
      disabled={busy || !allowed} onValueChange={setValues} getAriaLabel={index => index === 0 ? 'Minimum ATS score' : 'Maximum ATS score'} getAriaValueText={(_, value) => `${value}%`}/>
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1.5 text-xs font-semibold">Minimum (%)<Input aria-label="Minimum ATS percentage" type="number" min={0} max={values[1]} step={1} value={values[0]} disabled={busy || !allowed} className="w-28 bg-card" onChange={e => {if(e.target.value !== '')setValues([Math.max(0,Math.min(values[1],Math.round(Number(e.target.value)))), values[1]]);}}/></label>
      <label className="flex flex-col gap-1.5 text-xs font-semibold">Maximum (%)<Input aria-label="Maximum ATS percentage" type="number" min={values[0]} max={100} step={1} value={values[1]} disabled={busy || !allowed} className="w-28 bg-card" onChange={e => {if(e.target.value !== '')setValues([values[0],Math.min(100,Math.max(values[0],Math.round(Number(e.target.value))))]);}}/></label>
      {allowed && <PAButton disabled={busy || !changed || batch.bulkApprovalRunning} onClick={() => void save()}>{busy && <Loader2 size={14} className="animate-spin"/>}{batch.atsRange ? 'Apply ATS range' : 'Save range & score resumes'}</PAButton>}
    </div>
    {error && <p role="alert" className="mt-3 text-xs text-destructive">{error}</p>}
    {!allowed && <p className="mt-3 text-xs text-muted-foreground">The uploader or an administrator can set this batch’s ATS range.</p>}
    <p role="status" className="mt-4 text-xs leading-relaxed text-muted-foreground">{batch.atsRange ? `Saved range: ${batch.atsRange.minimum}–${batch.atsRange.maximum}%. ${batch.atsStats?.within ?? 0} eligible · ${batch.atsStats?.below ?? 0} below · ${batch.atsStats?.above ?? 0} above · ${batch.atsStats?.pending ?? 0} awaiting a current score.` : 'Save a range to start ATS scoring. Candidate profiles are created only after your confirmation.'}</p>
    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Resumes outside the range stay visible below. Adjust the range whenever you need to reconsider them. Existing candidate profiles are kept.</p>
  </section>;
}
