import React from 'react';
import { Clock } from 'lucide-react';
import type { AssessmentProfile } from '../types';
import { getAssessmentAvailability } from '../utils/assessmentAvailability';

export default function AssessmentPreparationNotice({ assessment, now }: { assessment: AssessmentProfile; now: number }) {
  const availability = getAssessmentAvailability(assessment, now);
  if (availability.canAddCandidates) return null;
  return (
    <div className="flex items-start gap-3 rounded-xl border border-violet-200 bg-violet-50 p-4 text-violet-950" role="status" aria-live="off">
      <Clock className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <div className="space-y-1">
        <p className="text-sm font-semibold">{availability.message}</p>
        <p className="text-xs leading-relaxed">{availability.remainingSeconds > 0
          ? 'Please wait before adding candidates. This preparation buffer allows time for question audio generation and continues even if you refresh or leave this page.'
          : 'Return to the assessment list to check setup or retry a failed setup.'}</p>
      </div>
    </div>
  );
}
