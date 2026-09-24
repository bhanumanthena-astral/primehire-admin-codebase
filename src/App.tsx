/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { INITIAL_ASSESSMENTS, INITIAL_CANDIDATES, INITIAL_TEMPLATES } from './mockData';
import { AssessmentProfile, Candidate, MailTemplate } from './types';
import Dashboard from './components/Dashboard';
import AssessmentsAndAssignments from './components/AssessmentsAndAssignments';
import CandidateManagement from './components/CandidateManagement';
import MailTemplates from './components/MailTemplates';
import ReportDialog from './components/ReportDialog';
import { Toaster } from '@/components/ui/sonner';
import {
  FrostedDetailPanel,
  ModeToggle,
  Pill,
} from './components/ui/primitives';
import {
  LayoutDashboard,
  Users,
  Mail,
  Briefcase,
  Menu,
  X,
  Zap,
  SlidersHorizontal,
  RotateCcw,
  Search,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { fetchAssessments, fetchCandidates } from './lib/mongoApi';

const MODULE_TABS = [
  { id: 'dashboard', label: 'Dashboard Overview', short: 'Overview', icon: LayoutDashboard, desc: 'Throughput & evaluation metrics' },
  { id: 'candidates', label: 'Candidate Directory', short: 'Candidates', icon: Users, desc: 'Pipeline, reports & credentials' },
  { id: 'assessments', label: 'Assessments & Profiles', short: 'Assessments', icon: Briefcase, desc: 'Profiles, scheduling & links' },
  { id: 'templates', label: 'Mail Templates', short: 'Templates', icon: Mail, desc: 'Invites & reminder sequences' },
];

function useCompactHeader() {
  const [compact, setCompact] = useState(false);
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    const onScroll = () => {
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const y = window.scrollY;
        setCompact((prev) => {
          if (!prev && y > 72) return true;
          if (prev && y < 32) return false;
          return prev;
        });
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);
  return compact;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const compact = useCompactHeader();

  // Global Filter State (preserved across navigation views)
  const [filterRound, setFilterRound] = useState<string>('ALL');
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const [assessments, setAssessments] = useState<AssessmentProfile[]>(() => {
    try {
      const stored = localStorage.getItem('primehire_assessments');
      if (stored) {
        let parsed = JSON.parse(stored) as AssessmentProfile[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.filter(a => a && a.id && a.jobId);
        }
      }
      return INITIAL_ASSESSMENTS;
    } catch { return INITIAL_ASSESSMENTS; }
  });

  const [candidates, setCandidates] = useState<Candidate[]>(() => {
    try {
      const stored = localStorage.getItem('primehire_candidates');
      if (stored) {
        let parsed = JSON.parse(stored) as Candidate[];
        if (Array.isArray(parsed)) {
          return parsed.filter(c => c && c.id && c.assessmentId);
        }
      }
      return INITIAL_CANDIDATES;
    } catch { return INITIAL_CANDIDATES; }
  });

  const [templates, setTemplates] = useState<MailTemplate[]>(() => {
    try {
      const stored = localStorage.getItem('primehire_templates');
      return stored ? JSON.parse(stored) : INITIAL_TEMPLATES;
    } catch { return INITIAL_TEMPLATES; }
  });

  const handleSetAssessments = (newAsms: AssessmentProfile[] | ((prev: AssessmentProfile[]) => AssessmentProfile[])) => {
    setAssessments(prev => {
      const next = typeof newAsms === 'function' ? newAsms(prev) : newAsms;
      localStorage.setItem('primehire_assessments', JSON.stringify(next));
      return next;
    });
  };

  const handleSetCandidates = (newCands: Candidate[] | ((prev: Candidate[]) => Candidate[])) => {
    setCandidates(prev => {
      const next = typeof newCands === 'function' ? newCands(prev) : newCands;
      localStorage.setItem('primehire_candidates', JSON.stringify(next));
      return next;
    });
  };

  const handleSetTemplates = (newTemplates: MailTemplate[] | ((prev: MailTemplate[]) => MailTemplate[])) => {
    setTemplates(prev => {
      const next = typeof newTemplates === 'function' ? newTemplates(prev) : newTemplates;
      localStorage.setItem('primehire_templates', JSON.stringify(next));
      return next;
    });
  };

  const [isReportOpen, setIsReportOpen] = useState(false);
  const [reportCandidate, setReportCandidate] = useState<Candidate | null>(null);
  const [reportAssessment, setReportAssessment] = useState<AssessmentProfile | null>(null);
  // Phase 3C read cutover: true when the API read failed and the UI is
  // showing localStorage fallback (or empty state in a fresh profile).
  const [apiDown, setApiDown] = useState(false);

  // Preferred source of truth: FastAPI + MongoDB. localStorage stays as the
  // temporary fallback (existing hydrate above) until the write cutover.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [asms, cands] = await Promise.all([fetchAssessments(), fetchCandidates()]);
        if (cancelled) return;
        handleSetAssessments(asms);
        handleSetCandidates(cands);
        setApiDown(false);
        console.info(`[DataSource] assessments: mongodb (${asms.length})`);
        console.info(`[DataSource] candidates: mongodb (${cands.length})`);
      } catch (err) {
        if (cancelled) return;
        setApiDown(true);
        console.warn('[DataSource] assessments: localStorage-fallback (FastAPI unreachable)');
        console.warn('[DataSource] candidates: localStorage-fallback (FastAPI unreachable)', err);
        toast.error('Server unreachable — showing locally cached data.');
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleToggleCandidateStatus = (candidateId: string) => {
    const nextList = candidates.map(c => {
      if (c.id === candidateId) {
        const nextStatus: Candidate['status'] = c.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
        return { ...c, status: nextStatus };
      }
      return c;
    });
    setCandidates(nextList);
    const target = nextList.find(c => c.id === candidateId);
    toast.success(`Candidate ${target?.name} status set to ${target?.status}`);
  };

  const handleOpenCandidateReport = (candidate: Candidate, assessment: AssessmentProfile) => {
    setReportCandidate(candidate);
    setReportAssessment(assessment);
    setIsReportOpen(true);
  };

  const handleReportUpdated = (updatedCandidates: Candidate[]) => {
    setCandidates(updatedCandidates);
    if (reportCandidate) {
      const refreshed = updatedCandidates.find(c => c.id === reportCandidate.id);
      if (refreshed) setReportCandidate(refreshed);
    }
  };

  const handleSaveMailTemplate = (updated: MailTemplate) => {
    const exists = templates.some(t => t.id === updated.id);
    if (exists) {
      setTemplates(templates.map(t => t.id === updated.id ? updated : t));
    } else {
      setTemplates([...templates, updated]);
    }
  };

  // Context Header Info per module
  const getModuleContext = () => {
    switch (activeTab) {
      case 'dashboard':
        return {
          title: 'Executive Portal Dashboard',
          subtitle: 'Operational decision-support overview for assessment throughput, candidate evaluations, and performance metrics.',
        };
      case 'candidates':
        return {
          title: 'Candidate Directory & Pipeline',
          subtitle: 'Centralized directory monitoring candidate evaluation statuses, reports, and credential access.',
        };
      case 'assessments':
        return {
          title: 'Assessment Profiles & Scheduling',
          subtitle: 'Manage evaluation question sets, configure test bounds, and provision interview access links.',
        };
      case 'templates':
        return {
          title: 'Email Templates & Communications',
          subtitle: 'Configure automated invite and reminder email templates with dynamic merge variables.',
        };
      default:
        return {
          title: 'Dashboard Overview',
          subtitle: 'Manage candidate assessment pipeline.',
        };
    }
  };

  const moduleContext = getModuleContext();
  const hasActiveFilters = filterRound !== 'ALL' || filterStatus !== 'ALL' || searchQuery;

  return (
    <div className="min-h-screen bg-gradient-app text-foreground font-sans antialiased">
      {/* fixed radial glows behind content */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0">
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(60rem 40rem at 15% 30%, oklch(0.55 0.2 285 / 0.12), transparent 70%)',
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(50rem 34rem at 85% 65%, oklch(0.7 0.17 150 / 0.10), transparent 70%)',
          }}
        />
      </div>

      {/* ── Collapsing purple header ─────────────────────────── */}
      <header className="sticky top-0 z-30 bg-gradient-primary shadow-[var(--shadow-glow)] text-primary-foreground">
        <div className="max-w-7xl mx-auto px-6">
          {/* top row: brand + mode + mobile toggle */}
          <div
            className={cn(
              'flex items-center justify-between gap-4 transition-all duration-[300ms] ease-out',
              compact ? 'py-2.5 gap-3' : 'py-4 gap-4'
            )}
          >
            <div className="flex items-center gap-3 min-w-0">
              <div
                className={cn(
                  'rounded-xl bg-primary-foreground/10 border border-primary-foreground/15 backdrop-blur flex items-center justify-center text-primary-foreground font-extrabold transition-all duration-[300ms] ease-out shrink-0',
                  compact ? 'w-8 h-8 scale-95' : 'w-10 h-10 scale-100'
                )}
              >
                <Zap className={cn('transition-all duration-[300ms] ease-out', compact ? 'w-4 h-4' : 'w-5 h-5')} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'font-semibold tracking-tight truncate transition-all duration-[300ms] ease-out',
                      compact ? 'text-base' : 'text-lg leading-[1.6rem]'
                    )}
                  >
                    PrimeHire Analytics
                  </span>
                  <span className="inline-flex items-center rounded-full border border-primary-foreground/25 bg-primary-foreground/10 backdrop-blur px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                    v1.0
                  </span>
                </div>
                {/* collapsible eyebrow — never unmounted */}
                <div
                  className={cn(
                    'overflow-hidden transition-all duration-[300ms] ease-out',
                    compact ? 'max-h-0 opacity-0' : 'max-h-6 opacity-100'
                  )}
                >
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary-foreground/70">
                    Placement Analytics · Assignment Portal
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              <div className="hidden sm:flex items-center gap-2.5 pr-1">
                <div className="w-8 h-8 rounded-full bg-primary-foreground/15 border border-primary-foreground/20 flex items-center justify-center font-bold text-xs">
                  PV
                </div>
                <div className="text-left hidden lg:block">
                  <div className="font-semibold text-xs leading-tight">PNS Varma</div>
                  <div className="text-[10px] uppercase tracking-wide text-primary-foreground/70 font-medium">Administrator</div>
                </div>
              </div>
              <ModeToggle />
              <button
                onClick={() => setIsMobileNavOpen(!isMobileNavOpen)}
                aria-label="Toggle navigation"
                className="md:hidden p-2 rounded-full border border-primary-foreground/25 bg-primary-foreground/10 hover:bg-primary-foreground/20 transition cursor-pointer"
              >
                {isMobileNavOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* collapsible title block — never unmounted */}
          <div
            className={cn(
              'overflow-hidden transition-all duration-[300ms] ease-out',
              compact ? 'max-h-0 opacity-0' : 'max-h-40 opacity-100'
            )}
          >
            <div className="pb-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary-foreground/70">
                PrimeHire Agent Module
              </div>
              <h1 className="text-[1.875rem] leading-[2.25rem] font-semibold tracking-tight text-white">
                {moduleContext.title}
              </h1>
              <p className="text-xs sm:text-sm text-primary-foreground/85 max-w-2xl font-medium leading-relaxed">
                {moduleContext.subtitle}
              </p>
            </div>
          </div>

          {/* compact title (visible only when collapsed, kept mounted for animation) */}
          <div
            aria-hidden={!compact}
            className={cn(
              'overflow-hidden transition-all duration-[300ms] ease-out',
              compact ? 'max-h-10 opacity-100 pb-2' : 'max-h-0 opacity-0'
            )}
          >
            <div className="text-sm font-semibold tracking-tight truncate text-white">{moduleContext.title}</div>
          </div>

          {/* desktop module pills */}
          <nav aria-label="Modules" className="hidden md:flex items-center gap-2 pb-3 overflow-x-auto no-scrollbar">
            {MODULE_TABS.map(({ id, short, icon: Icon }) => {
              const isActive = activeTab === id;
              return (
                <button
                  key={id}
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActiveTab(id)}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold border backdrop-blur transition-all duration-200 cursor-pointer whitespace-nowrap',
                    isActive
                      ? 'bg-primary-foreground text-primary border-primary-foreground shadow-[var(--shadow-glow)]'
                      : 'border-primary-foreground/25 bg-primary-foreground/10 text-primary-foreground hover:bg-primary-foreground/20'
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {short}
                </button>
              );
            })}
            <span className="ml-auto hidden lg:inline-flex items-center rounded-full border border-primary-foreground/25 bg-primary-foreground/10 px-2.5 py-1 text-[11px] font-medium tabular-nums">
              {assessments.length} assessments · {candidates.length} candidates
            </span>
          </nav>

          {/* filter row — on-brand glass */}
          <div
            className={cn(
              'flex flex-wrap items-center gap-2 transition-all duration-[300ms] ease-out',
              compact ? 'pb-2.5' : 'pb-4'
            )}
          >
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-primary-foreground/70 mr-1">
              <SlidersHorizontal className="w-3.5 h-3.5" /> Filters
            </span>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-primary-foreground/25 bg-primary-foreground/10 backdrop-blur px-3 py-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-primary-foreground/70">Round</span>
              <select
                aria-label="Round filter"
                value={filterRound}
                onChange={(e) => setFilterRound(e.target.value)}
                className="bg-transparent text-xs font-semibold text-primary-foreground focus:outline-none cursor-pointer [&>option]:text-foreground"
              >
                <option value="ALL">All Rounds</option>
                <option value="BASIC">BASIC</option>
                <option value="TECHNICAL">TECHNICAL</option>
                <option value="HR">HR</option>
              </select>
            </div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-primary-foreground/25 bg-primary-foreground/10 backdrop-blur px-3 py-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-primary-foreground/70">Report</span>
              <select
                aria-label="Report filter"
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="bg-transparent text-xs font-semibold text-primary-foreground focus:outline-none cursor-pointer [&>option]:text-foreground"
              >
                <option value="ALL">All Statuses</option>
                <option value="GENERATED">Evaluated / Generated</option>
                <option value="GENERATING">Generating</option>
                <option value="PENDING">Pending / No Report</option>
              </select>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-primary-foreground/60" />
              <input
                type="text"
                aria-label="Search candidates"
                placeholder="Search candidate or title..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-56 rounded-full border border-primary-foreground/15 bg-primary-foreground/5 backdrop-blur pl-8 pr-8 py-1.5 text-xs text-primary-foreground placeholder:text-primary-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary-foreground/40"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-primary-foreground/70 hover:text-primary-foreground cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {hasActiveFilters && (
              <button
                onClick={() => { setFilterRound('ALL'); setFilterStatus('ALL'); setSearchQuery(''); }}
                className="inline-flex items-center gap-1 rounded-full border border-primary-foreground/25 bg-primary-foreground/10 hover:bg-primary-foreground/20 px-3 py-1.5 text-[11px] font-semibold cursor-pointer transition"
              >
                <RotateCcw className="w-3 h-3" /> Reset
              </button>
            )}
          </div>

          {/* mobile nav */}
          {isMobileNavOpen && (
            <div className="md:hidden pb-3 grid grid-cols-2 gap-2">
              {MODULE_TABS.map(({ id, label, icon: Icon }) => {
                const isActive = activeTab === id;
                return (
                  <button
                    key={id}
                    onClick={() => { setActiveTab(id); setIsMobileNavOpen(false); }}
                    aria-pressed={isActive}
                    className={cn(
                      'flex items-center gap-2 px-3 py-2.5 rounded-2xl text-xs font-semibold border backdrop-blur cursor-pointer transition',
                      isActive
                        ? 'bg-primary-foreground text-primary border-primary-foreground'
                        : 'border-primary-foreground/25 bg-primary-foreground/10 text-primary-foreground'
                    )}
                  >
                    <Icon className="w-4 h-4" /> {label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </header>

      {/* ── Main: selectable cards + single frosted workspace ── */}
      {apiDown && (
        <div className="relative z-10 max-w-7xl w-full mx-auto px-6 pt-4" role="alert">
          <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-2 text-xs font-semibold text-warning">
            Server unreachable — showing locally cached data. Changes may not sync until the connection is restored.
          </div>
        </div>
      )}
      <main className="relative z-10 max-w-7xl w-full mx-auto px-6 py-8 space-y-6">
        {/* selectable domain cards */}
        <div role="tablist" aria-label="Placement domains" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {MODULE_TABS.map(({ id, label, desc, icon: Icon }) => {
            const isActive = activeTab === id;
            const count = id === 'dashboard'
              ? `${assessments.length} profiles`
              : id === 'candidates'
                ? `${candidates.length} records`
                : id === 'assessments'
                  ? `${assessments.length} active`
                  : `${templates.length} templates`;
            return (
              <div key={id} className="relative">
                <button
                  role="tab"
                  aria-selected={isActive}
                  aria-pressed={isActive}
                  onClick={() => setActiveTab(id)}
                  className={cn(
                    'w-full text-left rounded-2xl border p-5 transition-all duration-200 focus-visible:ring-2 focus-visible:ring-ring/40 cursor-pointer',
                    isActive
                      ? 'border-primary bg-card shadow-[var(--shadow-card)] -translate-y-0.5'
                      : 'border-border/70 bg-card shadow-[var(--shadow-card)] hover:-translate-y-0.5 hover:border-primary/40'
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div
                      className={cn(
                        'w-10 h-10 rounded-xl flex items-center justify-center border shrink-0',
                        isActive
                          ? 'bg-gradient-primary text-primary-foreground border-transparent'
                          : 'bg-accent/10 text-accent border-accent/15'
                      )}
                    >
                      <Icon className="w-5 h-5" />
                    </div>
                    {isActive && (
                      <span className="w-5 h-5 rounded-full bg-gradient-primary text-primary-foreground flex items-center justify-center shrink-0 text-[10px] font-bold">
                        ✓
                      </span>
                    )}
                  </div>
                  <div className="mt-3">
                    <div className="text-sm font-semibold text-foreground">{label}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{desc}</div>
                    <div className="mt-2">
                      <Pill tone={isActive ? 'info' : 'neutral'}>{count}</Pill>
                    </div>
                  </div>
                </button>
                {isActive && (
                  <div className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 text-primary" aria-hidden>
                    <div className="w-0 h-0 border-l-8 border-r-8 border-t-8 border-l-transparent border-r-transparent border-t-primary" />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* single frosted workspace per screen */}
        <FrostedDetailPanel panelKey={activeTab}>
          {activeTab === 'dashboard' && (
            <Dashboard
              assessments={assessments}
              candidates={candidates}
              filterRound={filterRound}
              filterStatus={filterStatus}
              searchQuery={searchQuery}
              onNavigate={(tab) => setActiveTab(tab)}
            />
          )}
          {activeTab === 'candidates' && (
            <CandidateManagement
              candidates={candidates}
              assessments={assessments}
              filterRound={filterRound}
              filterStatus={filterStatus}
              searchQuery={searchQuery}
              onToggleCandidateStatus={handleToggleCandidateStatus}
              onOpenReport={handleOpenCandidateReport}
              onSetCandidates={handleSetCandidates}
            />
          )}
          {activeTab === 'assessments' && (
            <AssessmentsAndAssignments
              assessments={assessments}
              candidates={candidates}
              templates={templates}
              onSetAssessments={handleSetAssessments}
              onSetCandidates={handleSetCandidates}
              onOpenReport={handleOpenCandidateReport}
            />
          )}
          {activeTab === 'templates' && (
            <MailTemplates
              templates={templates}
              onSaveTemplate={handleSaveMailTemplate}
            />
          )}
        </FrostedDetailPanel>
      </main>

      {/* Candidate Evaluation Report Workspace */}
      <ReportDialog
        isOpen={isReportOpen}
        candidate={reportCandidate}
        assessment={reportAssessment}
        allCandidates={candidates}
        onClose={() => setIsReportOpen(false)}
        onReportUpdated={handleReportUpdated}
      />

      <Toaster position="bottom-right" />
    </div>
  );
}
