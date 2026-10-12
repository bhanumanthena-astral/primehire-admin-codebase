import { Check, CheckCircle2, MinusCircle, X, XCircle } from 'lucide-react';
import type { McqResult } from '../../utils/mcqReport';
import { mcqSummary } from '../../utils/mcqReport';

export default function McqAnswerReview({ result }: { result: McqResult }) {
  const correct = result.outcome === 'correct';
  const wrong = result.outcome === 'incorrect';
  const Icon = correct ? CheckCircle2 : wrong ? XCircle : MinusCircle;
  return (
    <div className="space-y-3 min-w-0">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-md bg-slate-100 px-2 py-1 font-semibold text-slate-600">MCQ</span>
        <span className="text-slate-500">{correct ? 'Correct answer' : wrong ? 'Incorrect answer' : result.outcome === 'unanswered' ? 'Not answered' : result.outcome === 'pending' ? 'Awaiting evaluation' : 'Answer review'}</span>
      </div>
      <ul aria-label="Answer options" className="space-y-2">
        {result.options.map(option => {
          const selected = option.id === result.selectedOptionId;
          const isCorrect = option.id === result.correctOptionId;
          const isWrong = selected && wrong;
          const highlighted = isCorrect || isWrong;
          return (
            <li key={option.id} className={`flex items-start gap-3 rounded-xl border p-3 text-sm ${isCorrect ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : isWrong ? 'border-rose-200 bg-rose-50 text-rose-900' : 'border-slate-200 bg-white text-slate-700'}`}>
              <span className={`flex h-7 min-w-7 shrink-0 items-center justify-center rounded-lg border px-1 text-xs font-bold ${isCorrect ? 'border-emerald-200 bg-white text-emerald-700' : isWrong ? 'border-rose-200 bg-white text-rose-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>{option.id}</span>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{option.text || `Option ${option.id} (text unavailable)`}</p>
                {(selected || isCorrect) && <p className="text-xs font-semibold">{selected && isCorrect ? 'Selected · Correct answer' : isCorrect ? 'Correct answer' : 'Candidate’s selection'}</p>}
              </div>
              {highlighted && (isCorrect ? <Check aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-emerald-600" /> : <X aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-rose-600" />)}
            </li>
          );
        })}
      </ul>
      <div className={`flex items-start gap-2 rounded-lg px-3 py-2.5 text-xs leading-relaxed ${correct ? 'bg-emerald-50 text-emerald-800' : wrong ? 'bg-rose-50 text-rose-800' : 'bg-slate-100 text-slate-600'}`}>
        <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
        <p className="min-w-0 break-words [overflow-wrap:anywhere]">{mcqSummary(result)}</p>
      </div>
      {result.hasMissingOptionText && <p className="text-xs leading-relaxed text-slate-500">Some option text is unavailable. Answer IDs from the report are shown where the original options could not be matched.</p>}
    </div>
  );
}
