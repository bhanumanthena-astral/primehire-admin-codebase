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
          <h2 className="text-xl sm:text-2xl font-semibold tracking-tight text-white">
            {title}
          </h2>
          {subtitle && (
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed max-w-2xl">{subtitle}</p>
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
        'rounded-2xl border border-border/70 bg-card text-card-foreground shadow-[var(--shadow-card)] transition-all duration-200',
        padded && 'p-5 sm:p-6',
        className
      )}
    >
      {children}
    </div>
  );
}

export function PanelTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h3 className={cn('text-sm font-semibold text-white', className)}>{children}</h3>;
}

export function PanelSubtitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn('text-xs text-muted-foreground', className)}>{children}</p>;
}

/* ── IconSquare: rounded-xl data tiles ─────────────────────── */
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
          ? 'bg-primary-foreground/10 border-primary-foreground/15 text-primary-foreground backdrop-blur'
          : 'bg-accent/10 border-accent/15 text-accent dark:bg-primary/15 dark:text-primary-glow dark:border-primary/20',
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
          <span className="text-2xl font-semibold tracking-tight text-foreground tnum tabular-nums">
            {value}
          </span>
          {unit && <span className="text-xs text-muted-foreground font-medium">{unit}</span>}
        </div>
      </div>
      {(footer || action) && (
        <div className="pt-3 border-t border-border/60 flex items-center justify-between gap-2 text-xs">
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
        'font-semibold text-accent hover:opacity-80 inline-flex items-center gap-0.5 text-[11px] cursor-pointer transition-opacity',
        className
      )}
    >
      {children} <ArrowUpRight className="w-3 h-3" />
    </button>
  );
}

/* ── Pill: semantic status ─────────────────────────────────── */
type PillTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

const pillStyles: Record<PillTone, string> = {
  neutral: 'bg-muted text-muted-foreground',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-destructive/10 text-destructive',
  info: 'bg-accent/10 text-accent',
  accent: 'bg-accent/10 text-accent',
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
        'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap transition-opacity',
        pillStyles[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

/* ── Bar: 28px frosted distribution ────────────────────────── */
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
        <span className="absolute inset-0 flex items-center justify-end pr-3 text-[11px] font-semibold text-foreground tnum tabular-nums">
          {countLabel}
        </span>
      )}
    </div>
  );
}

/* ── Buttons: single system ────────────────────────────────── */
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
          'inline-flex items-center justify-center gap-1.5 rounded-full bg-card border border-border/70 text-foreground text-xs font-semibold px-4 py-2 transition-all duration-200 hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50 disabled:pointer-events-none cursor-pointer',
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
        'inline-flex items-center justify-center gap-1.5 rounded-full bg-gradient-primary text-primary-foreground text-xs font-semibold px-4 py-2 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-glow)] focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50 disabled:pointer-events-none cursor-pointer',
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
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 border text-xs transition-all duration-200',
        variant === 'on-brand'
          ? 'border-primary-foreground/25 bg-primary-foreground/10 backdrop-blur text-primary-foreground'
          : 'border-border/70 bg-card text-foreground shadow-[var(--shadow-card)]',
        className
      )}
    >
      {label && (
        <span
          className={cn(
            'text-[10px] font-semibold uppercase tracking-wide',
            variant === 'on-brand' ? 'text-primary-foreground/70' : 'text-muted-foreground'
          )}
        >
          {label}
        </span>
      )}
      <select
        aria-label={ariaLabel || label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'bg-transparent text-xs font-semibold focus:outline-none cursor-pointer',
          variant === 'on-brand' ? 'text-primary-foreground [&>option]:text-foreground' : 'text-foreground'
        )}
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
        'w-9 h-9 rounded-full inline-flex items-center justify-center border border-primary-foreground/25 bg-primary-foreground/10 backdrop-blur text-primary-foreground hover:bg-primary-foreground/20 transition-all duration-200 cursor-pointer',
        className
      )}
    >
      {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );
}

/* ── EmptyNote ─────────────────────────────────────────────── */
export function EmptyNote({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('py-10 text-center text-xs text-muted-foreground italic', className)}>
      {children}
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
          'w-full text-left rounded-2xl border p-5 transition-all duration-200 focus-visible:ring-2 focus-visible:ring-ring/40 cursor-pointer',
          active
            ? 'border-primary bg-primary-soft shadow-[var(--shadow-card)] -translate-y-0.5'
            : 'border-border/70 bg-card shadow-[var(--shadow-card)] hover:-translate-y-0.5 hover:border-primary/40'
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div
            className={cn(
              'w-10 h-10 rounded-xl flex items-center justify-center border shrink-0',
              active
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-accent/10 text-accent border-accent/15'
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
          <div className="text-sm font-semibold text-foreground">{title}</div>
          {description && <div className="text-xs text-muted-foreground mt-1 leading-relaxed">{description}</div>}
          {meta && <div className="mt-2.5">{meta}</div>}
        </div>
      </button>
      {active && (
        <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 text-primary">
          <ChevronDown className="w-4 h-4" />
        </div>
      )}
    </div>
  );
}

/* ── FrostedDetailPanel: one glass layer per screen ────────── */
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
      className={cn(
        'glass-panel p-5 sm:p-6 animate-in fade-in slide-in-from-top-2 duration-300',
        className
      )}
    >
      {children}
    </div>
  );
}
