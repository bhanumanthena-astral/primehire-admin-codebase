import {Button} from '@/components/ui/button';
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
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-lg font-semibold text-primary-foreground shadow-[var(--shadow-card)]"
        >
          {(name || '?').charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-base font-bold text-foreground dark:text-white">{name}</h2>
            <span className="rounded border border-border bg-background px-2 py-0.5 font-mono text-[0.6875rem] text-muted-foreground dark:border-border dark:bg-card dark:text-muted-foreground">
              {email}
            </span>
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground dark:text-muted-foreground">
            <span className="font-semibold text-foreground dark:text-foreground">{jobTitle}</span>
            {' · '}
            {roundType} Round
            {' · '}
            {formatDate(submitted)}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[0.6875rem] font-bold uppercase tracking-wide ${
            evaluated ? 'border-success/30 bg-[var(--success-soft)] text-success' : 'border-warning/30 bg-[var(--warning-soft)] text-warning'
          }`}
          role="status"
        >
          {statusLabel}
        </span>

        {/* Download & Export Group */}
        <div className="relative inline-flex items-center" ref={menuRef}>
          <Button variant="ghost"
            type="button"
            onClick={onExport}
            disabled={exporting}
            className="inline-flex items-center gap-1.5 rounded-l-full border border-r-0 border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-background hover:text-accent disabled:opacity-50 dark:border-border dark:bg-card dark:text-foreground dark:hover:bg-muted"
            title="Download interactive PDF report"
          >
            {exporting ? <Loader2 size={13} className="animate-spin text-accent" /> : <Download size={13} className="text-accent" />}
            {exporting ? 'Generating PDF…' : 'Download PDF'}
          </Button>
          <Button variant="ghost"
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            disabled={exporting}
            aria-label="More export options"
            aria-expanded={menuOpen}
            className="inline-flex items-center justify-center rounded-r-full border border-border bg-card px-2 py-1.5 text-xs text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-50 dark:border-border dark:bg-card dark:text-muted-foreground dark:hover:bg-muted"
          >
            <ChevronDown size={13} className={menuOpen ? 'rotate-180 transition-transform' : 'transition-transform'} />
          </Button>

          {menuOpen && (
            <div className="absolute right-0 top-full z-50 mt-1.5 w-56 rounded-xl border border-border bg-card p-1.5 shadow-xl dark:border-border dark:bg-card">
              <Button variant="ghost"
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onExport();
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-semibold text-foreground hover:bg-[var(--primary-soft)] hover:text-accent dark:text-foreground dark:hover:bg-muted"
              >
                <FileText size={14} className="text-accent shrink-0" />
                <div>
                  <p>Interactive PDF Report</p>
                  <p className="text-[0.6875rem] font-normal text-muted-foreground">Selectable text & clickable links</p>
                </div>
              </Button>

              {onExportHtml && (
                <Button variant="ghost"
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onExportHtml();
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-semibold text-foreground hover:bg-[var(--primary-soft)] hover:text-accent dark:text-foreground dark:hover:bg-muted"
                >
                  <Globe size={14} className="text-accent shrink-0" />
                  <div>
                    <p>Standalone HTML Report</p>
                    <p className="text-[0.6875rem] font-normal text-muted-foreground">Offline interactive file (.html)</p>
                  </div>
                </Button>
              )}

              {onPrint && (
                <Button variant="ghost"
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onPrint();
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-semibold text-foreground hover:bg-[var(--primary-soft)] hover:text-accent dark:text-foreground dark:hover:bg-muted"
                >
                  <Printer size={14} className="text-accent shrink-0" />
                  <div>
                    <p>Print / Save Vector PDF</p>
                    <p className="text-[0.6875rem] font-normal text-muted-foreground">Browser system print dialog</p>
                  </div>
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Share Button (opens ShareModal with Gmail, LinkedIn, WhatsApp) */}
        <Button variant="ghost"
          type="button"
          onClick={onShare}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-background hover:text-accent dark:border-border dark:bg-card dark:text-foreground dark:hover:bg-muted"
        >
          <Share2 size={13} className="text-accent" />
          Share
        </Button>

        {/* Close Button */}
        <Button variant="ghost"
          type="button"
          onClick={onClose}
          aria-label="Close report"
          className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:bg-background hover:text-foreground dark:border-border dark:bg-card dark:text-muted-foreground dark:hover:bg-muted"
        >
          <X size={14} />
        </Button>
      </div>
    </div>
  );
}
