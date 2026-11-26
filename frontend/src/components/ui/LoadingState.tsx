import {Skeleton} from '@/components/ui/skeleton';
import StatusMark from '../reactbits/StatusMark';
import {cn} from '@/lib/utils';

export function LoadingState({label='Loading data…', className, compact=false}: {label?:string; className?:string; compact?:boolean}) {
  return <div role="status" aria-live="polite" aria-busy="true" className={cn('w-full space-y-4 rounded-xl p-4', className)}>
    <StatusMark status="running" label={label} strike={false} className="text-muted-foreground"/>
    <div aria-hidden="true" className="space-y-3">
      {!compact && <div className="grid grid-cols-3 gap-3">{[0,1,2].map(i=><Skeleton key={i} index={i} className="h-20 rounded-xl"/>)}</div>}
      {[0,1,2].map(i=><div className="flex items-center gap-3" key={i}><Skeleton index={i+3} className="size-9 shrink-0 rounded-lg"/><div className="flex-1 space-y-2"><Skeleton index={i+3} className={i===1?'h-3 w-2/3':'h-3 w-4/5'}/><Skeleton index={i+3} className="h-2 w-1/3"/></div></div>)}
    </div>
  </div>;
}
