import { useState } from 'react';
import { Clock } from 'lucide-react';
import ActionMenu from './ActionMenu';

/** Values remain IST wall time. UTC conversion belongs to the scheduling layer. */
export default function DateTimeInput({ value, onChange, label, invalid, testId }: { value: string; onChange: (value: string) => void; label: string; invalid?: boolean; testId?: string }) {
  const [open, setOpen] = useState(false);
  const [date = '', time = '09:00'] = value.split('T');
  const [hours = '09', minutes = '00'] = time.split(':');
  const hour = Number(hours);
  const period = hour >= 12 ? 'PM' : 'AM';
  const displayHour = String(hour % 12 || 12).padStart(2, '0');
  const updateTime = (part: 'hour' | 'minute' | 'period', next: string) => {
    let nextHour = hour;
    if (part === 'hour') nextHour = Number(next) % 12 + (period === 'PM' ? 12 : 0);
    if (part === 'period') nextHour = hour % 12 + (next === 'PM' ? 12 : 0);
    onChange(`${date}T${String(nextHour).padStart(2, '0')}:${part === 'minute' ? next : minutes}`);
  };
  return <div data-testid={testId} className="grid grid-cols-1 sm:grid-cols-2 gap-2 min-w-0">
    <input type="date" aria-label={`${label} date (IST)`} value={date} aria-invalid={invalid || undefined}
      onChange={event => { onChange(event.target.value ? `${event.target.value}T${time}` : ''); setOpen(false); }}
      className={`w-full min-w-0 h-9 text-xs rounded-lg border bg-card px-2 font-mono focus-visible:ring-2 focus-visible:ring-ring ${invalid ? 'border-destructive' : 'border-border'}`} />
    <ActionMenu label={`${label} time (IST)`} open={open && !!date} onOpenChange={next => { if (date) setOpen(next); }} isPicker width={260} height={270}
      buttonClassName={`flex w-full h-9 items-center justify-between gap-2 rounded-lg border px-2 text-xs font-mono text-foreground focus-visible:ring-2 focus-visible:ring-ring ${invalid ? 'border-destructive' : 'border-border'} ${date ? 'bg-card cursor-pointer' : 'bg-muted text-muted-foreground cursor-not-allowed'}`}
      trigger={<><span>{date ? `${displayHour}:${minutes} ${period}` : 'Choose date first'}</span><Clock className="w-3.5 h-3.5 shrink-0" /></>}>
      <p className="px-3 py-1 text-xs font-semibold">{label} time (IST)</p>
      <div className="grid grid-cols-3 gap-2 px-2 pb-2">
        {(['hour', 'minute', 'period'] as const).map(part => <div key={part}>
          <p className="px-1 py-1 text-[10px] text-muted-foreground capitalize">{part}</p>
          <div className="max-h-40 overflow-y-auto overscroll-contain space-y-1" aria-label={part}>
            {(part === 'hour' ? Array.from({length:12}, (_, i) => String(i + 1).padStart(2, '0')) : part === 'minute' ? Array.from({length:60}, (_, i) => String(i).padStart(2, '0')) : ['AM', 'PM']).map(option => {
              const selected = option === (part === 'hour' ? displayHour : part === 'minute' ? minutes : period);
              return <button type="button" key={option} aria-pressed={selected} aria-label={`${part} ${option}`} onClick={() => updateTime(part, option)}
                className={`block w-full rounded-md px-2 py-1.5 text-xs font-semibold focus-visible:ring-2 focus-visible:ring-ring ${selected ? 'bg-blue-600 text-white' : 'text-foreground hover:bg-muted'}`}>{option}</button>;
            })}
          </div>
        </div>)}
      </div>
      <button type="button" onClick={() => setOpen(false)} className="block w-[calc(100%-1rem)] mx-2 mb-1 rounded-lg bg-blue-600 text-white py-1.5 text-xs font-semibold">Done</button>
    </ActionMenu>
  </div>;
}
