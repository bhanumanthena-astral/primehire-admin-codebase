/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { AssessmentProfile, Candidate } from '../types';
import {
  Briefcase,
  Users,
  Send,
  CheckCircle2,
  Hourglass,
  Sparkles,
  FileText,
  ArrowRight,
  CircleAlert,
} from 'lucide-react';
import {
  Panel,
  PanelTitle,
  PanelSubtitle,
  Stat,
  Pill,
  Bar,
  PAButton,
  IconSquare,
  ViewMoreButton,
  EmptyNote,
} from './ui/primitives';
import { useAuth } from '../lib/authContext';

interface DashboardProps {
  assessments: AssessmentProfile[];
  candidates: Candidate[];
  filterRound?: string;
  filterStatus?: string;
  searchQuery?: string;
  onNavigate: (tab: string) => void;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
}

interface ActivityItem {
  key: string;
  date: string;
  sortKey: number;
  title: string;
  detail: string;
  tone: 'peach' | 'neutral';
}

export default function Dashboard({
  assessments,
  candidates,
  onNavigate,
}: DashboardProps) {
  const { user } = useAuth();
  const firstName = (user?.name || 'there').split(' ')[0];

  // ── Metrics (same source data as before) ──
  const activeAssessments = assessments.filter(a => a.isActive);
  const activeCandidates = candidates.filter(c => c.status === 'ACTIVE');
  const totalInvitesSent = candidates.filter(c => c.link !== null).length;
  const reportsGenerated = candidates.filter(c => c.reportStatus === 'GENERATED').length;
  const reportsGenerating = candidates.filter(c => c.reportStatus === 'GENERATING').length;
  const awaiting = candidates.filter(c => !c.reportStatus).length;
  const pendingInvites = candidates.filter(c => c.link === null);

  const technicalCount = assessments.filter(a => a.roundType === 'TECHNICAL').length;
  const basicCount = assessments.filter(a => a.roundType === 'BASIC').length;
  const hrCount = assessments.filter(a => a.roundType === 'HR').length;
  const totalProfiles = assessments.length || 1;

  const techPct = Math.round((technicalCount / totalProfiles) * 100);
  const basicPct = Math.round((basicCount / totalProfiles) * 100);
  const hrPct = Math.round((hrCount / totalProfiles) * 100);

  const assessmentById = new Map(assessments.map(a => [a.id, a]));
  const jobOf = (c: Candidate) => assessmentById.get(c.assessmentId)?.jobTitle ?? 'Unknown role';

  // ── Pipeline journey (honest counts from existing fields) ──
  const stages = [
    { label: 'Resumes', value: candidates.length, icon: FileText, hint: 'in pipeline' },
    { label: 'Invited', value: totalInvitesSent, icon: Send, hint: 'links sent' },
    { label: 'Evaluated', value: reportsGenerated, icon: CheckCircle2, hint: 'reports ready' },
    { label: 'Awaiting', value: awaiting, icon: Hourglass, hint: 'no report yet' },
  ];

  // ── Recent activity timeline ──
  const activity: ActivityItem[] = [
    ...assessments.map(a => ({
      key: `asm-${a.id}`,
      date: a.createdAt,
      sortKey: new Date(a.createdAt).getTime(),
      title: `New ${a.roundType.toLowerCase()} profile · ${a.jobTitle}`,
      detail: a.isActive ? 'Accepting submissions' : 'Inactive profile',
      tone: 'peach' as const,
    })),
    ...candidates
      .filter(c => c.submittedDate)
      .map(c => ({
        key: `sub-${c.id}`,
        date: c.submittedDate as string,
        sortKey: new Date(c.submittedDate as string).getTime(),
        title: `${c.name} submitted assessment`,
        detail: jobOf(c),
        tone: 'neutral' as const,
      })),
    ...candidates
      .filter(c => c.lastInviteSentAt || c.inviteSentAt)
      .map(c => ({
        key: `inv-${c.id}`,
        date: (c.lastInviteSentAt || c.inviteSentAt) as string,
        sortKey: new Date((c.lastInviteSentAt || c.inviteSentAt) as string).getTime(),
        title: `Invite sent to ${c.name}`,
        detail: jobOf(c),
        tone: 'neutral' as const,
      })),
  ]
    .filter(a => !Number.isNaN(a.sortKey))
    .sort((a, b) => b.sortKey - a.sortKey)
    .slice(0, 7);

  // ── Rule-based insights (presentation of existing data) ──
  const coverage = candidates.length > 0 ? Math.round((reportsGenerated / candidates.length) * 100) : 0;
  const roundLeaders = [
    { label: 'Technical', n: technicalCount },
    { label: 'Basic', n: basicCount },
    { label: 'HR', n: hrCount },
  ].sort((a, b) => b.n - a.n);
  const insights: string[] = [];
  if (candidates.length === 0) {
    insights.push('No candidates yet — upload your first resume to start the pipeline.');
  } else {
    insights.push(`Evaluation coverage is at ${coverage}% across ${candidates.length} candidates.`);
    if (pendingInvites.length > 0) {
      insights.push(`${pendingInvites.length} candidate${pendingInvites.length === 1 ? '' : 's'} still waiting for an invite link.`);
    }
    if (reportsGenerating > 0) {
      insights.push(`${reportsGenerating} report${reportsGenerating === 1 ? ' is' : 's are'} being generated right now.`);
    }
    if (roundLeaders[0] && roundLeaders[0].n > 0) {
      insights.push(`${roundLeaders[0].label} is your busiest round with ${roundLeaders[0].n} profile${roundLeaders[0].n === 1 ? '' : 's'}.`);
    }
    if (awaiting === 0 && candidates.length > 0) {
      insights.push('Every candidate has a report — the pipeline is fully evaluated.');
    }
  }

  const needsAttention = pendingInvites.slice(0, 4);

  return (
    <div className="space-y-6 text-foreground font-sans">
      {/* ── Greeting ── */}
      <div className="ehr-rise flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span aria-hidden className="h-[9px] w-[9px] rounded-[3px] bg-[var(--primary)]" />
            <span className="eyebrow">Hiring overview</span>
          </div>
          <h1 className="mt-1 text-[26px] font-extrabold tracking-tight">
            {greeting()}, {firstName}
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Here&rsquo;s what&rsquo;s happening across your hiring pipeline.
          </p>
        </div>
        <PAButton onClick={() => onNavigate('assessments')} className="hidden sm:inline-flex">
          New Assessment <ArrowRight className="h-3.5 w-3.5" />
        </PAButton>
      </div>

      {/* ── KPI cards ── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="ehr-rise ehr-rise-1">
          <Stat
            label="Open roles"
            value={assessments.length}
            unit="profiles"
            pill={<Pill tone="accent">{activeAssessments.length} Active</Pill>}
            footer="Accepting submissions"
            action={<ViewMoreButton onClick={() => onNavigate('assessments')}>View profiles</ViewMoreButton>}
          />
        </div>
        <div className="ehr-rise ehr-rise-2">
          <Stat
            label="Active candidates"
            value={candidates.length}
            unit="people"
            pill={<Pill tone="success">{activeCandidates.length} Active</Pill>}
            footer={`${totalInvitesSent} invite links generated`}
            action={<ViewMoreButton onClick={() => onNavigate('candidates')}>View directory</ViewMoreButton>}
          />
        </div>
        <div className="ehr-rise ehr-rise-3">
          <Stat
            label="Evaluated reports"
            value={reportsGenerated}
            unit="reports"
            pill={<Pill tone="success"><CheckCircle2 className="h-3 w-3" /> Ready</Pill>}
            footer="AI evaluation compiled"
            action={<ViewMoreButton onClick={() => onNavigate('candidates')}>Inspect</ViewMoreButton>}
          />
        </div>
        <div className="ehr-rise ehr-rise-4">
          <Stat
            label="Needs evaluation"
            value={awaiting + reportsGenerating}
            unit="pending"
            pill={
              reportsGenerating > 0
                ? <Pill tone="warning"><Hourglass className="h-3 w-3" /> {reportsGenerating} Active</Pill>
                : <Pill tone="neutral">Queue Clear</Pill>
            }
            footer="Real-time status sync"
            action={<ViewMoreButton onClick={() => onNavigate('candidates')}>Monitor</ViewMoreButton>}
          />
        </div>
      </div>

      {/* ── Pipeline journey ── */}
      <Panel className="ehr-rise ehr-rise-2">
        <div className="flex items-center gap-2.5">
          <IconSquare><Briefcase className="h-4 w-4" /></IconSquare>
          <div>
            <span className="eyebrow block">Journey</span>
            <PanelTitle>Recruitment Pipeline</PanelTitle>
          </div>
        </div>
        <ol className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {stages.map((s, i) => (
            <li key={s.label} className="relative">
              <div
                className={
                  'rounded-2xl border p-4 transition-all duration-200 ' +
                  (s.label === 'Awaiting' && s.value > 0
                    ? 'border-[var(--ring)] bg-[var(--primary-soft)]'
                    : 'border-border bg-card')
                }
              >
                <div className="flex items-center justify-between gap-2">
                  <s.icon className="h-4 w-4 text-[var(--accent)]" aria-hidden />
                  <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                </div>
                <div className="mt-2 text-2xl font-extrabold tracking-tight tabular-nums">{s.value}</div>
                <div className="text-[12px] font-bold">{s.label}</div>
                <div className="text-[11px] text-muted-foreground">{s.hint}</div>
              </div>
              {i < stages.length - 1 && (
                <ArrowRight
                  aria-hidden
                  className="absolute -right-[18px] top-1/2 z-10 hidden h-4 w-4 -translate-y-1/2 rounded-full border border-border bg-card p-[1px] text-[var(--accent)] lg:block"
                />
              )}
            </li>
          ))}
        </ol>
      </Panel>

      {/* ── Movement + side column ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* candidate movement timeline */}
        <Panel className="ehr-rise ehr-rise-3 lg:col-span-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <IconSquare><Users className="h-4 w-4" /></IconSquare>
              <div>
                <span className="eyebrow block">Timeline</span>
                <PanelTitle>Candidate Movement</PanelTitle>
              </div>
            </div>
            <ViewMoreButton onClick={() => onNavigate('candidates')}>View all</ViewMoreButton>
          </div>
          {activity.length > 0 ? (
            <div className="ehr-timeline mt-5 space-y-5">
              {activity.map((a) => (
                <div key={a.key} className="relative">
                  <span aria-hidden className={`ehr-timeline-dot${a.tone === 'peach' ? ' done' : ''}`} />
                  <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                    {fmtDate(a.date)}
                  </div>
                  <div className="mt-0.5 text-[13px] font-bold">{a.title}</div>
                  <div className="text-xs text-muted-foreground">{a.detail}</div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyNote>No movement yet. Upload your first resume to begin building your hiring pipeline.</EmptyNote>
          )}
        </Panel>

        <div className="space-y-4">
          {/* upcoming / needs attention */}
          <Panel className="ehr-rise ehr-rise-3">
            <div className="flex items-center gap-2.5">
              <IconSquare><CircleAlert className="h-4 w-4" /></IconSquare>
              <div>
                <span className="eyebrow block">Follow-ups</span>
                <PanelTitle>Needs Attention</PanelTitle>
              </div>
            </div>
            {needsAttention.length > 0 ? (
              <ul className="mt-4 space-y-3">
                {needsAttention.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 border-b border-border pb-3 last:border-0 last:pb-0">
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-bold">{c.name}</div>
                      <div className="truncate text-[11px] text-muted-foreground">{jobOf(c)} · no invite yet</div>
                    </div>
                    <ViewMoreButton onClick={() => onNavigate('candidates')}>Invite</ViewMoreButton>
                  </li>
                ))}
              </ul>
            ) : (
              <PanelSubtitle className="mt-3">Everyone has an invite. Nothing waiting.</PanelSubtitle>
            )}
          </Panel>

          {/* AI insights */}
          <Panel className="ehr-rise ehr-rise-4 border-[var(--ring)]/50 bg-[var(--primary-soft)]">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-black/10 bg-primary text-primary-foreground">
                <Sparkles className="h-4 w-4" aria-hidden />
              </span>
              <div>
                <span className="eyebrow block">Assistant</span>
                <PanelTitle>AI Hiring Insights</PanelTitle>
              </div>
            </div>
            <ul className="mt-4 space-y-2.5">
              {insights.map((tip) => (
                <li key={tip} className="flex items-start gap-2 text-[12.5px] leading-relaxed text-foreground">
                  <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                  {tip}
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>

      {/* ── Round mix + distribution ── */}
      <Panel className="ehr-rise ehr-rise-4">
        <div className="flex items-center gap-2.5">
          <IconSquare><Send className="h-4 w-4" /></IconSquare>
          <div>
            <span className="eyebrow block">Distribution</span>
            <PanelTitle>Assessment Round Breakdown</PanelTitle>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs font-bold">
              <span>Technical Round</span>
              <span className="tabular-nums text-[var(--accent)]">{technicalCount} ({techPct}%)</span>
            </div>
            <Bar value={techPct} color="var(--chart-1)" countLabel={`${techPct}%`} />
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs font-bold">
              <span>Basic Round</span>
              <span className="tabular-nums text-[var(--accent)]">{basicCount} ({basicPct}%)</span>
            </div>
            <Bar value={basicPct} color="var(--chart-2)" countLabel={`${basicPct}%`} />
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs font-bold">
              <span>HR Screening Round</span>
              <span className="tabular-nums text-[var(--accent)]">{hrCount} ({hrPct}%)</span>
            </div>
            <Bar value={hrPct} color="var(--chart-3)" countLabel={`${hrPct}%`} />
          </div>
        </div>
      </Panel>
    </div>
  );
}
