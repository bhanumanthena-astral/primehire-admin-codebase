/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { INITIAL_ASSESSMENTS, INITIAL_CANDIDATES, INITIAL_TEMPLATES } from './mockData';
import { primehireClient } from './lib/primehireClient';
import { AssessmentProfile, Candidate, MailTemplate } from './types';
import Dashboard from './components/Dashboard';
import AssessmentsAndAssignments from './components/AssessmentsAndAssignments';
import CandidateManagement from './components/CandidateManagement';
import MailTemplates from './components/MailTemplates';
import ReportDialog from './components/ReportDialog';
import { Toaster } from '@/components/ui/sonner';
import { 
  LayoutDashboard, 
  Users, 
  Mail, 
  Briefcase, 
  ChevronRight, 
  Menu,
  X,
  Zap,
  Plus,
  Download,
  Filter,
  SlidersHorizontal,
  Check,
  RotateCcw
} from 'lucide-react';
import { toast } from 'sonner';

const MODULE_TABS = [
  { id: 'dashboard',   label: 'Dashboard Overview',    icon: LayoutDashboard },
  { id: 'candidates',  label: 'Candidate Directory',   icon: Users },
  { id: 'assessments', label: 'Assessments & Profiles', icon: Briefcase },
  { id: 'templates',   label: 'Mail Templates',        icon: Mail },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

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
          actionLabel: 'Create Assessment',
          actionTab: 'assessments'
        };
      case 'candidates':
        return {
          title: 'Candidate Directory & Pipeline',
          subtitle: 'Centralized directory monitoring candidate evaluation statuses, reports, and credential access.',
          actionLabel: 'Schedule Candidates',
          actionTab: 'assessments'
        };
      case 'assessments':
        return {
          title: 'Assessment Profiles & Scheduling',
          subtitle: 'Manage evaluation question sets, configure test bounds, and provision interview access links.',
          actionLabel: 'New Assessment',
          actionTab: 'assessments'
        };
      case 'templates':
        return {
          title: 'Email Templates & Communications',
          subtitle: 'Configure automated invite and reminder email templates with dynamic merge variables.',
          actionLabel: 'New Template',
          actionTab: 'templates'
        };
      default:
        return {
          title: 'Dashboard Overview',
          subtitle: 'Manage candidate assessment pipeline.',
          actionLabel: 'Action',
          actionTab: 'dashboard'
        };
    }
  };

  const moduleContext = getModuleContext();

  return (
    <div className="min-h-screen flex flex-col font-sans" style={{ background: 'var(--canvas-gradient)' }}>
      
      {/* ════════════════════════════════════════════════════════════════
          BAND 1 — MODULE NAVIGATION (Sticky White Top Bar)
          ════════════════════════════════════════════════════════════════ */}
      <header className="sticky top-0 z-30 bg-white border-b border-[var(--line)] shadow-2xs">
        <div className="max-w-[1180px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          
          {/* Product Identity */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="w-9 h-9 rounded-xl bg-[var(--purple-700)] text-white flex items-center justify-center font-black shadow-xs">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base font-extrabold tracking-tight text-[var(--ink)]">PrimeHire Agent</span>
                <span className="chip chip-purple text-[10px] uppercase font-mono">v1.0 API</span>
              </div>
              <span className="eyebrow block text-[10px]">Assignment & Candidate Portal</span>
            </div>
          </div>

          {/* Module Navigation Tabs (Horizontal scroll on mobile) */}
          <nav className="hidden md:flex items-center gap-1 overflow-x-auto no-scrollbar">
            {MODULE_TABS.map(({ id, label, icon: Icon }) => {
              const isActive = activeTab === id;
              return (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all relative cursor-pointer ${
                    isActive
                      ? 'bg-[var(--purple-50)] text-[var(--purple-700)]'
                      : 'text-[var(--muted-ink)] hover:text-[var(--ink)] hover:bg-slate-50'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? 'text-[var(--purple-600)]' : 'text-slate-400'}`} />
                  <span>{label}</span>
                  {isActive && (
                    <div className="absolute bottom-0 left-3 right-3 h-0.5 bg-[var(--purple-600)] rounded-full" />
                  )}
                </button>
              );
            })}
          </nav>

          {/* User Profile / Mobile Toggle */}
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2.5 pl-3 border-l border-[var(--line)]">
              <div className="w-8 h-8 rounded-full bg-[var(--purple-700)] text-white flex items-center justify-center font-bold text-xs shadow-2xs">
                PV
              </div>
              <div className="text-left text-xs">
                <div className="font-bold text-[var(--ink)] leading-tight">PNS Varma</div>
                <div className="text-[10px] text-[var(--muted-ink)] font-medium">Administrator</div>
              </div>
            </div>

            <button
              onClick={() => setIsMobileNavOpen(!isMobileNavOpen)}
              className="md:hidden p-2 rounded-lg text-slate-600 hover:bg-slate-100 cursor-pointer"
            >
              {isMobileNavOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile Navigation Dropdown */}
        {isMobileNavOpen && (
          <div className="md:hidden border-t border-[var(--line)] bg-white px-4 py-3 space-y-1">
            {MODULE_TABS.map(({ id, label, icon: Icon }) => {
              const isActive = activeTab === id;
              return (
                <button
                  key={id}
                  onClick={() => { setActiveTab(id); setIsMobileNavOpen(false); }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-semibold cursor-pointer ${
                    isActive
                      ? 'bg-[var(--purple-50)] text-[var(--purple-700)]'
                      : 'text-[var(--muted-ink)] hover:bg-slate-50'
                  }`}
                >
                  <Icon className="w-4 h-4 text-[var(--purple-600)]" />
                  {label}
                </button>
              );
            })}
          </div>
        )}
      </header>

      {/* ════════════════════════════════════════════════════════════════
          BAND 2 — MODULE CONTEXT (Purple Branded Header)
          ════════════════════════════════════════════════════════════════ */}
      <section 
        className="py-8 px-4 sm:px-6 shadow-md text-white border-b border-purple-900/30"
        style={{ background: 'linear-gradient(120deg, #3b0764 0%, #581c87 55%, #6b21a8 100%)' }}
      >
        <div className="max-w-[1180px] mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-purple-200 font-mono">
              PRIMEHIRE AGENT MODULE
            </span>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white drop-shadow-xs">
              {moduleContext.title}
            </h1>
            <p className="text-xs sm:text-sm text-purple-100 max-w-2xl font-medium leading-relaxed opacity-95">
              {moduleContext.subtitle}
            </p>
          </div>

        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════
          BAND 3 — MODULE FILTERS (White Separated Filter Bar)
          ════════════════════════════════════════════════════════════════ */}
      <section className="bg-white border-b border-[var(--line)] py-3 px-4 sm:px-6 shadow-2xs">
        <div className="max-w-[1180px] mx-auto flex flex-wrap items-center justify-between gap-3">
          
          {/* Left: Filter dropdowns */}
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <div className="flex items-center gap-1.5 text-[var(--muted-ink)] font-bold text-[11px] uppercase tracking-wider mr-1">
              <SlidersHorizontal className="w-3.5 h-3.5 text-[var(--purple-600)]" />
              Filters:
            </div>

            {/* Filter 1: Round Type */}
            <div className="flex items-center gap-1 bg-slate-50 border border-[var(--line)] rounded-lg px-2.5 py-1.5">
              <span className="text-[10px] font-bold text-[var(--muted-ink)] uppercase">Round:</span>
              <select
                value={filterRound}
                onChange={(e) => setFilterRound(e.target.value)}
                className="bg-transparent text-xs font-bold text-[var(--ink)] focus:outline-hidden cursor-pointer"
              >
                <option value="ALL">All Rounds</option>
                <option value="BASIC">BASIC</option>
                <option value="TECHNICAL">TECHNICAL</option>
                <option value="HR">HR</option>
              </select>
            </div>

            {/* Filter 2: Evaluation Status */}
            <div className="flex items-center gap-1 bg-slate-50 border border-[var(--line)] rounded-lg px-2.5 py-1.5">
              <span className="text-[10px] font-bold text-[var(--muted-ink)] uppercase">Report:</span>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="bg-transparent text-xs font-bold text-[var(--ink)] focus:outline-hidden cursor-pointer"
              >
                <option value="ALL">All Statuses</option>
                <option value="GENERATED">Evaluated / Generated</option>
                <option value="GENERATING">Generating</option>
                <option value="PENDING">Pending / No Report</option>
              </select>
            </div>

            {/* Filter 3: Search text input */}
            <div className="relative min-w-[200px]">
              <input
                type="text"
                placeholder="Search candidate name or title..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-3 pr-8 py-1.5 text-xs rounded-lg border border-[var(--line)] bg-slate-50 text-[var(--ink)] focus:bg-white focus:outline-hidden focus:ring-1 focus:ring-[var(--purple-500)]"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-2 text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {(filterRound !== 'ALL' || filterStatus !== 'ALL' || searchQuery) && (
              <button
                onClick={() => {
                  setFilterRound('ALL');
                  setFilterStatus('ALL');
                  setSearchQuery('');
                }}
                className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-600 hover:underline cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                Reset
              </button>
            )}
          </div>

          {/* Right: Directory Summary note */}
          <div className="text-[11px] font-medium text-[var(--muted-ink)]">
            Active Assessments: <strong className="text-[var(--ink)]">{assessments.length}</strong> • Total Candidates: <strong className="text-[var(--ink)]">{candidates.length}</strong>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════
          MAIN CONTENT AREA (Max Width 1180px, Responsive Padding)
          ════════════════════════════════════════════════════════════════ */}
      <main className="flex-1 max-w-[1180px] w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
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
