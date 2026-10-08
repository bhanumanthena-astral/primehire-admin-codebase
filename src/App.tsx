/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { INITIAL_CANDIDATES, INITIAL_TEMPLATES } from './mockData';
import { AssessmentProfile, Candidate, MailTemplate } from './types';
import Dashboard from './components/Dashboard';
import AssessmentsAndAssignments from './components/AssessmentsAndAssignments';
import CandidateManagement from './components/CandidateManagement';
import MailTemplates from './components/MailTemplates';
import ReportDialog from './components/ReportDialog';
import { Toaster } from '@/components/ui/sonner';
import {
  FrostedDetailPanel,
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
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { fetchAssessments, fetchCandidates, updateCandidate, API_BASE, fetchHealth, fetchTemplates, createTemplate, updateTemplate, deleteTemplate } from './lib/mongoApi';

const MODULE_TABS = [
  { id: 'dashboard', label: 'Dashboard Overview', short: 'Overview', icon: LayoutDashboard, desc: 'Throughput & evaluation metrics' },
  { id: 'candidates', label: 'Candidate Directory', short: 'Candidates', icon: Users, desc: 'Pipeline, reports & credentials' },
  { id: 'assessments', label: 'Assessments & Profiles', short: 'Assessments', icon: Briefcase, desc: 'Profiles, scheduling & links' },
  { id: 'templates', label: 'Mail Templates', short: 'Templates', icon: Mail, desc: 'Invites & reminder sequences' },
];

/**
 * Scroll-driven header state WITHOUT a scroll feedback loop.
 *
 * Previous implementation read window.scrollY and toggled a header whose own
 * height depended on that state (collapsing ~90-120px of title/padding while
 * stuck). Resizing a sticky element's in-flow placeholder above the viewport
 * makes Chrome scroll-anchoring adjust window.scrollY, which re-crossed the
 * 72/32 thresholds — an oscillation (flicker) the 40px hysteresis band could
 * never absorb, since the height delta exceeded the band.
 *
 * Now: a 1px × 72px sentinel sits at document top in normal flow, positioned
 * BEFORE all header chrome. An IntersectionObserver maps
 * "sentinel visible ⇒ expanded / sentinel out ⇒ compact". Nothing the header
 * does (it is fixed-height in every state) can move the sentinel or the
 * scroll position, so the threshold crossing is strictly user-driven and can
 * fire only once per crossing. No scroll listener, no rAF, no DOM reads.
 */
function useCompactHeader(thresholdPx = 72) {
  const [compact, setCompact] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;

    // Legacy fallback (no layout dependency on header state either).
    if (typeof IntersectionObserver === 'undefined') {
      let raf = 0;
      const update = () => {
        raf = 0;
        setCompact(window.scrollY > thresholdPx);
      };
      const onScroll = () => {
        if (!raf) raf = requestAnimationFrame(update);
      };
      window.addEventListener('scroll', onScroll, { passive: true });
      setCompact(window.scrollY > thresholdPx);
      return () => {
        window.removeEventListener('scroll', onScroll);
        if (raf) cancelAnimationFrame(raf);
      };
    }

    // Fires on mount too, so a refresh while scrolled restores correctly.
    // React bails out when the value is unchanged — no render churn.
    const io = new IntersectionObserver(
      (entries) => {
        setCompact(!(entries[0]?.isIntersecting ?? true));
      },
      { threshold: 0 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [thresholdPx]);

  return { compact, sentinelRef };
}

export default function App() {
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const { compact, sentinelRef } = useCompactHeader();

  // Global Filter State (preserved across navigation views)
  const [filterRound, setFilterRound] = useState<string>('ALL');
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Slice 2A: assessments are server-truth only. No localStorage read here —
  // the list loads from FastAPI on mount (loading state until then) and
  // syncs on focus + every 30s. localStorage acts as cache so counts are instantly
  // available on page load.
  const [assessments, setAssessments] = useState<AssessmentProfile[]>(() => {
    try {
      const stored = localStorage.getItem('primehire_assessments');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch { /* ignore */ }
    return [];
  });
  const [assessmentsLoading, setAssessmentsLoading] = useState(true);
  const [assessmentsError, setAssessmentsError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

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

  // Server-truth setter with localStorage cache. Accepts a full list or an
  // updater; used for sync merges and server-confirmed writes.
  const handleSetAssessments = (newAsms: AssessmentProfile[] | ((prev: AssessmentProfile[]) => AssessmentProfile[])) => {
    setAssessments(prev => {
      const next = typeof newAsms === 'function' ? newAsms(prev) : newAsms;
      try {
        localStorage.setItem('primehire_assessments', JSON.stringify(next));
      } catch { /* ignore */ }
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
  const [apiError, setApiError] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [backendMeta, setBackendMeta] = useState<{ url: string; db: string | null; counts?: Record<string, number> } | null>(null);

  const candidatesRef = useRef(candidates);
  candidatesRef.current = candidates;
  const templatesRef = useRef(templates);
  templatesRef.current = templates;
  const assessmentsRef = useRef(assessments);
  assessmentsRef.current = assessments;

  const loadAbortRef = useRef<AbortController | null>(null);
  const loadInFlightRef = useRef(false);
  const lastSyncedRef = useRef<string | null>(null);

  // Assessments sync (stale-while-revalidate, no manual refresh):
  // - Full load on app mount and when returning to the Assessments tab with
  //   stale cache. Full replace is authoritative: it propagates creates,
  //   edits, deactivations AND deletions by any user (incremental `since`
  //   merges can only upsert — the backend hides soft-deleted records).
  // - Cheap incremental (`since`) merge on window focus + 30s poll.
  // - Mutations update their record from the server response directly.
  // Never overlaps (loadInFlightRef); out-of-order responses are dropped by
  // sequence number; errors preserve good state (a successful empty list IS
  // the truth — only errors preserve state).
  const ASSESSMENT_STALE_MS = 45000;
  const assessSeqRef = useRef(0);

  const isAssessmentsFresh = () => {
    if (assessmentsRef.current.length === 0 || !lastSyncedRef.current) return false;
    return Date.now() - new Date(lastSyncedRef.current).getTime() < ASSESSMENT_STALE_MS;
  };

  const loadAssessments = async (opts?: { incremental?: boolean; signal?: AbortSignal }) => {
    const seq = ++assessSeqRef.current;
    const params: { since?: string; signal?: AbortSignal } = {};
    if (opts?.signal) params.signal = opts.signal;
    if (opts?.incremental && lastSyncedRef.current) params.since = lastSyncedRef.current;
    const fresh = await fetchAssessments(params);
    if (seq !== assessSeqRef.current) return fresh; // a newer load won: drop this response
    setAssessments(prev => {
      let next: AssessmentProfile[];
      if (!opts?.incremental || !lastSyncedRef.current) {
        next = fresh;
      } else if (fresh.length === 0) {
        return prev; // unchanged data costs a cheap empty page
      } else {
        const byId = new Map<string, AssessmentProfile>(prev.map(a => [a.id, a]));
        for (const a of fresh) byId.set(a.id, a);
        next = [...byId.values()];
      }
      try {
        localStorage.setItem('primehire_assessments', JSON.stringify(next));
      } catch { /* ignore */ }
      return next;
    });
    const nowIso = new Date().toISOString();
    lastSyncedRef.current = nowIso;
    setLastSyncedAt(nowIso);
    setAssessmentsError(null);
    setApiDown(false);
    return fresh;
  };

  // Stale-gated revalidation entry point for tab returns, focus, and polling.
  // Cache shows immediately; a request fires only when stale. `full` replaces
  // the list (delete-safe); incremental merges cheaply. `force` bypasses the
  // gate (used by the error-state Retry action).
  const revalidateAssessments = (opts?: { full?: boolean; force?: boolean }) => {
    if (loadInFlightRef.current) return; // a full load is already running
    if (!opts?.force && isAssessmentsFresh()) return; // cache fresh: no request
    if (opts?.full) {
      const wasEmpty = assessmentsRef.current.length === 0;
      if (wasEmpty) setAssessmentsLoading(true); // skeleton only when nothing to show
      void loadAssessments()
        .catch((err: any) => {
          if (wasEmpty) setAssessmentsError(err?.message || 'Server unreachable');
        })
        .finally(() => {
          if (wasEmpty) setAssessmentsLoading(false);
        });
    } else {
      void loadAssessments({ incremental: assessmentsRef.current.length > 0 }).catch(() => {});
    }
  };

  const loadData = async (refreshSignal?: AbortSignal) => {
    if (loadInFlightRef.current) return; // no overlapping requests
    loadInFlightRef.current = true;
    setIsRetrying(true);
    try {
      const [health, cands] = await Promise.all([
        fetchHealth().catch(() => null),
        fetchCandidates().catch(err => {
          console.warn('[DataSource] Failed to fetch candidates:', err);
          return [];
        }),
      ]);
      await loadAssessments({ signal: refreshSignal });

      if (health) {
        setBackendMeta({ url: API_BASE, db: health.database || 'unknown', counts: health.counts });
        console.info(`[Backend] Connected to ${API_BASE} (database: '${health.database || 'none'}')`, health.counts);
      } else {
        setBackendMeta({ url: API_BASE, db: 'unreachable' });
      }

      const prevCandsCount = candidatesRef.current.length;

      // Never wipe candidates if server returned 0 while local state has items
      // (Slice 2B removes this guard when candidates become server-truth).
      if (cands.length === 0 && prevCandsCount > 0) {
        console.warn(
          `[DataSource Warning] Server at ${API_BASE} returned 0 candidates, but local state has ${prevCandsCount} candidates. Refusing to overwrite local state!`
        );
        setApiError(
          `Connected to ${API_BASE} (db: ${health?.database || 'none'}), but server returned 0 items. Kept local data.`
        );
      } else {
        handleSetCandidates(cands);
        setApiError(null);
        setApiDown(false);
        console.info(`[DataSource] candidates: mongodb (${cands.length})`);
      }
      console.info(`[DataSource] assessments: mongodb`);
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      // Distinguish assessment errors (server-truth: show error, keep state)
      // from total failure.
      setAssessmentsError(err?.message || 'Server unreachable');
      setApiDown(true);
      setApiError(err?.message || 'Server unreachable');
      console.warn('[DataSource] API read failed — preserving current state:', err);
      toast.error('Server unreachable — showing last synced data.');
    } finally {
      loadInFlightRef.current = false;
      setIsRetrying(false);
      setAssessmentsLoading(false);
    }
    // Independent step: template sync must run even when the
    // candidates/assessments load above fails — it has its own fallback.
    await loadTemplatesFromServer();
  };

  useEffect(() => {
    void loadData();
    // Stale-gated background sync: focus + 30s poll refetch only when the
    // cache is older than ASSESSMENT_STALE_MS (cheap incremental merge).
    const onRefocus = () => {
      if (document.visibilityState !== 'visible') return;
      revalidateAssessments();
    };
    window.addEventListener('focus', onRefocus);
    document.addEventListener('visibilitychange', onRefocus);
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        revalidateAssessments();
      }
    }, 30000);
    return () => {
      window.removeEventListener('focus', onRefocus);
      document.removeEventListener('visibilitychange', onRefocus);
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Returning to the Assessments or Dashboard tab revalidates with an authoritative full
  // load when stale (propagates other users' creates/edits/deletes); fresh
  // cache shows instantly with zero network requests.
  useEffect(() => {
    if (activeTab === 'assessments' || activeTab === 'dashboard') {
      revalidateAssessments({ full: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Force full reload. No longer bound to any visible Refresh button — used
  // only by the error-state Retry action and conflict-recovery toast actions.
  const handleRefreshAssessments = () => {
    void loadData();
  };

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

  // Shared templates: MongoDB is the source of truth so every user sees
  // the same list; localStorage stays as an offline cache only.
  // Templates created while on old code (or offline) exist only locally —
  // adopt them into the server so they become shared instead of lost.
  const loadTemplatesFromServer = async () => {
    try {
      let server = await fetchTemplates();
      const local = templatesRef.current.length > 0 ? templatesRef.current : INITIAL_TEMPLATES;
      const serverIds = new Set(server.map(t => t.id));
      const missing = local.filter(t => t && t.id && !serverIds.has(t.id));
      for (const t of missing) {
        // 409 = another profile seeded/adopted it concurrently: keep server's.
        try { await createTemplate(t); } catch { /* duplicate or validation: skip */ }
      }
      if (missing.length > 0) {
        server = await fetchTemplates();
      }
      if (server.length === 0) return; // keep local cache
      handleSetTemplates(server);
      console.info(`[DataSource] templates: mongodb (${server.length})`);
    } catch {
      console.warn('[DataSource] templates API unreachable — keeping local cache.');
    }
  };

  // Server-confirmed save: create or update in MongoDB, then sync state
  // (which also refreshes the localStorage cache). Offline saves stay
  // local-only with a warning that other users cannot see them yet.
  const handleSaveMailTemplate = async (updated: MailTemplate) => {
    const mergeSaved = (saved: MailTemplate) => {
      handleSetTemplates(prev => {
        const exists = prev.some(t => t.id === saved.id);
        if (exists) {
          return prev.map(t => (t.id === saved.id ? saved : t));
        }
        return [...prev, saved];
      });
    };
    try {
      let saved: MailTemplate;
      try {
        saved = await updateTemplate(updated.id, updated);
      } catch (err: any) {
        if (err?.status === 404) {
          try {
            saved = await createTemplate(updated);
          } catch (createErr: any) {
            if (createErr?.status === 409) {
              saved = await updateTemplate(updated.id, updated);
            } else {
              throw createErr;
            }
          }
        } else {
          throw err;
        }
      }
      mergeSaved(saved);
    } catch {
      mergeSaved(updated);
      toast.warning('Template saved locally only — server unreachable. Other users cannot see it yet.');
    }
  };

  // Server-first delete: the Mongo record is removed only on server success —
  // a failed delete keeps the template with an error.
  const handleDeleteMailTemplate = async (id: string) => {
    try {
      await deleteTemplate(id);
      handleSetTemplates(prev => prev.filter(t => t.id !== id));
      toast.success('Template deleted from the server.');
    } catch (err: any) {
      toast.error(`Delete failed on server (${err?.message || err}) — template kept.`);
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
    <div className="relative min-h-screen bg-gradient-app text-foreground font-sans antialiased">
      {/* Scroll sentinel: a layout-independent 72px threshold marker pinned to
          document top, ahead of all header chrome. The sticky bars below keep
          a constant height in every state, so header state can never move this
          marker or the scroll position — threshold crossings are strictly
          user-driven (one transition per crossing, no oscillation). */}
      <div
        ref={sentinelRef}
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-0 h-[72px] w-px"
      />
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

      {/* ── Sticky brand bar — FIXED h-16 in every state. Scroll state drives
          only opacity/transform cues inside it (mini-title fade, logo scale),
          never height/padding, so sticking it cannot shift page layout. ── */}
      <header className="sticky top-0 z-30 bg-gradient-primary text-primary-foreground shadow-[var(--shadow-glow)]">
        <div className="max-w-7xl mx-auto px-6">
          <div className="relative flex items-center justify-between gap-3 h-16">
            <div className="flex items-center gap-3 min-w-0">
              <div
                className={cn(
                  'rounded-xl bg-primary-foreground/10 border border-primary-foreground/15 backdrop-blur flex items-center justify-center text-primary-foreground font-extrabold shrink-0 w-10 h-10 transition-transform duration-300 ease-out',
                  compact ? 'scale-95' : 'scale-100'
                )}
              >
                <Zap className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold tracking-tight truncate text-lg leading-[1.6rem]">
                    PrimeHire Analytics
                  </span>
                  <span className="inline-flex items-center rounded-full border border-primary-foreground/25 bg-primary-foreground/10 backdrop-blur px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                    v1.0
                  </span>
                </div>
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary-foreground/70">
                  Placement Analytics · Assignment Portal
                </span>
              </div>
            </div>

            {/* Mini module title: absolute + opacity-only, so it reserves no
                space and fades without touching layout. aria-hidden because
                the hero below owns the real H1. */}
            <div
              aria-hidden="true"
              className={cn(
                'pointer-events-none absolute left-1/2 top-1/2 hidden lg:block max-w-md -translate-x-1/2 -translate-y-1/2 truncate text-sm font-semibold tracking-tight text-white transition-opacity duration-300',
                compact ? 'opacity-100' : 'opacity-0'
              )}
            >
              {moduleContext.title}
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
              <button
                onClick={() => setIsMobileNavOpen(!isMobileNavOpen)}
                aria-label="Toggle navigation"
                className="md:hidden p-2 rounded-full border border-primary-foreground/25 bg-primary-foreground/10 hover:bg-primary-foreground/20 transition cursor-pointer"
              >
                {isMobileNavOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* ── Static hero: module title lives in normal flow and scrolls away
          under the opaque sticky bar. It is never collapsed by scroll state,
          so there is exactly one H1 and no ghost heading behind the nav. ── */}
      <div className="bg-gradient-primary text-primary-foreground">
        <div className="max-w-7xl mx-auto px-6 pb-4">
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

      {/* ── Sticky module pills — fixed h-12, sticks under the brand bar ── */}
      <nav aria-label="Modules" className="sticky top-16 z-30 hidden md:block bg-gradient-primary text-primary-foreground">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex items-center gap-2 h-12 overflow-x-auto no-scrollbar">
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
          </div>
        </div>
      </nav>

      {/* ── Sticky filter row — sticks under pills on desktop (top-28 =
          64px brand + 48px pills), directly under the brand bar on mobile
          where pills are hidden. Constant padding; never resized by scroll. */}
      <div className="sticky top-16 md:top-28 z-30 bg-gradient-primary text-primary-foreground shadow-[var(--shadow-glow)]">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex flex-wrap items-center gap-2 py-3">
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
      </div>

      {/* ── Main: selectable cards + single frosted workspace ── */}
      {(apiDown || apiError) && (
        <div className="relative z-10 max-w-7xl w-full mx-auto px-6 pt-4" role="alert">
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-300 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className="font-bold uppercase tracking-wider text-[10px] bg-rose-500/20 text-rose-200 px-2 py-0.5 rounded">
                Data Notice
              </span>
              <span>{apiError || 'Server unreachable — preserving locally cached data.'}</span>
            </div>
            <button
              onClick={() => { void loadData(); }}
              disabled={isRetrying}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold transition disabled:opacity-50 cursor-pointer text-xs shrink-0"
            >
              <RefreshCw className={cn('w-3.5 h-3.5', isRetrying && 'animate-spin')} />
              {isRetrying ? 'Retrying...' : 'Retry'}
            </button>
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
              onInspectEvaluated={() => { setFilterStatus('GENERATED'); setActiveTab('candidates'); }}
              onMonitorProcessing={() => { setFilterStatus('GENERATING'); setActiveTab('candidates'); }}
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
              globalRoundFilter={filterRound}
              globalSearchQuery={searchQuery}
              assessmentsLoading={assessmentsLoading}
              assessmentsError={assessmentsError}
              lastSyncedAt={lastSyncedAt}
              onRefreshAssessments={handleRefreshAssessments}
              onSetAssessments={handleSetAssessments}
              onSetCandidates={handleSetCandidates}
              onOpenReport={handleOpenCandidateReport}
            />
          )}
          {activeTab === 'templates' && (
            <MailTemplates
              templates={templates}
              searchQuery={searchQuery}
              onSaveTemplate={handleSaveMailTemplate}
              onDeleteTemplate={handleDeleteMailTemplate}
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
