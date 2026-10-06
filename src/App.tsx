/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { INITIAL_ASSESSMENTS, INITIAL_CANDIDATES, INITIAL_TEMPLATES } from './mockData';
import { AssessmentProfile, Candidate, MailTemplate } from './types';
import Dashboard from './components/Dashboard';
import AssessmentsAndAssignments from './components/AssessmentsAndAssignments';
import CandidateManagement from './components/CandidateManagement';
import JobsPage from './components/JobsPage';
import ResumeUploadPage from './components/ResumeUploadPage';
import ApplicantsPage from './components/ApplicantsPage';
import ApplicantProfilePage from './components/ApplicantProfilePage';
import DiagnosticsPage from './components/DiagnosticsPage';
import MailTemplates from './components/MailTemplates';
import ReportDialog from './components/ReportDialog';
import { Toaster } from '@/components/ui/sonner';
import {
  ModeToggle,
} from './components/ui/primitives';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/authContext';
import { PrivateRoute } from './components/auth/PrivateRoute';
import { ImpersonationBanner } from './components/auth/ImpersonationBanner';
import { LoginPage } from './pages/LoginPage';
import { UsersManagementPage } from './pages/UsersManagementPage';
import {
  LayoutDashboard,
  Users,
  Mail,
  Briefcase,
  ClipboardList,
  Upload,
  UserSearch,
  Menu,
  X,
  Shield,
  LogOut,
  Search,
  RotateCcw,
  SlidersHorizontal,
  ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { fetchAssessments, fetchCandidates, updateCandidate, ApiError } from './lib/mongoApi';

const MODULE_TABS = [
  { id: 'dashboard', label: 'Overview', short: 'Overview', icon: LayoutDashboard },
  { id: 'jobs', label: 'Jobs', short: 'Jobs', icon: Briefcase },
  { id: 'candidates', label: 'Candidates', short: 'Candidates', icon: Users },
  { id: 'resumes', label: 'Resume Upload', short: 'Resume Upload', icon: Upload },
  { id: 'applicants', label: 'Applicants', short: 'Applicants', icon: UserSearch },
  { id: 'applicant', label: 'Applicant Profile', short: 'Applicant', icon: UserSearch },
  { id: 'assessments', label: 'Assessments & Profiles', short: 'Assessments', icon: ClipboardList },
  { id: 'templates', label: 'Mail Templates', short: 'Templates', icon: Mail },
];

const NAV_SECTIONS: { heading: string | null; ids: string[] }[] = [
  { heading: null, ids: ['dashboard'] },
  { heading: 'Hiring', ids: ['jobs', 'candidates', 'resumes', 'applicants'] },
  { heading: 'Recruitment', ids: ['assessments', 'templates'] },
  { heading: 'Administration', ids: ['users', 'diagnostics'] },
];

function AdminDashboard() {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [openApplicantId, setOpenApplicantId] = useState<string | null>(null);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  // Deep link from Job Details ("View candidate"): opens the existing
  // applicant-profile tab without creating a parallel navigation flow.
  useEffect(() => {
    const handler = (e: Event) => {
      const applicantId = (e as CustomEvent<{ applicantId?: string }>).detail?.applicantId;
      if (applicantId) {
        setOpenApplicantId(applicantId);
        setActiveTab('applicant');
      }
    };
    window.addEventListener('elite:open-applicant', handler);
    return () => window.removeEventListener('elite:open-applicant', handler);
  }, []);

  const canManageUsers = user?.role === 'super_admin' || user?.role === 'admin';
  const availableTabs = [
    ...MODULE_TABS,
    ...(canManageUsers
      ? [{ id: 'users', label: 'Team & Access', short: 'Team', icon: Shield, desc: 'Manage users, roles & invites' },
         { id: 'diagnostics', label: 'Diagnostics', short: 'Ops', icon: SlidersHorizontal, desc: 'Outbox & worker health' }]
      : []),
  ];

  // Global Filter State (preserved across navigation views)
  const [filterRound, setFilterRound] = useState<string>('ALL');
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const [assessments, setAssessments] = useState<AssessmentProfile[]>(() => {
    try {
      const stored = localStorage.getItem('primehire_assessments');
      let loaded: AssessmentProfile[] = [];
      if (stored) {
        const parsed = JSON.parse(stored) as AssessmentProfile[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          loaded = parsed.filter(a => a && a.id && a.jobId);
        }
      }
      for (const initAsm of INITIAL_ASSESSMENTS) {
        if (!loaded.some(a => a.id === initAsm.id)) {
          loaded.unshift(initAsm);
        }
      }
      return loaded.length > 0 ? loaded : INITIAL_ASSESSMENTS;
    } catch { return INITIAL_ASSESSMENTS; }
  });

  const [candidates, setCandidates] = useState<Candidate[]>(() => {
    try {
      const stored = localStorage.getItem('primehire_candidates');
      let loaded: Candidate[] = [];
      if (stored) {
        const parsed = JSON.parse(stored) as Candidate[];
        if (Array.isArray(parsed)) {
          loaded = parsed.filter(c => c && c.id && c.assessmentId);
        }
      }
      for (const initCand of INITIAL_CANDIDATES) {
        const idx = loaded.findIndex(c => c.id === initCand.id);
        if (idx === -1) {
          loaded.unshift(initCand);
        } else {
          loaded[idx] = { ...initCand, ...loaded[idx], simulatedReport: initCand.simulatedReport };
        }
      }
      return loaded.length > 0 ? loaded : INITIAL_CANDIDATES;
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
  // Distinct from apiDown: the server IS reachable but this role is not
  // allowed to read the directory (HTTP 403). Never misreported as offline.
  const [accessDenied, setAccessDenied] = useState(false);

  // Preferred source of truth: FastAPI + MongoDB. localStorage stays as the
  // temporary fallback (existing hydrate above) until the write cutover.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [asms, cands] = await Promise.all([fetchAssessments(), fetchCandidates()]);
        if (cancelled) return;
        const mergedAsms = [...asms];
        for (const initAsm of INITIAL_ASSESSMENTS) {
          if (!mergedAsms.some(a => a.id === initAsm.id)) {
            mergedAsms.unshift(initAsm);
          }
        }
        const mergedCands = [...cands];
        for (const initCand of INITIAL_CANDIDATES) {
          const idx = mergedCands.findIndex(c => c.id === initCand.id);
          if (idx === -1) {
            mergedCands.unshift(initCand);
          } else {
            mergedCands[idx] = { ...initCand, ...mergedCands[idx], simulatedReport: initCand.simulatedReport };
          }
        }
        handleSetAssessments(mergedAsms);
        handleSetCandidates(mergedCands);
        setApiDown(false);
        setAccessDenied(false);
        console.info(`[DataSource] assessments: mongodb (${asms.length})`);
        console.info(`[DataSource] candidates: mongodb (${cands.length})`);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 403) {
          setAccessDenied(true);
          setApiDown(false);
          console.warn('[DataSource] directory read forbidden for this role — showing locally cached data.');
        } else {
          setApiDown(true);
          setAccessDenied(false);
          console.warn('[DataSource] assessments: localStorage-fallback (FastAPI unreachable)');
          console.warn('[DataSource] candidates: localStorage-fallback (FastAPI unreachable)', err);
          toast.error('Server unreachable — showing locally cached data.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Server-confirmed status change. The server write goes first; the local
  // state only changes when MongoDB confirms (or when the candidate was
  // never persisted, in which case the change is explicitly local-only).
  const handleToggleCandidateStatus = async (candidateId: string) => {
    const target = candidates.find(c => c.id === candidateId);
    if (!target) return;
    const nextStatus: Candidate['status'] = target.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    try {
      const updated = await updateCandidate(candidateId, { status: nextStatus });
      handleSetCandidates(prev => prev.map(c =>
        c.id === candidateId ? { ...updated, candidateStatus: updated.status } : c
      ));
      toast.success(`Candidate ${updated.name} status set to ${updated.status} (saved to server)`);
    } catch (err: any) {
      if (!target.mongoId) {
        handleSetCandidates(prev => prev.map(c =>
          c.id === candidateId ? { ...c, status: nextStatus, candidateStatus: nextStatus } : c
        ));
        toast.warning(`Candidate ${target.name} status set to ${nextStatus} locally only — never saved to server.`);
      } else {
        toast.error(`Save failed (${err?.message || err}) — status not changed.`);
      }
    }
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

  const activeMeta = availableTabs.find(t => t.id === activeTab);
  const hasActiveFilters = filterRound !== 'ALL' || filterStatus !== 'ALL' || searchQuery;

  const tabCount = (id: string): number | null => {
    if (id === 'candidates') return candidates.length;
    if (id === 'assessments' || id === 'jobs') return assessments.length;
    if (id === 'templates') return templates.length;
    return null;
  };

  const goTab = (id: string) => {
    setActiveTab(id);
    setIsMobileNavOpen(false);
  };

  const sidebarNav = (
    <div className="flex h-full flex-col">
      {/* brand */}
      <div className="px-5 pt-6 pb-5">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-primary text-sm font-black text-primary-foreground shadow-[var(--shadow-card)]"
          >
            EH
          </span>
          <span className="text-[19px] font-extrabold tracking-tight text-foreground">Elite HR</span>
        </div>
        <div className="mt-2.5 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
          Hiring Intelligence
        </div>
        <div className="mt-3 h-px bg-border" aria-hidden />
      </div>

      {/* nav */}
      <nav aria-label="Primary" className="flex-1 overflow-y-auto px-3 pb-4">
        {NAV_SECTIONS.map((section) => {
          const items = availableTabs.filter(t => section.ids.includes(t.id));
          if (items.length === 0) return null;
          return (
            <div key={section.heading ?? 'top'} className="mb-1">
              {section.heading && (
                <div className="px-3 pb-1.5 pt-4 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                  {section.heading}
                </div>
              )}
              <ul className="space-y-0.5">
                {items.map(({ id, label, icon: Icon }) => {
                  const isActive = activeTab === id;
                  const count = tabCount(id);
                  return (
                    <li key={id}>
                      <button
                        onClick={() => goTab(id)}
                        aria-current={isActive ? 'page' : undefined}
                        className={cn(
                          'group flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-[13px] font-semibold transition-all duration-150 cursor-pointer',
                          isActive
                            ? 'bg-[var(--primary-soft)] text-foreground shadow-[var(--shadow-card)]'
                            : 'text-muted-foreground hover:bg-[var(--sidebar-accent)] hover:text-foreground'
                        )}
                      >
                        <Icon
                          className={cn(
                            'h-[17px] w-[17px] shrink-0 transition-colors',
                            isActive ? 'text-[var(--accent)]' : 'text-muted-foreground group-hover:text-foreground'
                          )}
                        />
                        <span className="flex-1 truncate text-left">{label}</span>
                        {count !== null && (
                          <span
                            className={cn(
                              'rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums',
                              isActive
                                ? 'bg-primary text-primary-foreground'
                                : 'bg-muted text-muted-foreground'
                            )}
                          >
                            {count}
                          </span>
                        )}
                        {isActive && <ChevronRight className="h-3.5 w-3.5 text-[var(--accent)]" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      {/* user card */}
      <div className="border-t border-border p-3">
        <div className="flex items-center gap-2.5 rounded-[12px] border border-border bg-card px-3 py-2.5 shadow-[var(--shadow-card)]">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-black text-primary-foreground">
            {user?.name ? user.name.slice(0, 2).toUpperCase() : 'SU'}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12.5px] font-bold text-foreground">{user?.name || 'Administrator'}</div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground capitalize">
              {(user?.role || 'admin').replace('_', ' ')}
            </div>
          </div>
          <button
            onClick={logout}
            title="Sign out"
            aria-label="Sign out"
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-[var(--destructive-soft)] hover:text-[var(--destructive)] cursor-pointer"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-app text-foreground font-sans antialiased">
      {/* ── Sidebar (desktop) ─────────────────────────────── */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[264px] border-r border-border bg-[var(--sidebar)] lg:block">
        {sidebarNav}
      </aside>

      {/* ── Sidebar drawer (mobile / tablet) ───────────────── */}
      {isMobileNavOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setIsMobileNavOpen(false)}
            aria-hidden
          />
          <div className="absolute inset-y-0 left-0 w-[280px] border-r border-border bg-[var(--sidebar)] shadow-xl">
            <button
              onClick={() => setIsMobileNavOpen(false)}
              aria-label="Close navigation"
              className="absolute right-3 top-4 rounded-lg p-1.5 text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
            {sidebarNav}
          </div>
        </div>
      )}

      {/* ── Main column ───────────────────────────────────── */}
      <div className="lg:pl-[264px]">
        {/* slim top bar */}
        <header className="sticky top-0 z-20 border-b border-border bg-[var(--sidebar)]/90 backdrop-blur">
          <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
            <button
              onClick={() => setIsMobileNavOpen(true)}
              aria-label="Open navigation"
              className="rounded-lg border border-border bg-card p-2 text-muted-foreground shadow-[var(--shadow-card)] transition-colors hover:text-foreground lg:hidden cursor-pointer"
            >
              <Menu className="h-4 w-4" />
            </button>
            <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1.5 text-[12.5px] sm:flex">
              <span className="font-semibold text-muted-foreground">Hiring</span>
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              <span className="truncate font-bold text-foreground">{activeMeta?.label ?? 'Overview'}</span>
            </nav>
            <div className="relative ml-auto w-full max-w-[220px] sm:max-w-[260px]">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input
                type="text"
                aria-label="Search candidates"
                placeholder="Search candidates…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="ehr-input w-full py-2 pl-8 pr-8 text-[12.5px]"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <ModeToggle />
            <div className="hidden items-center gap-2 md:flex" aria-label="Signed in user">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-[10px] font-black text-primary-foreground">
                {user?.name ? user.name.slice(0, 2).toUpperCase() : 'SU'}
              </div>
              <div className="leading-tight">
                <div className="max-w-[120px] truncate text-[12px] font-bold text-foreground">
                  {user?.name || 'Administrator'}
                </div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground capitalize">
                  {(user?.role || 'admin').replace('_', ' ')}
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* slim filter toolbar */}
        <div className="mx-auto max-w-6xl px-4 pt-4 sm:px-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
              <SlidersHorizontal className="h-3.5 w-3.5" /> Filters
            </span>
            <label className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 shadow-[var(--shadow-card)]">
              <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Round</span>
              <select
                aria-label="Round filter"
                value={filterRound}
                onChange={(e) => setFilterRound(e.target.value)}
                className="cursor-pointer bg-transparent text-xs font-bold text-foreground focus:outline-none"
              >
                <option value="ALL">All Rounds</option>
                <option value="BASIC">BASIC</option>
                <option value="TECHNICAL">TECHNICAL</option>
                <option value="HR">HR</option>
              </select>
            </label>
            <label className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 shadow-[var(--shadow-card)]">
              <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Report</span>
              <select
                aria-label="Report filter"
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="cursor-pointer bg-transparent text-xs font-bold text-foreground focus:outline-none"
              >
                <option value="ALL">All Statuses</option>
                <option value="GENERATED">Evaluated / Generated</option>
                <option value="GENERATING">Generating</option>
                <option value="PENDING">Pending / No Report</option>
              </select>
            </label>
            {hasActiveFilters && (
              <button
                onClick={() => { setFilterRound('ALL'); setFilterStatus('ALL'); setSearchQuery(''); }}
                className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-border bg-card px-3 py-1.5 text-[11px] font-bold text-muted-foreground shadow-[var(--shadow-card)] transition-colors hover:text-foreground"
              >
                <RotateCcw className="h-3 w-3" /> Reset
              </button>
            )}
          </div>
        </div>

        {apiDown && (
          <div className="mx-auto max-w-6xl px-4 pt-4 sm:px-6" role="alert">
            <div className="rounded-xl border border-[var(--warning)]/30 bg-[var(--warning-soft)] px-4 py-2 text-xs font-semibold text-[var(--warning)]">
              Server unreachable — showing locally cached data. Changes may not sync until the connection is restored.
            </div>
          </div>
        )}
        {accessDenied && (
          <div className="mx-auto max-w-6xl px-4 pt-4 sm:px-6" role="alert">
            <div className="rounded-xl border border-border bg-card px-4 py-2 text-xs font-semibold text-muted-foreground shadow-[var(--shadow-card)]">
              Limited access — your role isn&rsquo;t permitted to load some directory data. Showing locally cached data; contact your admin if this looks wrong.
            </div>
          </div>
        )}

        {/* content */}
        <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
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
          {activeTab === 'jobs' && <JobsPage />}
          {activeTab === 'resumes' && <ResumeUploadPage />}
          {activeTab === 'applicants' && (
            <ApplicantsPage onOpen={(id) => { setOpenApplicantId(id); setActiveTab('applicant'); }} />
          )}
          {activeTab === 'applicant' && openApplicantId && (
            <ApplicantProfilePage applicantId={openApplicantId} onBack={() => setActiveTab('applicants')} />
          )}
          {activeTab === 'diagnostics' && <DiagnosticsPage />}
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
          {activeTab === 'users' && <UsersManagementPage />}
        </main>
      </div>

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

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/*"
            element={
              <PrivateRoute>
                <ImpersonationBanner />
                <AdminDashboard />
              </PrivateRoute>
            }
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
