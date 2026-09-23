import { AlertCircle } from 'lucide-react';

export default function EmptyReportState({ status }: { status?: string | null }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-20 bg-white border border-dashed border-slate-200 rounded-2xl">
      <div className="h-16 w-16 rounded-full bg-amber-50 text-amber-500 flex items-center justify-center mb-4">
        <AlertCircle size={28} />
      </div>
      <h3 className="text-slate-800 text-lg font-semibold mb-1">Report Not Available</h3>
      <p className="text-slate-500 text-sm max-w-md">
        This interview&apos;s responses could not be evaluated due to insufficient data, background noise, or a network issue.
        {status && (
          <>
            {' '}Status: <span className="text-slate-700">{status}</span>
          </>
        )}
      </p>
    </div>
  );
}
