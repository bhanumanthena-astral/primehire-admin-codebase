import {Slider} from '@/components/ui/slider';
import {Button} from '@/components/ui/button';
import {Application, Page, recruitmentRequest} from '../lib/recruitmentApi';

export async function matchingApplications(path:string) {
  const rows = new Map<string,Application>();
  const url = new URL(path, 'https://local.invalid');
  url.searchParams.set('limit','100');
  for(let offset=0;;offset+=100) {
    url.searchParams.set('skip',String(offset));
    const page = await recruitmentRequest<Page<Application>>(url.pathname+url.search);
    for(const row of page.items) rows.set(row.applicationId,row);
    if(offset+page.items.length>=page.total || page.items.length<100) break;
  }
  return [...rows.values()];
}

export function JobScoreFilter({label,range,onChange,onSelect,onClear,count,busy}:{
  label:string;range:number[]|null;onChange:(range:number[]|null)=>void;
  onSelect?:()=>void;onClear:()=>void;count:number;busy:boolean;
}) {
  const values=range??[0,100];
  return <section className="space-y-3 rounded-xl border p-3" aria-label={label}>
    <div className="flex justify-between text-sm"><strong>{label}</strong><output>{values[0]}–{values[1]} · {count} matching</output></div>
    <Slider value={values} min={0} max={100} step={1} disabled={busy} onValueChange={onChange}
      getAriaLabel={i=>(i?'Maximum ':'Minimum ')+label} />
    <div className="flex gap-3">{[0,1].map(index=><label key={index} className="text-xs">{index?'Maximum':'Minimum'}<input className="ml-2 w-20 rounded border bg-background p-2" type="number" min={index?values[0]:0} max={index?100:values[1]} value={values[index]} disabled={busy} onChange={e=>{const next=[...values];next[index]=Math.max(index?values[0]:0,Math.min(index?100:values[1],Number(e.target.value)));onChange(next)}}/></label>)}</div>
    <div className="flex flex-wrap gap-2">{onSelect&&<Button variant="outline" disabled={busy} onClick={onSelect}>Select all in range</Button>}
    <Button variant="ghost" disabled={busy} onClick={onClear}>Clear selection</Button>
    {range&&<Button variant="ghost" disabled={busy} onClick={()=>onChange(null)}>Show all scores</Button>}</div>
  </section>;
}
