/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { AssessmentProfile, Candidate } from '../types';
import { 
  Cpu, 
  Users, 
  UserCheck, 
  BarChart3, 
  Briefcase, 
  Hourglass, 
  CheckCircle2, 
  TrendingUp, 
  ChevronRight,
  ArrowUpRight,
  ShieldCheck,
  Zap
} from 'lucide-react';

interface DashboardProps {
  assessments: AssessmentProfile[];
  candidates: Candidate[];
  filterRound?: string;
  filterStatus?: string;
  searchQuery?: string;
  onNavigate: (tab: string) => void;
}

export default function Dashboard({ 
  assessments, 
  candidates, 
  filterRound = 'ALL',
  filterStatus = 'ALL',
  searchQuery = '',
  onNavigate 
}: DashboardProps) {
  // Apply active filter state
  const filteredAssessments = assessments.filter(a => {
    const matchesRound = filterRound === 'ALL' || a.roundType === filterRound;
    const matchesSearch = !searchQuery || a.jobTitle.toLowerCase().includes(searchQuery.toLowerCase()) || a.jobId.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesRound && matchesSearch;
  });

  const filteredCandidates = candidates.filter(c => {
    const matchesRound = filterRound === 'ALL' || assessments.find(a => a.id === c.assessmentId)?.roundType === filterRound;
    const matchesStatus = filterStatus === 'ALL' ||
      (filterStatus === 'GENERATED' && c.reportStatus === 'GENERATED') ||
      (filterStatus === 'GENERATING' && c.reportStatus === 'GENERATING') ||
      (filterStatus === 'PENDING' && !c.reportStatus);
    const matchesSearch = !searchQuery || c.name.toLowerCase().includes(searchQuery.toLowerCase()) || c.email.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesRound && matchesStatus && matchesSearch;
  });

  // Compute metrics
  const activeAssessments = assessments.filter(a => a.isActive);
  const activeCandidates = candidates.filter(c => c.status === 'ACTIVE');
  const totalInvitesSent = candidates.filter(c => c.link !== null).length;
  const reportsGenerated = candidates.filter(c => c.reportStatus === 'GENERATED').length;
  const reportsGenerating = candidates.filter(c => c.reportStatus === 'GENERATING').length;

  const technicalCount = assessments.filter(a => a.roundType === 'TECHNICAL').length;
  const basicCount = assessments.filter(a => a.roundType === 'BASIC').length;
  const hrCount = assessments.filter(a => a.roundType === 'HR').length;
  const totalProfiles = assessments.length || 1;

  const techPct = Math.round((technicalCount / totalProfiles) * 100);
  const basicPct = Math.round((basicCount / totalProfiles) * 100);
  const hrPct = Math.round((hrCount / totalProfiles) * 100);

  // Recent assessment records
  const recentAssessments = [...assessments]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 4);

  return (
    <div className="space-y-6 text-[var(--ink)] font-sans">
      
      {/* ── Section Heading ────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="icon-badge">
            <BarChart3 className="w-5 h-5" />
          </div>
          <div>
            <span className="eyebrow block">EXECUTIVE OVERVIEW</span>
            <h2 className="text-xl sm:text-2xl font-extrabold text-[var(--ink)] tracking-tight">
              Performance & Assessment Metrics
            </h2>
            <p className="text-xs text-[var(--muted-ink)] mt-0.5">
              Are candidate evaluation pipelines operating at scale, and are reports generated on schedule?
            </p>
          </div>
        </div>

        <button
          onClick={() => onNavigate('assessments')}
          className="hidden sm:inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[var(--purple-700)] text-white hover:bg-[var(--purple-600)] text-xs font-bold transition shadow-xs cursor-pointer"
        >
          <Zap className="w-4 h-4 text-purple-200" />
          New Assessment
        </button>
      </div>

      {/* ── KPI Blocks Grid (Primary Outcomes & Metrics) ────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* KPI 1: Active Assessments */}
        <div className="ds-card flex flex-col justify-between space-y-4">
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="eyebrow">TOTAL ASSESSMENTS</span>
              <span className="chip chip-purple">{activeAssessments.length} Active</span>
            </div>
            <div className="flex items-baseline gap-2 pt-1">
              <span className="text-3xl font-extrabold tracking-tight text-[var(--ink)]">
                {assessments.length}
              </span>
              <span className="text-xs text-[var(--muted-ink)] font-semibold">profiles</span>
            </div>
          </div>
          <div className="pt-2 border-t border-[var(--line)] flex items-center justify-between text-xs">
            <span className="text-[var(--muted-ink)] text-[11px]">Accepting submissions</span>
            <button
              onClick={() => onNavigate('assessments')}
              className="font-bold text-[var(--purple-700)] hover:underline flex items-center gap-0.5 cursor-pointer text-[11px]"
            >
              View profiles <ArrowUpRight className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* KPI 2: Scheduled Candidates */}
        <div className="ds-card flex flex-col justify-between space-y-4">
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="eyebrow">CANDIDATE PIPELINE</span>
              <span className="chip chip-positive">{activeCandidates.length} Active</span>
            </div>
            <div className="flex items-baseline gap-2 pt-1">
              <span className="text-3xl font-extrabold tracking-tight text-[var(--ink)]">
                {candidates.length}
              </span>
              <span className="text-xs text-[var(--muted-ink)] font-semibold">candidates</span>
            </div>
          </div>
          <div className="pt-2 border-t border-[var(--line)] flex items-center justify-between text-xs">
            <span className="text-[var(--muted-ink)] text-[11px]">{totalInvitesSent} invite links generated</span>
            <button
              onClick={() => onNavigate('candidates')}
              className="font-bold text-[var(--purple-700)] hover:underline flex items-center gap-0.5 cursor-pointer text-[11px]"
            >
              View directory <ArrowUpRight className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* KPI 3: Evaluated Reports */}
        <div className="ds-card flex flex-col justify-between space-y-4">
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="eyebrow">EVALUATED REPORTS</span>
              <span className="chip chip-positive">
                <CheckCircle2 className="w-3 h-3" /> Ready
              </span>
            </div>
            <div className="flex items-baseline gap-2 pt-1">
              <span className="text-3xl font-extrabold tracking-tight text-[var(--ink)]">
                {reportsGenerated}
              </span>
              <span className="text-xs text-[var(--muted-ink)] font-semibold">reports</span>
            </div>
          </div>
          <div className="pt-2 border-t border-[var(--line)] flex items-center justify-between text-xs">
            <span className="text-[var(--muted-ink)] text-[11px]">AI evaluation compiled</span>
            <button
              onClick={() => onNavigate('candidates')}
              className="font-bold text-[var(--purple-700)] hover:underline flex items-center gap-0.5 cursor-pointer text-[11px]"
            >
              Inspect <ArrowUpRight className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* KPI 4: Pending / Processing Reports */}
        <div className="ds-card flex flex-col justify-between space-y-4">
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="eyebrow">REPORT PROCESSING</span>
              {reportsGenerating > 0 ? (
                <span className="chip chip-warning animate-pulse">
                  <Hourglass className="w-3 h-3" /> {reportsGenerating} Active
                </span>
              ) : (
                <span className="chip chip-purple">Queue Clear</span>
              )}
            </div>
            <div className="flex items-baseline gap-2 pt-1">
              <span className="text-3xl font-extrabold tracking-tight text-[var(--ink)]">
                {reportsGenerating}
              </span>
              <span className="text-xs text-[var(--muted-ink)] font-semibold">in progress</span>
            </div>
          </div>
          <div className="pt-2 border-t border-[var(--line)] flex items-center justify-between text-xs">
            <span className="text-[var(--muted-ink)] text-[11px]">Real-time status sync</span>
            <button
              onClick={() => onNavigate('candidates')}
              className="font-bold text-[var(--purple-700)] hover:underline flex items-center gap-0.5 cursor-pointer text-[11px]"
            >
              Monitor <ArrowUpRight className="w-3 h-3" />
            </button>
          </div>
        </div>

      </div>

      {/* ── Evidence & Breakdown Grid ───────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Round Distribution Breakdown */}
        <div className="ds-card lg:col-span-1 space-y-4 flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-[var(--purple-50)] text-[var(--purple-700)] flex items-center justify-center font-bold text-xs">
                <Briefcase className="w-4 h-4" />
              </div>
              <div>
                <span className="eyebrow block">DISTRIBUTION</span>
                <h3 className="text-sm font-bold text-[var(--ink)]">Assessment Round Breakdown</h3>
              </div>
            </div>

            <div className="space-y-3 pt-2">
              {/* Technical */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs font-semibold text-[var(--ink)]">
                  <span>TECHNICAL Round</span>
                  <span className="font-mono text-[var(--purple-700)]">{technicalCount} ({techPct}%)</span>
                </div>
                <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full bg-[var(--purple-600)] rounded-full transition-all" style={{ width: `${techPct}%` }} />
                </div>
              </div>

              {/* Basic */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs font-semibold text-[var(--ink)]">
                  <span>BASIC Round</span>
                  <span className="font-mono text-sky-700">{basicCount} ({basicPct}%)</span>
                </div>
                <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full bg-sky-500 rounded-full transition-all" style={{ width: `${basicPct}%` }} />
                </div>
              </div>

              {/* HR */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs font-semibold text-[var(--ink)]">
                  <span>HR Screening Round</span>
                  <span className="font-mono text-emerald-700">{hrCount} ({hrPct}%)</span>
                </div>
                <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${hrPct}%` }} />
                </div>
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-[var(--line)] text-xs text-[var(--muted-ink)] font-medium">
            Total active registered profiles: <strong className="text-[var(--ink)]">{assessments.length}</strong>
          </div>
        </div>

        {/* Recently Created Profiles Table */}
        <div className="ds-card lg:col-span-2 space-y-4 flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-[var(--purple-50)] text-[var(--purple-700)] flex items-center justify-center font-bold text-xs">
                  <Cpu className="w-4 h-4" />
                </div>
                <div>
                  <span className="eyebrow block">RECENT RECORDS</span>
                  <h3 className="text-sm font-bold text-[var(--ink)]">Active Assessment Profiles</h3>
                </div>
              </div>

              <button
                onClick={() => onNavigate('assessments')}
                className="text-xs font-bold text-[var(--purple-700)] hover:underline cursor-pointer"
              >
                View all &rarr;
              </button>
            </div>

            {/* Table */}
            <div className="overflow-x-auto border border-[var(--line)] rounded-xl">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-[var(--line)] text-[var(--muted-ink)] font-bold uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="py-2.5 px-3">Job Title & ID</th>
                    <th className="py-2.5 px-3">Round</th>
                    <th className="py-2.5 px-3">Created</th>
                    <th className="py-2.5 px-3">Candidates</th>
                    <th className="py-2.5 px-3 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line)]">
                  {recentAssessments.map(a => {
                    const count = candidates.filter(c => c.assessmentId === a.id).length;
                    return (
                      <tr key={a.id} className="hover:bg-slate-50/60 transition-colors">
                        <td className="py-2.5 px-3">
                          <div className="font-bold text-[var(--ink)]">{a.jobTitle}</div>
                          <div className="text-[10px] font-mono text-[var(--muted-ink)]">{a.jobId}</div>
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="chip chip-purple text-[10px] font-mono uppercase">{a.roundType}</span>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[var(--muted-ink)] text-[11px]">
                          {new Date(a.createdAt).toLocaleDateString()}
                        </td>
                        <td className="py-2.5 px-3 font-bold text-[var(--ink)]">
                          {count}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <span className={`chip ${a.isActive ? 'chip-positive' : 'chip-negative'}`}>
                            {a.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {recentAssessments.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-[var(--muted-ink)] italic">
                        No assessment profiles configured yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="pt-2 flex items-center justify-between text-xs text-[var(--muted-ink)]">
            <span>Showing top {recentAssessments.length} recently registered profiles</span>
            <button
              onClick={() => onNavigate('assessments')}
              className="font-bold text-[var(--purple-700)] hover:underline cursor-pointer"
            >
              Configure profiles &rarr;
            </button>
          </div>
        </div>

      </div>

    </div>
  );
}
