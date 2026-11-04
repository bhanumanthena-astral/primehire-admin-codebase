import {useEffect,useRef,useState} from 'react';
import {ArrowRight,CheckCircle2,FileCheck2,X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import type {Round} from '../../lib/recruitmentApi';

export type ReviewCompletion = {interviewId:string;candidateName:string;round:Round};

export function ReviewSubmissionSuccess({completion,interviewerName,onContinue,onViewReview}: {
  completion:ReviewCompletion;interviewerName?:string;onContinue:()=>void;onViewReview:()=>void;
}) {
  const heading=useRef<HTMLHeadingElement>(null);
  const [imageAvailable,setImageAvailable]=useState(true);
  const firstName=interviewerName?.trim().split(/\s+/)[0];
  const round=completion.round==='hr'?'HR':completion.round;
  useEffect(()=>{heading.current?.focus({preventScroll:true});},[completion.interviewId]);
  return <section aria-labelledby="review-submission-heading" className="relative isolate overflow-hidden rounded-3xl border border-primary/20 bg-card shadow-[var(--shadow-card)]">
    <Button type="button" variant="ghost" size="icon" aria-label="Dismiss review confirmation" onClick={onContinue} className="absolute right-3 top-3 z-10"><X className="size-4"/></Button>
    <div className="grid items-center gap-4 px-6 py-8 sm:px-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0 max-w-2xl">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-success/10 px-3 py-1.5 text-xs font-semibold text-success"><CheckCircle2 className="size-4"/>Interview review complete</div>
        <h2 ref={heading} tabIndex={-1} id="review-submission-heading" className="pr-5 text-2xl font-semibold tracking-tight outline-none sm:text-3xl">Review submitted successfully</h2>
        <p className="mt-3 text-base leading-relaxed">Congratulations{firstName?`, ${firstName}`:''}! Your {round} interview feedback for <strong className="font-semibold">{completion.candidateName}</strong> has been saved.</p>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">Thank you for the time, care and expertise you brought to this interview. Your thoughtful feedback helps the team make an informed hiring decision.</p>
        <p role="status" className="mt-4 flex items-start gap-2 text-sm text-success"><FileCheck2 aria-hidden="true" className="mt-0.5 size-4 shrink-0"/>Your review is saved and recorded in the candidate’s timeline.</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button type="button" onClick={onContinue}>Continue to interviews<ArrowRight className="size-4"/></Button>
          <Button type="button" variant="outline" onClick={onViewReview}>View submitted review</Button>
        </div>
      </div>
      <div className="flex justify-center rounded-2xl bg-[var(--primary-soft)] px-3 pt-3 lg:py-4">
        {imageAvailable?<img src="/images/interview-review-thank-you.png" width={512} height={512} alt="A friendly 3D colleague showing appreciation" decoding="async" onError={()=>setImageAvailable(false)} className="h-44 w-44 object-contain sm:h-56 sm:w-56 lg:h-64 lg:w-64"/>:<CheckCircle2 aria-hidden="true" className="m-10 size-24 text-success"/>}
      </div>
    </div>
  </section>;
}
