/** Job form wall-clock values use the organization timezone, not browser timezone. */
let zone = 'Asia/Kolkata';
export function setJobTimezone(value: string) { zone = value; }
export function jobTimezone() { return zone; }
export function jobLocalInput(iso?: string | null): string {
  if (!iso || Number.isNaN(new Date(iso).getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const get = (key: string) => parts.find(p => p.type === key)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}
export function jobUtcInput(local: string): string {
  let guess = Date.parse(`${local}:00Z`);
  const target = guess;
  for (let i = 0; i < 3; i++) {
    const displayed = Date.parse(`${jobLocalInput(new Date(guess).toISOString())}:00Z`);
    guess += target - displayed;
  }
  if (jobLocalInput(new Date(guess).toISOString()) !== local) throw new Error('This time does not exist in the organization timezone.');
  return new Date(guess).toISOString();
}
export function jobDate(iso?: string | null): string {
  if (!iso || Number.isNaN(new Date(iso).getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', {timeZone: zone, dateStyle: 'medium', timeStyle: 'short'}).format(new Date(iso));
}
export function jobDateBoundary(value: string, end = false): string | undefined {
  if (!value) return undefined;
  const start = jobUtcInput(`${value}T${end ? '23:59' : '00:00'}`);
  return end ? new Date(Date.parse(start) + 59999).toISOString() : start;
}
