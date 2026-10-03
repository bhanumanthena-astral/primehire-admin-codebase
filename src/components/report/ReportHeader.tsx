import { useState, useRef, useEffect } from 'react';
import { Download, Share2, X, Loader2, FileText, Globe, Printer, ChevronDown } from 'lucide-react';
import { formatDate } from '../../utils/normalizeReport';

/** Compact candidate header: WHO / WHAT ROUND / WHEN / STATUS + Export & Share actions. */
export default function ReportHeader({
  name,
  email,
  jobTitle,
  roundType,
  submitted,
  statusLabel,
  evaluated,
  onExport,
  exporting,
  onExportHtml,
  onPrint,
  onShare,
  onClose,
}: {
  name: string;
  email: string;
  jobTitle: string;
  roundType: string;
  submitted: string | null;
  statusLabel: string;
  evaluated: boolean;
  onExport: () => void;
  exporting: boolean;
  onExportHtml?: () => void;
  onPrint?: () => void;
  onShare: () => void;
  onClose: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <div
          aria-hidden
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-lg font-black text-primary-foreground shadow-[var(--shadow-card)]"
        >
          {(name || '?').charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-base font-bold text-slate-900 dark:text-white">{name}</h2>
            <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[10px] text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
              {email}
            </span>
          </div>
          <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
            <span className="font-semibold text-slate-700 dark:text-slate-200">{jobTitle}</span>
            {' · '}
            {roundType} Round
            {' · '}
            {formatDate(submitted)}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${
            evaluated ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'
          }`}
          role="status"
        >
          {statusLabel}
        </span>

        {/* Download & Export Group */}
        <div className="relative inline-flex items-center" ref={menuRef}>
          <button
            type="button"
            onClick={onExport}
            disabled={exporting}
            className="inline-flex items-center gap-1.5 rounded-l-full border border-r-0 border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:text-amber-600 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            title="Download interactive PDF report"
          >
            {exporting ? <Loader2 size={13} className="animate-spin text-amber-600" /> : <Download size={13} className="text-amber-600" />}
            {exporting ? 'Generating PDF…' : 'Download PDF'}
          </button>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            disabled={exporting}
            aria-label="More export options"
            aria-expanded={menuOpen}
            className="inline-flex items-center justify-center rounded-r-full border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-500 hover:bg-slate-50 hover:text-slate-700 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            <ChevronDown size={13} className={menuOpen ? 'rotate-180 transition-transform' : 'transition-transform'} />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full z-50 mt-1.5 w-56 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-800">
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onExport();
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-amber-50 hover:text-amber-700 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                <FileText size={14} className="text-amber-600 shrink-0" />
                <div>
                  <p>Interactive PDF Report</p>
                  <p className="text-[10px] font-normal text-slate-400">Selectable text & clickable links</p>
                </div>
              </button>

              {onExportHtml && (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onExportHtml();
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-amber-50 hover:text-amber-700 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  <Globe size={14} className="text-amber-600 shrink-0" />
                  <div>
                    <p>Standalone HTML Report</p>
                    <p className="text-[10px] font-normal text-slate-400">Offline interactive file (.html)</p>
                  </div>
                </button>
              )}

              {onPrint && (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onPrint();
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-amber-50 hover:text-amber-700 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  <Printer size={14} className="text-amber-600 shrink-0" />
                  <div>
                    <p>Print / Save Vector PDF</p>
                    <p className="text-[10px] font-normal text-slate-400">Browser system print dialog</p>
                  </div>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Share Button (opens ShareModal with Gmail, LinkedIn, WhatsApp) */}
        <button
          type="button"
          onClick={onShare}
          className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:text-amber-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          <Share2 size={13} className="text-amber-600" />
          Share
        </button>

        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close report"
          className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
