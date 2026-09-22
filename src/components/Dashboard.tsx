/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { AssessmentProfile, Candidate } from '../types';
import {
  BarChart3,
  Briefcase,
  Cpu,
  CheckCircle2,
  Hourglass,
  Zap,
} from 'lucide-react';
import {
  SectionHeader,
  Panel,
  PanelTitle,
  Stat,
  Pill,
  Bar,
  PAButton,
  IconSquare,
  ViewMoreButton,
  EmptyNote,
} from './ui/primitives';

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
    <div className="space-y-6 text-foreground font-sans">
      <SectionHeader
        eyebrow="Executive overview"
        title="Performance & Assessment Metrics"
        subtitle="Are candidate evaluation pipelines operating at scale, and are reports generated on schedule?"
        icon={<BarChart3 className="w-5 h-5" />}
        action={
          <PAButton onClick={() => onNavigate('assessments')} className="hidden sm:inline-flex">
            <Zap className="w-4 h-4" /> New Assessment
          </PAButton>
        }
      />

      {/* ── KPI strip: 1 / 2 / 4 ─────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Stat
          label="Total assessments"
          value={assessments.length}
          unit="profiles"
          pill={<Pill tone="info">{activeAssessments.length} Active</Pill>}
          footer="Accepting submissions"
          action={<ViewMoreButton onClick={() => onNavigate('assessments')}>View profiles</ViewMoreButton>}
        />
        <Stat
          label="Candidate pipeline"
          value={candidates.length}
          unit="candidates"
          pill={<Pill tone="success">{activeCandidates.length} Active</Pill>}
          footer={`${totalInvitesSent} invite links generated`}
          action={<ViewMoreButton onClick={() => onNavigate('candidates')}>View directory</ViewMoreButton>}
        />
        <Stat
          label="Evaluated reports"
          value={reportsGenerated}
          unit="reports"
          pill={<Pill tone="success"><CheckCircle2 className="w-3 h-3" /> Ready</Pill>}
          footer="AI evaluation compiled"
          action={<ViewMoreButton onClick={() => onNavigate('candidates')}>Inspect</ViewMoreButton>}
        />
        <Stat
          label="Report processing"
          value={reportsGenerating}
          unit="in progress"
          pill={
            reportsGenerating > 0
              ? <Pill tone="warning"><Hourglass className="w-3 h-3" /> {reportsGenerating} Active</Pill>
              : <Pill tone="neutral">Queue Clear</Pill>
          }
          footer="Real-time status sync"
          action={<ViewMoreButton onClick={() => onNavigate('candidates')}>Monitor</ViewMoreButton>}
        />
      </div>

      {/* ── Evidence grid ────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Round distribution */}
        <Panel className="lg:col-span-1 flex flex-col justify-between gap-4">
          <div className="space-y-4">
            <div className="flex items-center gap-2.5">
              <IconSquare><Briefcase className="w-4 h-4" /></IconSquare>
              <div>
                <span className="eyebrow block">Distribution</span>
                <PanelTitle>Assessment Round Breakdown</PanelTitle>
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs font-semibold">
                  <span className="text-foreground">Technical Round</span>
                  <span className="tnum tabular-nums text-accent">{technicalCount} ({techPct}%)</span>
                </div>
                <Bar value={techPct} color="var(--chart-2)" countLabel={`${techPct}%`} />
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs font-semibold">
                  <span className="text-foreground">Basic Round</span>
                  <span className="tnum tabular-nums text-accent">{basicCount} ({basicPct}%)</span>
                </div>
                <Bar value={basicPct} color="var(--chart-1)" countLabel={`${basicPct}%`} />
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs font-semibold">
                  <span className="text-foreground">HR Screening Round</span>
                  <span className="tnum tabular-nums text-accent">{hrCount} ({hrPct}%)</span>
                </div>
                <Bar value={hrPct} color="var(--chart-4)" countLabel={`${hrPct}%`} />
              </div>
            </div>
          </div>
          <div className="pt-3 border-t border-border/60 text-xs text-muted-foreground">
            Total active registered profiles: <strong className="text-foreground tnum tabular-nums">{assessments.length}</strong>
          </div>
        </Panel>

        {/* Recent profiles */}
        <Panel padded={false} className="lg:col-span-2 flex flex-col justify-between overflow-hidden">
          <div className="p-5 sm:p-6 pb-0 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <IconSquare><Cpu className="w-4 h-4" /></IconSquare>
                <div>
                  <span className="eyebrow block">Recent records</span>
                  <PanelTitle>Active Assessment Profiles</PanelTitle>
                </div>
              </div>
              <ViewMoreButton onClick={() => onNavigate('assessments')}>View all →</ViewMoreButton>
            </div>
          </div>

          <div className="px-5 sm:px-6">
            <div className="rounded-lg border border-border/60 overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-card sticky top-0 z-10 text-muted-foreground text-xs uppercase tracking-wider font-medium border-b border-border/60">
                  <tr>
                    <th className="py-2.5 px-3">Job Title & ID</th>
                    <th className="py-2.5 px-3">Round</th>
                    <th className="py-2.5 px-3">Created</th>
                    <th className="py-2.5 px-3 tnum">Candidates</th>
                    <th className="py-2.5 px-3 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {recentAssessments.map(a => {
                    const count = candidates.filter(c => c.assessmentId === a.id).length;
                    return (
                      <tr key={a.id} className="transition-opacity duration-200 hover:bg-muted/40">
                        <td className="py-2.5 px-3">
                          <div className="font-semibold text-foreground text-sm">{a.jobTitle}</div>
                          <div className="text-[10px] uppercase tracking-wide font-mono text-muted-foreground">{a.jobId}</div>
                        </td>
                        <td className="py-2.5 px-3">
                          <Pill tone="neutral"><span className="font-mono uppercase text-[10px]">{a.roundType}</span></Pill>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-muted-foreground text-xs tnum tabular-nums">
                          {new Date(a.createdAt).toLocaleDateString()}
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-foreground tnum tabular-nums">
                          {count}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <Pill tone={a.isActive ? 'success' : 'neutral'}>
                            {a.isActive ? 'Active' : 'Inactive'}
                          </Pill>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {recentAssessments.length === 0 && (
                <EmptyNote>No assessment profiles configured yet.</EmptyNote>
              )}
            </div>
          </div>

          <div className="p-5 sm:p-6 pt-3 flex items-center justify-between text-xs text-muted-foreground">
            <span className="tnum tabular-nums">Showing top {recentAssessments.length} recently registered profiles</span>
            <ViewMoreButton onClick={() => onNavigate('assessments')}>Configure profiles →</ViewMoreButton>
          </div>
        </Panel>
      </div>
    </div>
  );
}
