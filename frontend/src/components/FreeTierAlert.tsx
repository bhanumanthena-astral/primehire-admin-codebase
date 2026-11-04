import {useEffect, useState} from 'react';
import {useAuth} from '../lib/authContext';
import {fetchCapacity, type CapacityReport} from '../lib/hiringApi';

export function FreeTierAlert() {
  const {user} = useAuth();
  const [report, setReport] = useState<CapacityReport | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    if (user?.role !== 'super_admin') return;
    let alive = true;
    let enabled = false;
    const load = async () => {
      try {
        const result = await fetchCapacity();
        if (!alive) return;
        enabled = result.enabled;
        setReport(result.capacity);
        setUnavailable(enabled && !result.capacity);
      } catch {
        if (alive && enabled) setUnavailable(true);
      }
    };
    void load();
    const timer = window.setInterval(() => { void load(); }, 30000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [user?.role]);
  if (user?.role !== 'super_admin') return null;
  const stale = report && Date.now() - Date.parse(report.checkedAt) > 60000;
  if (!unavailable && !stale && !['warning', 'paused'].includes(report?.state || '')) return null;
  return <aside role="alert" className="mb-5 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
    <p className="font-semibold">Free tier capacity alert</p>
    <p className="mt-1">{unavailable || stale ? 'Capacity monitoring is unavailable or stale. Check the resume worker.' : report?.reasons.join(' ')}</p>
    <p className="mt-1 text-xs">Open Administration → Diagnostics for Super Admin resource metrics. The deployment reserves 30% and never scales automatically.</p>
  </aside>;
}
