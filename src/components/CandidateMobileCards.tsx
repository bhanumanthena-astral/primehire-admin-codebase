import type { ReactNode } from 'react';
import type { Candidate, AssessmentProfile } from '../types';
import { formatUtcAsIst } from '../utils/istSchedule';
import { Pill } from './ui/primitives';

export default function CandidateMobileCards({ candidates, assessments, actions, selectedIds = [], onToggleSelection }: { candidates: Candidate[]; assessments: AssessmentProfile[]; actions: (candidate: Candidate) => ReactNode; selectedIds?: Candidate['id'][]; onToggleSelection?: (id: Candidate['id']) => void }) {
  return <div className="grid gap-3 sm:hidden" aria-label="Candidate details">
    {candidates.length === 0 && <p className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">No candidates match the selected filters.</p>}
    {candidates.map(candidate => {
      const assessment = assessments.find(item => item.id === candidate.assessmentId);
      return <article key={candidate.id} className="min-w-0 rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          {onToggleSelection && <input type="checkbox" aria-label={`Select ${candidate.name}`} checked={selectedIds.includes(candidate.id)} onChange={() => onToggleSelection(candidate.id)} className="mt-1 shrink-0 accent-blue-600" />}
          <div className="min-w-0"><h3 className="text-sm font-semibold break-words">{candidate.name}</h3><p className="text-xs text-muted-foreground break-all">{candidate.email}</p></div>
          <Pill tone={candidate.status === 'ACTIVE' ? 'success' : 'danger'}>{candidate.status === 'ACTIVE' ? 'Active' : 'Inactive'}</Pill>
        </div>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
          <dt className="text-muted-foreground">Candidate ID</dt><dd className="font-mono break-all">{candidate.id}</dd>
          <dt className="text-muted-foreground">Profile</dt><dd className="break-words">{assessment?.jobTitle || 'Unmapped profile'}</dd>
          <dt className="text-muted-foreground">Profile ID</dt><dd className="font-mono break-all">{assessment?.jobId || 'Unavailable'}</dd>
          <dt className="text-muted-foreground">Round</dt><dd>{assessment?.roundType || 'Unavailable'}</dd>
          <dt className="text-muted-foreground">Starts (IST)</dt><dd>{candidate.startTime ? formatUtcAsIst(candidate.startTime) : 'Not scheduled'}</dd>
          <dt className="text-muted-foreground">Ends (IST)</dt><dd>{candidate.endTime ? formatUtcAsIst(candidate.endTime) : 'Not scheduled'}</dd>
          <dt className="text-muted-foreground">Report</dt><dd>{candidate.reportStatus === 'GENERATED' ? 'Evaluated' : candidate.reportStatus === 'GENERATING' ? 'Analyzing' : 'No report'}</dd>
          <dt className="text-muted-foreground">Assigned (IST)</dt><dd>{candidate.assignedDate ? formatUtcAsIst(candidate.assignedDate) : 'Unassigned'}</dd>
          <dt className="text-muted-foreground">Submitted</dt><dd className="break-words">{candidate.submittedDate || 'Pending'}</dd>
          <dt className="text-muted-foreground">Invitation</dt><dd>{candidate.inviteSent ? 'Sent' : 'Not sent'}</dd>
          <dt className="text-muted-foreground">Reminders</dt><dd>{candidate.reminderCount || 0}</dd>
          {candidate.link && <><dt className="text-muted-foreground">Link</dt><dd><a className="text-primary underline break-all" href={candidate.link} target="_blank" rel="noopener noreferrer">Open interview</a></dd></>}
          {candidate.password && <><dt className="text-muted-foreground">Password</dt><dd className="font-mono break-all">{candidate.password}</dd></>}
        </dl>
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">{actions(candidate)}</div>
      </article>;
    })}
  </div>;
}
