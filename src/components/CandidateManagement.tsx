/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Candidate, AssessmentProfile } from '../types';
import { mockGetInterviewStatus, mockResetCandidatePassword, mockRegenerateReport } from '../mockData';
import { syncCandidateToServer } from '../lib/mongoApi';
import { toast } from 'sonner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  Search, 
  Filter, 
  CheckCircle, 
  RefreshCw, 
  Eye, 
  RotateCcw,
  Info,
  MoreVertical,
  Lock,
  Check,
  X,
  Plus,
  ChevronRight,
  Users,
  SlidersHorizontal
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { SectionHeader, Panel, Pill, PAButton, IconSquare, EmptyNote } from './ui/primitives';

// ─────────────────────────────────────────────────────────────────────────────
// METRIC TREE CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

const LAYER2_OPTIONS: Record<string, string[]> = {
  BASIC: ['Overall Score', 'Communication'],
  TECHNICAL: ['Overall Result', 'Technical Analysis (Overall Score)', 'Interview Analysis (Confidence Score)', 'Communication'],
  HR: ['Communication', 'Interview Analysis', 'HR Competency Analysis', 'VILS Competency Analysis', 'Values & Personality']
};

const LAYER3_OPTIONS: Record<string, Record<string, string[]>> = {
  BASIC: {
    'Communication': ['Overall Score', 'Fluency', 'Grammar', 'Pronunciation', 'Vocabulary']
  },
  TECHNICAL: {
    'Communication': ['Overall Score', 'Fluency', 'Grammar', 'Pronunciation', 'Vocabulary']
  },
  HR: {
    'Communication': ['Grammar', 'Fluency', 'Vocabulary', 'Pronunciation'],
    'Interview Analysis': ['Confidence'],
    'HR Competency Analysis': [
      'Self Discipline', 'Time Management', 'Detail Orientation', 'Teamwork', 'Professionalism', 
      'Leadership', 'Motivation', 'Learning Ability', 'Adaptability', 'Creativity & Innovation', 
      'Positive Attitude', 'Problem Solving'
    ],
    'VILS Competency Analysis': [
      'Leading and Deciding', 'Supporting and Cooperating', 'Interacting and Presenting', 
      'Analysing and Interpreting', 'Creating and Conceptualising', 'Organising and Executing', 
      'Adapting and Coping', 'Enterprising and Performing'
    ],
    'Values & Personality': ['Personal Values (Big Five)', 'Societal Values', 'Dark Triad Risk Assessment']
  }
};

const LAYER4_OPTIONS: Record<string, string[]> = {
  'Personal Values (Big Five)': ['Openness', 'Extroversion', 'Conscientiousness', 'Agreeableness', 'Neurotic'],
  'Societal Values': [
    'Hedonism', 'Power', 'Stimulation', 'Conformity', 'Universalism', 
    'Self Direction', 'Achievement', 'Traditional', 'Benevolence', 'Security'
  ],
  'Dark Triad Risk Assessment': ['Machiavellianism', 'Narcissism', 'Psychopathy']
};

// ─────────────────────────────────────────────────────────────────────────────
// SCORING UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

function getScoreScale(round: string, layer2: string | null, layer3: string | null, layer4: string | null): 'scale5' | 'scale3' | null {
  if (round === 'ALL' || !round) return null;
  
  if (round === 'BASIC') {
    if (layer2 === 'Overall Score') return 'scale5';
    if (layer2 === 'Communication') return 'scale5';
  }
  
  if (round === 'TECHNICAL') {
    if (layer2 === 'Overall Result') return 'scale5';
    if (layer2 === 'Technical Analysis (Overall Score)') return 'scale5';
    if (layer2 === 'Interview Analysis (Confidence Score)') return 'scale5';
    if (layer2 === 'Communication') return 'scale5';
  }
  
  if (round === 'HR') {
    if (layer2 === 'Communication') return 'scale5';
    if (layer2 === 'Interview Analysis') return 'scale5';
    if (layer2 === 'HR Competency Analysis') return 'scale3';
    if (layer2 === 'VILS Competency Analysis') return 'scale3';
    if (layer2 === 'Values & Personality') return 'scale3';
  }
  
  return null;
}

function checkScoreFilter(score: number, scale: 'scale5' | 'scale3', filterValue: string): boolean {
  if (score < 0) return false;
  
  if (scale === 'scale5') {
    if (filterValue === 'E') return score <= 20;
    if (filterValue === 'D') return score > 20 && score <= 40;
    if (filterValue === 'C') return score > 40 && score <= 60;
    if (filterValue === 'B') return score > 60 && score <= 80;
    if (filterValue === 'A') return score > 80;
  }
  
  if (scale === 'scale3') {
    if (filterValue === '0 - 30') return score <= 30;
    if (filterValue === '30 - 60') return score > 30 && score <= 60;
    if (filterValue === '60 - 100') return score > 60 && score <= 100;
  }
  
  return false;
}

function getCandidateScore(
  c: Candidate,
  round: string,
  layer2: string | null,
  layer3: string | null,
  layer4: string | null
): number {
  if (c.reportStatus !== 'GENERATED') return -1;

  const metricName = layer4 || layer3 || layer2 || round;
  
  if (
    (round === 'BASIC' && layer2 === 'Overall Score') ||
    (round === 'TECHNICAL' && (layer2 === 'Overall Result' || layer2 === 'Technical Analysis (Overall Score)'))
  ) {
    if (c.simulatedReport?.overallScore !== undefined) {
      return c.simulatedReport.overallScore;
    }
  }

  const str = c.id + '-' + metricName;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const score = 15 + Math.abs(hash % 85); 
  return score;
}

interface ActiveFilterBadge {
  id: string;
  round: string;
  layer2: string | null;
  layer3: string | null;
  layer4: string | null;
  scale: 'scale5' | 'scale3';
  scoreRange: string;
  metricLabel: string;
  rangeLabel: string;
}

function resolveMetricLabel(round: string, l2: string | null, l3: string | null, l4: string | null): string {
  if (l4) return l4;
  if (l3) return l3;
  if (l2) return l2;
  return round;
}

function buildBadgeId(round: string, l2: string | null, l3: string | null, l4: string | null): string {
  return [round, l2 || '', l3 || '', l4 || ''].join('|');
}

function getRangeLabel(scale: 'scale5' | 'scale3', value: string): string {
  if (scale === 'scale5') {
    switch (value) {
      case 'A': return 'Grade A (> 80)';
      case 'B': return 'Grade B (61–80)';
      case 'C': return 'Grade C (41–60)';
      case 'D': return 'Grade D (21–40)';
      case 'E': return 'Grade E (0–20)';
    }
  }
  if (scale === 'scale3') {
    switch (value) {
      case '60 - 100': return '61–100';
      case '30 - 60': return '31–60';
      case '0 - 30': return '0–30';
    }
  }
  return value;
}

function isTerminalNode(round: string, l2: string | null, l3: string | null, l4: string | null): boolean {
  if (!round || round === 'ALL') return false;
  if (round === 'BASIC') {
    if (l2 === 'Overall Score') return true;
    if (l2 === 'Communication' && l3) return true;
    return false;
  }
  if (round === 'TECHNICAL') {
    if (l2 === 'Overall Result') return true;
    if (l2 === 'Technical Analysis (Overall Score)') return true;
    if (l2 === 'Interview Analysis (Confidence Score)') return true;
    if (l2 === 'Communication' && l3) return true;
    return false;
  }
  if (round === 'HR') {
    if (l2 === 'Communication' && l3) return true;
    if (l2 === 'Interview Analysis' && l3) return true;
    if (l2 === 'HR Competency Analysis' && l3) return true;
    if (l2 === 'VILS Competency Analysis' && l3) return true;
    if (l2 === 'Values & Personality' && l3 && l4) return true;
    return false;
  }
  return false;
}

interface CandidateManagementProps {
  candidates: Candidate[];
  assessments: AssessmentProfile[];
  filterRound?: string;
  filterStatus?: string;
  searchQuery?: string;
  onToggleCandidateStatus: (candidateId: string) => void;
  onOpenReport: (candidate: Candidate, assessment: AssessmentProfile) => void;
  onSetCandidates: React.Dispatch<React.SetStateAction<Candidate[]>>;
}

export default function CandidateManagement({
  candidates,
  assessments,
  filterRound = 'ALL',
  filterStatus = 'ALL',
  searchQuery = '',
  onToggleCandidateStatus,
  onOpenReport,
  onSetCandidates
}: CandidateManagementProps) {
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [openMenuCandId, setOpenMenuCandId] = useState<string | null>(null);
  const [passwordEditCandId, setPasswordEditCandId] = useState<string | null>(null);
  const [newCandPassword, setNewCandPassword] = useState('');
  const [isSavingPassword, setIsSavingPassword] = useState(false);

  // Multi-Select Badge Filter State
  const [activeFilters, setActiveFilters] = useState<ActiveFilterBadge[]>([]);

  // Cascading picker transient state
  const [pickerRound, setPickerRound] = useState<'ALL' | 'BASIC' | 'TECHNICAL' | 'HR'>('ALL');
  const [pickerL2, setPickerL2] = useState<string | null>(null);
  const [pickerL3, setPickerL3] = useState<string | null>(null);
  const [pickerL4, setPickerL4] = useState<string | null>(null);

  const resetPicker = () => {
    setPickerRound('ALL');
    setPickerL2(null);
    setPickerL3(null);
    setPickerL4(null);
  };

  const handleCheckStatus = async (candId: string) => {
    setSyncingId(candId);
    try {
      const updated = await mockGetInterviewStatus(candId as any, candidates);
      onSetCandidates(updated);
      const target = updated.find(c => c.id === candId);
      if (target && (await syncCandidateToServer(target)) === 'failed') {
        toast.warning('Status synced from PrimeHire, but saving it to the server failed.');
      } else if (target?.submittedDate) {
        toast.success(`Synced! Assessment completed: ${target.submittedDate}`);
      } else {
        toast.info('Interview not completed yet.');
      }
    } catch (err: any) {
      toast.error('Failed to sync status: ' + err.message);
    } finally {
      setSyncingId(null);
    }
  };

  const handleUpdatePasswordSubmit = async () => {
    if (!passwordEditCandId) return;
    if (!newCandPassword.trim()) {
      toast.error('New Password cannot be empty.');
      return;
    }
    setIsSavingPassword(true);
    try {
      const updated = await mockResetCandidatePassword(passwordEditCandId as any, candidates, newCandPassword.trim());
      onSetCandidates(updated);
      toast.success('Candidate password updated successfully!');
      setPasswordEditCandId(null);
      setNewCandPassword('');
    } catch (err: any) {
      toast.error('Failed to update password: ' + err.message);
    } finally {
      setIsSavingPassword(false);
    }
  };

  const handleRegenerateReport = async (candId: string) => {
    try {
      const updated = await mockRegenerateReport(candId as any, candidates);
      onSetCandidates(updated);
      toast.success('Report regeneration requested successfully!');
      const regenTarget = updated.find(c => c.id === candId);
      if (regenTarget && (await syncCandidateToServer(regenTarget)) === 'failed') {
        toast.warning('Regeneration requested, but server sync failed.');
      }
    } catch (err: any) {
      toast.error('Failed to regenerate report: ' + err.message);
    }
  };

  // Picker computed helpers
  const pickerShowL3 = (() => {
    if (pickerRound === 'BASIC' && pickerL2 === 'Communication') return true;
    if (pickerRound === 'TECHNICAL' && pickerL2 === 'Communication') return true;
    if (pickerRound === 'HR' && pickerL2) return true;
    return false;
  })();

  const pickerL3Options = (() => {
    if (pickerRound === 'BASIC') return LAYER3_OPTIONS.BASIC?.[pickerL2 as string] || [];
    if (pickerRound === 'TECHNICAL') return LAYER3_OPTIONS.TECHNICAL?.[pickerL2 as string] || [];
    if (pickerRound === 'HR') return LAYER3_OPTIONS.HR?.[pickerL2 as string] || [];
    return [];
  })();

  const pickerShowL4 = pickerRound === 'HR' && pickerL2 === 'Values & Personality' && !!pickerL3;
  const pickerL4Options = pickerShowL4 && pickerL3 ? LAYER4_OPTIONS[pickerL3] || [] : [];

  const pickerIsTerminal = isTerminalNode(pickerRound, pickerL2, pickerL3, pickerL4);
  const pickerScale = pickerIsTerminal ? getScoreScale(pickerRound, pickerL2, pickerL3, pickerL4) : null;

  const handleAddFilter = (scoreRange: string) => {
    if (!pickerScale) return;
    const badgeId = buildBadgeId(pickerRound, pickerL2, pickerL3, pickerL4);
    const metricLabel = resolveMetricLabel(pickerRound, pickerL2, pickerL3, pickerL4);
    const rangeLabel = getRangeLabel(pickerScale, scoreRange);

    const newBadge: ActiveFilterBadge = {
      id: badgeId,
      round: pickerRound,
      layer2: pickerL2,
      layer3: pickerL3,
      layer4: pickerL4,
      scale: pickerScale,
      scoreRange,
      metricLabel,
      rangeLabel
    };

    setActiveFilters(prev => {
      const exists = prev.findIndex(f => f.id === badgeId);
      if (exists >= 0) {
        const updated = [...prev];
        updated[exists] = newBadge;
        toast.info(`Updated filter for "${metricLabel}"`);
        return updated;
      }
      toast.success(`Filter added: ${metricLabel} → ${rangeLabel}`);
      return [...prev, newBadge];
    });
    resetPicker();
  };

  // Candidate Filtering
  const filteredCandidates = candidates.filter(c => {
    const assessment = assessments.find(a => a.id === c.assessmentId);
    
    // Global filter bar state check
    const matchesGlobalRound = filterRound === 'ALL' || (assessment?.roundType === filterRound);
    const matchesGlobalStatus = filterStatus === 'ALL' || 
      (filterStatus === 'GENERATED' && c.reportStatus === 'GENERATED') ||
      (filterStatus === 'GENERATING' && c.reportStatus === 'GENERATING') ||
      (filterStatus === 'PENDING' && !c.reportStatus);

    const matchesSearch = !searchQuery ||
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (assessment?.jobTitle || '').toLowerCase().includes(searchQuery.toLowerCase());

    if (!matchesGlobalRound || !matchesGlobalStatus || !matchesSearch) return false;

    if (activeFilters.length === 0) return true;

    return activeFilters.every(badge => {
      const score = getCandidateScore(c, badge.round, badge.layer2, badge.layer3, badge.layer4);
      if (score === -1) return false;
      return checkScoreFilter(score, badge.scale, badge.scoreRange);
    });
  });

  return (
    <div className="space-y-6 text-foreground font-sans">
      <SectionHeader
        eyebrow="Directory & pipeline"
        title="Candidate Directory Workspace"
        subtitle="Which candidates require status sync, credential updates, or report evaluation inspection?"
        icon={<Users className="w-5 h-5" />}
      />

      {/* ── Cascading Score Filter Workspace ──────────────────────── */}
      <Panel className="space-y-4">
        <div className="flex items-center justify-between border-b border-border/60 pb-3">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4 text-accent" />
            <span className="eyebrow">Multi-Criteria Evaluation Query Builder</span>
            {activeFilters.length > 0 && (
              <Pill tone="info">{activeFilters.length} active</Pill>
            )}
          </div>

          {activeFilters.length > 0 && (
            <button
              onClick={() => setActiveFilters([])}
              className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-600 hover:underline cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" /> Clear All Filters
            </button>
          )}
        </div>

        {/* Cascading Picker Selectors */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-2.5">
            {/* 1. Round */}
            <div className="space-y-1 min-w-[130px]">
              <label className="eyebrow block">Round</label>
              <select
                value={pickerRound}
                onChange={(e) => {
                  setPickerRound(e.target.value as any);
                  setPickerL2(null); setPickerL3(null); setPickerL4(null);
                }}
                className="w-full text-xs rounded-full border border-border/70 bg-card px-3 py-2 text-foreground font-semibold focus:outline-none focus:ring-2 focus:ring-ring/40 shadow-[var(--shadow-card)]"
              >
                <option value="ALL">Select Round...</option>
                <option value="BASIC">BASIC</option>
                <option value="TECHNICAL">TECHNICAL</option>
                <option value="HR">HR</option>
              </select>
            </div>

            {pickerRound !== 'ALL' && <ChevronRight className="w-3.5 h-3.5 text-muted-foreground mb-2 shrink-0" />}

            {/* 2. Metric */}
            {pickerRound !== 'ALL' && (
              <div className="space-y-1 min-w-[170px]">
                <label className="eyebrow block">Metric</label>
                <select
                  value={pickerL2 || ''}
                  onChange={(e) => {
                    setPickerL2(e.target.value || null);
                    setPickerL3(null); setPickerL4(null);
                  }}
                  className="w-full text-xs rounded-full border border-border/70 bg-card px-3 py-2 text-foreground font-semibold focus:outline-none focus:ring-2 focus:ring-ring/40 shadow-[var(--shadow-card)]"
                >
                  <option value="">Select Metric...</option>
                  {LAYER2_OPTIONS[pickerRound]?.map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>
            )}

            {pickerShowL3 && <ChevronRight className="w-3.5 h-3.5 text-muted-foreground mb-2 shrink-0" />}

            {/* 3. Sub-Metric */}
            {pickerShowL3 && (
              <div className="space-y-1 min-w-[170px]">
                <label className="eyebrow block">Sub-Metric</label>
                <select
                  value={pickerL3 || ''}
                  onChange={(e) => {
                    setPickerL3(e.target.value || null);
                    setPickerL4(null);
                  }}
                  className="w-full text-xs rounded-full border border-border/70 bg-card px-3 py-2 text-foreground font-semibold focus:outline-none focus:ring-2 focus:ring-ring/40 shadow-[var(--shadow-card)]"
                >
                  <option value="">Select Sub-Metric...</option>
                  {pickerL3Options.map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>
            )}

            {pickerShowL4 && <ChevronRight className="w-3.5 h-3.5 text-muted-foreground mb-2 shrink-0" />}

            {/* 4. Trait */}
            {pickerShowL4 && (
              <div className="space-y-1 min-w-[170px]">
                <label className="eyebrow block">Trait</label>
                <select
                  value={pickerL4 || ''}
                  onChange={(e) => setPickerL4(e.target.value || null)}
                  className="w-full text-xs rounded-full border border-border/70 bg-card px-3 py-2 text-foreground font-semibold focus:outline-none focus:ring-2 focus:ring-ring/40 shadow-[var(--shadow-card)]"
                >
                  <option value="">Select Trait...</option>
                  {pickerL4Options.map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Range Buttons — locked grade palette */}
          {pickerIsTerminal && pickerScale && (
            <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-border/60">
              <span className="eyebrow mr-1">Select Range Filter:</span>
              {pickerScale === 'scale5' && ([
                { value: 'A', label: 'Grade A (> 80)', tone: 'success' as const },
                { value: 'B', label: 'Grade B (61–80)', tone: 'info' as const },
                { value: 'C', label: 'Grade C (41–60)', tone: 'warning' as const },
                { value: 'D', label: 'Grade D (21–40)', tone: 'warning' as const },
                { value: 'E', label: 'Grade E (0–20)', tone: 'danger' as const },
              ]).map(opt => (
                <button
                  key={opt.value}
                  onClick={() => handleAddFilter(opt.value)}
                  className="cursor-pointer transition-opacity hover:opacity-80"
                >
                  <Pill tone={opt.tone}><Plus className="w-3 h-3" /> {opt.label}</Pill>
                </button>
              ))}

              {pickerScale === 'scale3' && ([
                { value: '60 - 100', label: '61–100', tone: 'success' as const },
                { value: '30 - 60', label: '31–60', tone: 'warning' as const },
                { value: '0 - 30', label: '0–30', tone: 'danger' as const },
              ]).map(opt => (
                <button
                  key={opt.value}
                  onClick={() => handleAddFilter(opt.value)}
                  className="cursor-pointer transition-opacity hover:opacity-80"
                >
                  <Pill tone={opt.tone}><Plus className="w-3 h-3" /> {opt.label}</Pill>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Active Badges Bar */}
        {activeFilters.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-border/60">
            <span className="eyebrow mr-1">Active Criteria (AND):</span>
            {activeFilters.map(badge => (
              <span key={badge.id} className="inline-flex">
              <Pill tone="info">
                <span className="font-mono uppercase text-[9px]">{badge.round}</span>
                <ChevronRight className="w-2.5 h-2.5 opacity-70" />
                <span>{badge.metricLabel}</span>
                <span className="font-mono tnum tabular-nums">: {badge.rangeLabel}</span>
                <button
                  onClick={() => setActiveFilters(prev => prev.filter(f => f.id !== badge.id))}
                  aria-label="Remove filter"
                  className="ml-1 opacity-70 hover:opacity-100 hover:text-destructive cursor-pointer transition"
                >
                  <X className="w-3 h-3" />
                </button>
              </Pill>
              </span>
            ))}
          </div>
        )}
      </Panel>

      {/* ── Aggregate Candidate Table ─────────────────────────────── */}
      <Panel padded={false} className="overflow-hidden">
        <div className="overflow-auto rounded-lg">
          <Table>
            <TableHeader className="bg-card border-b border-border/60">
              <TableRow>
                <TableHead>Candidate Identity</TableHead>
                <TableHead>Assessment Profile</TableHead>
                <TableHead>Round</TableHead>
                <TableHead>Assigned</TableHead>
                <TableHead>Submitted Date</TableHead>
                <TableHead>Report Status</TableHead>
                <TableHead>Access</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredCandidates.map(c => {
                const assessment = assessments.find(a => a.id === c.assessmentId);
                return (
                  <TableRow key={c.id} className="hover:bg-muted/40">
                    <TableCell>
                      <div className="font-semibold text-foreground text-sm">{c.name}</div>
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-mono">{c.email}</div>
                    </TableCell>
                    <TableCell>
                      {assessment ? (
                        <div>
                          <span className="font-semibold text-foreground text-sm">{assessment.jobTitle}</span>
                          <span className="block text-[10px] font-mono text-muted-foreground">{assessment.jobId}</span>
                        </div>
                      ) : (
                        <span className="text-destructive italic text-xs">Unmapped profile</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {assessment && (
                        <Pill tone="neutral"><span className="font-mono uppercase text-[10px]">{assessment.roundType}</span></Pill>
                      )}
                    </TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground tnum tabular-nums">
                      {c.assignedDate ? new Date(c.assignedDate).toLocaleDateString() : 'Unassigned'}
                    </TableCell>
                    <TableCell className="text-xs font-mono text-foreground tnum tabular-nums">
                      {c.submittedDate || <span className="text-muted-foreground italic text-[11px]">Pending</span>}
                    </TableCell>
                    <TableCell>
                      {c.reportStatus === 'GENERATED' ? (
                        <Pill tone="success"><CheckCircle className="w-3 h-3" /> Evaluated</Pill>
                      ) : c.reportStatus === 'GENERATING' ? (
                        <Pill tone="warning"><span className="animate-pulse inline-flex items-center gap-1"><RefreshCw className="w-3 h-3 animate-spin" /> Analyzing</span></Pill>
                      ) : (
                        <Pill tone="neutral">No Report</Pill>
                      )}
                    </TableCell>
                    <TableCell>
                      <Pill tone={c.status === 'ACTIVE' ? 'success' : 'danger'}>
                        {c.status}
                      </Pill>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {c.linkGenerated && c.interviewId && (
                          <button
                            onClick={() => handleCheckStatus(c.id)}
                            disabled={syncingId === c.id}
                            title="Sync status with API"
                            className="p-1.5 rounded-full border border-border/70 text-foreground hover:bg-muted cursor-pointer transition disabled:opacity-50"
                          >
                            <RefreshCw className={`w-3.5 h-3.5 ${syncingId === c.id ? 'animate-spin' : ''}`} />
                          </button>
                        )}
                        <button
                          onClick={() => assessment && onOpenReport(c, assessment)}
                          disabled={c.reportStatus !== 'GENERATED'}
                          title={c.reportStatus !== 'GENERATED' ? 'Report not generated yet' : 'View report'}
                          className={`p-1.5 rounded-full border border-border/70 text-foreground hover:bg-muted cursor-pointer transition ${
                            c.reportStatus !== 'GENERATED' ? 'opacity-40 cursor-not-allowed' : ''
                          }`}
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <div className="relative inline-block">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenMenuCandId(openMenuCandId === c.id ? null : c.id);
                            }}
                            className="p-1.5 rounded-full hover:bg-muted text-muted-foreground cursor-pointer transition"
                          >
                            <MoreVertical className="w-4 h-4" />
                          </button>
                          {openMenuCandId === c.id && (
                            <>
                              <div className="fixed inset-0 z-30" onClick={() => setOpenMenuCandId(null)} />
                              <div className="absolute right-0 mt-1 w-44 bg-card border border-border/70 rounded-2xl shadow-[var(--shadow-card)] py-1.5 z-40 text-left">
                                <button
                                  onClick={() => { setOpenMenuCandId(null); onToggleCandidateStatus(c.id); }}
                                  className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted cursor-pointer transition"
                                >
                                  <Check className="w-3.5 h-3.5 text-success" /> Toggle Active
                                </button>
                                <button
                                  onClick={() => { setOpenMenuCandId(null); setPasswordEditCandId(c.id); setNewCandPassword(c.password || ''); }}
                                  className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted cursor-pointer transition"
                                >
                                  <Lock className="w-3.5 h-3.5 text-muted-foreground" /> Update Password
                                </button>
                                <button
                                  onClick={() => { setOpenMenuCandId(null); handleRegenerateReport(c.id); }}
                                  disabled={!c.submittedDate}
                                  className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-foreground ${
                                    c.submittedDate ? 'hover:bg-muted cursor-pointer' : 'opacity-40 cursor-not-allowed'
                                  } transition`}
                                >
                                  <RefreshCw className="w-3.5 h-3.5 text-info" /> Regenerate Report
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {filteredCandidates.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8}>
                    <EmptyNote>No candidate records match the active filter criteria.</EmptyNote>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <div className="p-3 bg-muted/40 border-t border-border/60 flex items-center justify-between text-xs text-muted-foreground">
          <span className="tnum tabular-nums">Showing <strong className="text-foreground">{filteredCandidates.length}</strong> of <strong className="text-foreground">{candidates.length}</strong> total candidates</span>
          <span className="text-[11px] font-mono">Preserving filter context</span>
        </div>
      </Panel>

      {/* Update Password Dialog Modal */}
      {passwordEditCandId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-foreground/20 backdrop-blur-sm">
          <Panel className="w-full max-w-md space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Lock className="w-4 h-4 text-accent" /> Update Candidate Password
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                Assign a custom login password credential for candidate login.
              </p>
            </div>
            <div className="space-y-1">
              <label className="eyebrow block">New Password Key *</label>
              <Input
                value={newCandPassword}
                onChange={(e) => setNewCandPassword(e.target.value)}
                placeholder="Enter password credential..."
                className="rounded-full"
              />
            </div>
            <div className="flex gap-2 pt-3 border-t border-border/60">
              <PAButton variant="secondary" onClick={() => setPasswordEditCandId(null)} className="flex-1">
                Cancel
              </PAButton>
              <PAButton
                onClick={handleUpdatePasswordSubmit}
                disabled={isSavingPassword || !newCandPassword.trim()}
                className="flex-1"
              >
                Save Password
              </PAButton>
            </div>
          </Panel>
        </div>
      )}

    </div>
  );
}
