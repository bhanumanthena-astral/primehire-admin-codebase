import React, { useEffect, useState } from 'react';
import { ArrowUpRight, Check, ChevronDown, Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';

/* ── SectionHeader ─────────────────────────────────────────── */
export function SectionHeader({
  eyebrow,
  title,
  subtitle,
  icon,
  action,
  className,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      <div className="flex items-start gap-3 min-w-0">
        {icon && <IconSquare>{icon}</IconSquare>}
        <div className="min-w-0">
          <span className="eyebrow block">{eyebrow}</span>
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground mt-0.5">
            {title}
          </h2>
          {subtitle && (
            <p className="text-[13px] text-muted-foreground mt-1 leading-relaxed max-w-2xl">{subtitle}</p>
          )}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/* ── Panel: major cards ────────────────────────────────────── */
export function Panel({
  children,
  className,
  padded = true,
}: {
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-[1.25rem] border border-border bg-card text-card-foreground shadow-[var(--shadow-card)] transition-all duration-200',
        padded && 'p-5 sm:p-6',
        className
      )}
    >
      {children}
    </div>
  );
}

export function PanelTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h3 className={cn('text-sm font-bold text-foreground tracking-tight', className)}>{children}</h3>;
}

export function PanelSubtitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn('text-xs text-muted-foreground leading-relaxed', className)}>{children}</p>;
}

/* ── IconSquare: rounded data tiles ────────────────────────── */
export function IconSquare({
  children,
  className,
  tone = 'default',
}: {
  children: React.ReactNode;
  className?: string;
  tone?: 'default' | 'on-brand';
}) {
  return (
    <div
      className={cn(
        'w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border',
        tone === 'on-brand'
          ? 'bg-primary text-primary-foreground border-black/10 shadow-[var(--shadow-card)]'
          : 'bg-[var(--primary-soft)] border-[var(--border)] text-[var(--accent)]',
        className
      )}
    >
      {children}
    </div>
  );
}

/* ── Stat / KPI ────────────────────────────────────────────── */
export function Stat({
  label,
  value,
  unit,
  pill,
  footer,
  action,
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  pill?: React.ReactNode;
  footer?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <Panel className="flex flex-col justify-between gap-4 hover:-translate-y-0.5">
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className="eyebrow">{label}</span>
          {pill}
        </div>
        <div className="flex items-baseline gap-2 pt-1">
          <span className="text-[28px] leading-8 font-bold tracking-tight text-foreground tnum tabular-nums">
            {value}
          </span>
          {unit && <span className="text-xs text-muted-foreground font-medium">{unit}</span>}
        </div>
      </div>
      {(footer || action) && (
        <div className="pt-3 border-t border-border flex items-center justify-between gap-2 text-xs">
          <span className="text-[11px] text-muted-foreground">{footer}</span>
          {action}
        </div>
      )}
    </Panel>
  );
}

export function ViewMoreButton({
  children,
  onClick,
  className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'font-bold text-[var(--accent)] hover:opacity-75 inline-flex items-center gap-0.5 text-[11px] cursor-pointer transition-opacity',
        className
      )}
    >
      {children} <ArrowUpRight className="w-3 h-3" />
    </button>
  );
}

/* ── Pill: semantic status, low saturation ─────────────────── */
type PillTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

const pillStyles: Record<PillTone, string> = {
  neutral: 'bg-muted text-muted-foreground',
  success: 'bg-[var(--success-soft)] text-[var(--success)]',
  warning: 'bg-[var(--warning-soft)] text-[var(--warning)]',
  danger: 'bg-[var(--destructive-soft)] text-[var(--destructive)]',
  info: 'bg-[var(--info-soft)] text-[var(--info)]',
  accent: 'bg-[var(--accent-soft)] text-[var(--accent)]',
};

export function Pill({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: PillTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap transition-opacity',
        pillStyles[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

/* ── Bar: slim warm distribution ───────────────────────────── */
export function Bar({
  value,
  color,
  countLabel,
  className,
}: {
  value: number; // 0-100
  color: string; // css color
  countLabel?: string;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className={cn('bar-track relative', className)}>
      <div className="bar-fill" style={{ width: `${pct}%`, background: color }} />
      {countLabel && (
        <span className="absolute inset-0 flex items-center justify-end pr-3 text-[11px] font-bold text-foreground tnum tabular-nums">
          {countLabel}
        </span>
      )}
    </div>
  );
}

/* ── Buttons: Elite HR system ──────────────────────────────── */
export function PAButton({
  variant = 'primary',
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' }) {
  if (variant === 'secondary') {
    return (
      <button
        {...props}
        className={cn(
          'inline-flex items-center justify-center gap-1.5 rounded-[10px] bg-card border border-border text-foreground text-xs font-bold px-4 py-2.5 shadow-[var(--shadow-card)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--ring)] focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50 disabled:pointer-events-none cursor-pointer',
          className
        )}
      >
        {children}
      </button>
    );
  }
  return (
    <button
      {...props}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-[10px] bg-primary text-primary-foreground border border-black/10 text-xs font-bold px-4 py-2.5 shadow-[var(--shadow-card)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-glow)] focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50 disabled:pointer-events-none cursor-pointer',
        className
      )}
    >
      {children}
    </button>
  );
}

/* ── FilterSelect ──────────────────────────────────────────── */
export function FilterSelect({
  label,
  value,
  onChange,
  children,
  variant = 'default',
  className,
  ariaLabel,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  variant?: 'default' | 'on-brand';
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <label
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 border text-xs transition-all duration-200 bg-card shadow-[var(--shadow-card)]',
        variant === 'on-brand' ? 'border-border text-foreground' : 'border-border text-foreground',
        className
      )}
    >
      {label && (
        <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
      )}
      <select
        aria-label={ariaLabel || label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-transparent text-xs font-bold focus:outline-none cursor-pointer text-foreground"
      >
        {children}
      </select>
    </label>
  );
}

/* ── ModeToggle ────────────────────────────────────────────── */
export function ModeToggle({ className }: { className?: string }) {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    try {
      const stored = localStorage.getItem('placement-theme');
      setDark(
        stored === 'dark' ||
          (!stored && document.documentElement.classList.contains('dark'))
      );
    } catch {
      setDark(document.documentElement.classList.contains('dark'));
    }
  }, []);
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('placement-theme', next ? 'dark' : 'light');
    } catch {}
  };
  return (
    <button
      onClick={toggle}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      className={cn(
        'w-9 h-9 rounded-full inline-flex items-center justify-center border border-border bg-card text-muted-foreground hover:text-foreground hover:border-[var(--ring)] shadow-[var(--shadow-card)] transition-all duration-200 cursor-pointer',
        className
      )}
    >
      {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );
}

/* ── EmptyNote: editorial empty state ──────────────────────── */
export function EmptyNote({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('py-10 px-6 text-center', className)}>
      <div aria-hidden className="mx-auto mb-3 flex items-center justify-center gap-2">
        <span className="h-[7px] w-[7px] rounded-[2px] bg-[var(--primary)]" />
        <svg width="72" height="12" viewBox="0 0 72 12" fill="none" aria-hidden="true">
          <path
            d="M2 8 C 12 8, 10 2, 20 5 C 30 8, 28 10, 38 7 C 48 4, 52 3, 70 5"
            stroke="var(--accent)"
            strokeWidth="1.2"
            strokeLinecap="round"
            opacity="0.7"
          />
        </svg>
        <span className="h-[7px] w-[7px] rounded-full border border-[var(--accent)]" />
      </div>
      <div className="text-[13px] font-semibold text-foreground">{children}</div>
    </div>
  );
}

/* ── SelectableDomainCard ──────────────────────────────────── */
export function SelectableDomainCard({
  active,
  onSelect,
  icon,
  title,
  description,
  meta,
  className,
}: {
  active: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  description?: string;
  meta?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('relative', className)}>
      <button
        aria-pressed={active}
        onClick={onSelect}
        className={cn(
          'w-full text-left rounded-[1.25rem] border p-5 transition-all duration-200 focus-visible:ring-2 focus-visible:ring-ring/40 cursor-pointer',
          active
            ? 'border-[var(--ring)] bg-[var(--primary-soft)] shadow-[var(--shadow-card)] -translate-y-0.5'
            : 'border-border bg-card shadow-[var(--shadow-card)] hover:-translate-y-0.5 hover:border-[var(--ring)]'
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div
            className={cn(
              'w-10 h-10 rounded-xl flex items-center justify-center border shrink-0',
              active
                ? 'bg-primary text-primary-foreground border-black/10'
                : 'bg-[var(--primary-soft)] text-[var(--accent)] border-[var(--border)]'
            )}
          >
            {icon}
          </div>
          {active && (
            <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0">
              <Check className="w-3 h-3" />
            </span>
          )}
        </div>
        <div className="mt-3">
          <div className="text-sm font-bold text-foreground">{title}</div>
          {description && <div className="text-xs text-muted-foreground mt-1 leading-relaxed">{description}</div>}
          {meta && <div className="mt-2.5">{meta}</div>}
        </div>
      </button>
      {active && (
        <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 text-[var(--accent)]">
          <ChevronDown className="w-4 h-4" />
        </div>
      )}
    </div>
  );
}

/* ── Content wrapper: warm entrance, no glass ──────────────── */
export function FrostedDetailPanel({
  children,
  panelKey,
  className,
}: {
  children: React.ReactNode;
  panelKey: string;
  className?: string;
}) {
  return (
    <div
      key={panelKey}
      className={cn('ehr-rise', className)}
    >
      {children}
    </div>
  );
}
