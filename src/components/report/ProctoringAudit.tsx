import { motion } from 'framer-motion';
import { CheckCircle2, XCircle, ShieldCheck, ShieldAlert } from 'lucide-react';

const ITEMS = [
  { key: 'ideal_environment', camelKey: 'idealEnvironment', label: 'Ideal Environment', goodText: 'No issues detected' },
  { key: 'multiple_faces_detected', camelKey: 'multipleFacesDetected', label: 'Multiple Faces', goodText: 'No additional faces detected' },
  { key: 'tab_switching', camelKey: 'tabSwitching', label: 'Tab Switching', goodText: 'No suspicious activity' },
];

export default function ProctoringAudit({
  violations,
  delay = 0,
}: {
  violations: Record<string, any> | null | undefined;
  delay?: number;
}) {
  if (!violations) return null;
  const totalFlags = Object.values(violations).reduce((a: number, b: any) => a + (b || 0), 0);
  const isSecure = totalFlags === 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4 }}
      className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm"
    >
      <div className="flex items-center gap-2 mb-4">
        <ShieldCheck size={18} className="text-emerald-600" />
        <p className="text-sm font-semibold text-slate-800">Proctoring & Integrity Audit</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        {ITEMS.map((item) => {
          const val = violations[item.key] ?? violations[item.camelKey] ?? 0;
          const flagged = val > 0;
          return (
            <div key={item.key} className="border border-slate-100 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                {flagged ? <XCircle size={16} className="text-red-500" /> : <CheckCircle2 size={16} className="text-emerald-500" />}
                <span className="text-xs text-slate-500">{item.label}</span>
              </div>
              <p className="text-xl font-bold text-slate-900">{val}</p>
              <p className="text-xs text-slate-400 mt-0.5">{flagged ? 'Flagged during session' : item.goodText}</p>
            </div>
          );
        })}
        <div className={`rounded-xl p-4 flex flex-col justify-center items-center text-center ${isSecure ? 'bg-emerald-50' : 'bg-red-50'}`}>
          {isSecure ? <ShieldCheck size={22} className="text-emerald-600 mb-1" /> : <ShieldAlert size={22} className="text-red-600 mb-1" />}
          <p className={`text-sm font-semibold ${isSecure ? 'text-emerald-700' : 'text-red-700'}`}>
            {isSecure ? 'Secure Session' : 'Flags Detected'}
          </p>
          <p className="text-xs text-slate-500">{isSecure ? 'No integrity violations detected' : `${totalFlags} total flag(s)`}</p>
        </div>
      </div>
    </motion.div>
  );
}
