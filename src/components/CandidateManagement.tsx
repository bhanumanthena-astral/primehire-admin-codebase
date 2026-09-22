/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Candidate, AssessmentProfile } from '../types';
import { mockGetInterviewStatus, mockResetCandidatePassword, mockRegenerateReport } from '../mockData';
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
      if (target?.submittedDate) {
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
    <div className="space-y-6 text-[var(--ink)] font-sans">
      
      {/* ── Section Heading ────────────────────────────────────────── */}
      <div className="flex items-start gap-3">
        <div className="icon-badge">
          <Users className="w-5 h-5" />
        </div>
        <div>
          <span className="eyebrow block">DIRECTORY & PIPELINE</span>
          <h2 className="text-xl sm:text-2xl font-extrabold text-[var(--ink)] tracking-tight">
            Candidate Directory Workspace
          </h2>
          <p className="text-xs text-[var(--muted-ink)] mt-0.5">
            Which candidates require status sync, credential updates, or report evaluation inspection?
          </p>
        </div>
      </div>

      {/* ── Cascading Score Filter Workspace ──────────────────────── */}
      <div className="ds-card space-y-4">
        <div className="flex items-center justify-between border-b border-[var(--line)] pb-3">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4 text-[var(--purple-600)]" />
            <span className="eyebrow-purple text-xs">Multi-Criteria Evaluation Query Builder</span>
            {activeFilters.length > 0 && (
              <span className="chip chip-purple">{activeFilters.length} active</span>
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
              <label className="eyebrow block text-[10px]">Round</label>
              <select
                value={pickerRound}
                onChange={(e) => {
                  setPickerRound(e.target.value as any);
                  setPickerL2(null); setPickerL3(null); setPickerL4(null);
                }}
                className="w-full text-xs rounded-lg border border-[var(--line)] bg-slate-50 p-2 text-[var(--ink)] font-semibold focus:bg-white"
              >
                <option value="ALL">Select Round...</option>
                <option value="BASIC">BASIC</option>
                <option value="TECHNICAL">TECHNICAL</option>
                <option value="HR">HR</option>
              </select>
            </div>

            {pickerRound !== 'ALL' && <ChevronRight className="w-3.5 h-3.5 text-slate-400 mb-2 shrink-0" />}

            {/* 2. Metric */}
            {pickerRound !== 'ALL' && (
              <div className="space-y-1 min-w-[170px]">
                <label className="eyebrow block text-[10px]">Metric</label>
                <select
                  value={pickerL2 || ''}
                  onChange={(e) => {
                    setPickerL2(e.target.value || null);
                    setPickerL3(null); setPickerL4(null);
                  }}
                  className="w-full text-xs rounded-lg border border-[var(--line)] bg-slate-50 p-2 text-[var(--ink)] font-semibold focus:bg-white"
                >
                  <option value="">Select Metric...</option>
                  {LAYER2_OPTIONS[pickerRound]?.map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>
            )}

            {pickerShowL3 && <ChevronRight className="w-3.5 h-3.5 text-slate-400 mb-2 shrink-0" />}

            {/* 3. Sub-Metric */}
            {pickerShowL3 && (
              <div className="space-y-1 min-w-[170px]">
                <label className="eyebrow block text-[10px]">Sub-Metric</label>
                <select
                  value={pickerL3 || ''}
                  onChange={(e) => {
                    setPickerL3(e.target.value || null);
                    setPickerL4(null);
                  }}
                  className="w-full text-xs rounded-lg border border-[var(--line)] bg-slate-50 p-2 text-[var(--ink)] font-semibold focus:bg-white"
                >
                  <option value="">Select Sub-Metric...</option>
                  {pickerL3Options.map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>
            )}

            {pickerShowL4 && <ChevronRight className="w-3.5 h-3.5 text-slate-400 mb-2 shrink-0" />}

            {/* 4. Trait */}
            {pickerShowL4 && (
              <div className="space-y-1 min-w-[170px]">
                <label className="eyebrow block text-[10px]">Trait</label>
                <select
                  value={pickerL4 || ''}
                  onChange={(e) => setPickerL4(e.target.value || null)}
                  className="w-full text-xs rounded-lg border border-[var(--line)] bg-slate-50 p-2 text-[var(--ink)] font-semibold focus:bg-white"
                >
                  <option value="">Select Trait...</option>
                  {pickerL4Options.map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Range Buttons */}
          {pickerIsTerminal && pickerScale && (
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
              <span className="eyebrow text-[10px] mr-1">Select Range Filter:</span>
              {pickerScale === 'scale5' && [
                { value: 'A', label: 'Grade A (> 80)', cls: 'chip-positive' },
                { value: 'B', label: 'Grade B (61–80)', cls: 'chip-purple' },
                { value: 'C', label: 'Grade C (41–60)', cls: 'chip-warning' },
                { value: 'D', label: 'Grade D (21–40)', cls: 'chip-warning' },
                { value: 'E', label: 'Grade E (0–20)', cls: 'chip-negative' }
              ].map(opt => (
                <button
                  key={opt.value}
                  onClick={() => handleAddFilter(opt.value)}
                  className={`chip ${opt.cls} cursor-pointer hover:opacity-90 transition`}
                >
                  <Plus className="w-3 h-3" /> {opt.label}
                </button>
              ))}

              {pickerScale === 'scale3' && [
                { value: '60 - 100', label: '61–100', cls: 'chip-positive' },
                { value: '30 - 60', label: '31–60', cls: 'chip-warning' },
                { value: '0 - 30', label: '0–30', cls: 'chip-negative' }
              ].map(opt => (
                <button
                  key={opt.value}
                  onClick={() => handleAddFilter(opt.value)}
                  className={`chip ${opt.cls} cursor-pointer hover:opacity-90 transition`}
                >
                  <Plus className="w-3 h-3" /> {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Active Badges Bar */}
        {activeFilters.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[var(--line)]">
            <span className="eyebrow text-[10px] mr-1">Active Criteria (AND):</span>
            {activeFilters.map(badge => (
              <span key={badge.id} className="chip chip-purple text-[10px]">
                <span className="font-mono uppercase text-[9px]">{badge.round}</span>
                <ChevronRight className="w-2.5 h-2.5 text-purple-400" />
                <span>{badge.metricLabel}</span>
                <span className="font-mono">: {badge.rangeLabel}</span>
                <button
                  onClick={() => setActiveFilters(prev => prev.filter(f => f.id !== badge.id))}
                  className="ml-1 text-purple-400 hover:text-rose-600 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── Aggregate Candidate Table ─────────────────────────────── */}
      <div className="ds-card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-slate-50 border-b border-[var(--line)]">
              <TableRow>
                <TableHead className="eyebrow text-[10px] py-3 text-[var(--muted-ink)]">Candidate Identity</TableHead>
                <TableHead className="eyebrow text-[10px] py-3 text-[var(--muted-ink)]">Assessment Profile</TableHead>
                <TableHead className="eyebrow text-[10px] py-3 text-[var(--muted-ink)]">Round</TableHead>
                <TableHead className="eyebrow text-[10px] py-3 text-[var(--muted-ink)]">Assigned</TableHead>
                <TableHead className="eyebrow text-[10px] py-3 text-[var(--muted-ink)]">Submitted Date</TableHead>
                <TableHead className="eyebrow text-[10px] py-3 text-[var(--muted-ink)]">Report Status</TableHead>
                <TableHead className="eyebrow text-[10px] py-3 text-[var(--muted-ink)]">Access</TableHead>
                <TableHead className="eyebrow text-[10px] py-3 text-right text-[var(--muted-ink)]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-[var(--line)]">
              {filteredCandidates.map(c => {
                const assessment = assessments.find(a => a.id === c.assessmentId);
                return (
                  <TableRow key={c.id} className="hover:bg-slate-50/60 transition-colors">
                    
                    {/* Name & Email */}
                    <TableCell className="py-3">
                      <div className="font-bold text-[var(--ink)] text-xs">{c.name}</div>
                      <div className="text-[10px] text-[var(--muted-ink)] font-mono">{c.email}</div>
                    </TableCell>

                    {/* Assessment Job */}
                    <TableCell className="py-3">
                      {assessment ? (
                        <div>
                          <span className="font-semibold text-[var(--ink)] text-xs">{assessment.jobTitle}</span>
                          <span className="block text-[10px] font-mono text-[var(--muted-ink)]">{assessment.jobId}</span>
                        </div>
                      ) : (
                        <span className="text-rose-500 italic text-xs">Unmapped profile</span>
                      )}
                    </TableCell>

                    {/* Round Tag */}
                    <TableCell className="py-3">
                      {assessment && (
                        <span className="chip chip-purple text-[10px] font-mono uppercase">
                          {assessment.roundType}
                        </span>
                      )}
                    </TableCell>

                    {/* Assigned Date */}
                    <TableCell className="py-3 text-xs font-mono text-[var(--muted-ink)]">
                      {c.assignedDate ? new Date(c.assignedDate).toLocaleDateString() : 'Unassigned'}
                    </TableCell>

                    {/* Submitted Date */}
                    <TableCell className="py-3 text-xs font-mono text-[var(--ink)]">
                      {c.submittedDate || <span className="text-[var(--muted-ink)] italic text-[11px]">Pending</span>}
                    </TableCell>

                    {/* Report Status */}
                    <TableCell className="py-3">
                      {c.reportStatus === 'GENERATED' ? (
                        <span className="chip chip-positive">
                          <CheckCircle className="w-3 h-3" /> Evaluated
                        </span>
                      ) : c.reportStatus === 'GENERATING' ? (
                        <span className="chip chip-warning animate-pulse">
                          <RefreshCw className="w-3 h-3 animate-spin" /> Analyzing
                        </span>
                      ) : (
                        <span className="chip chip-purple">No Report</span>
                      )}
                    </TableCell>

                    {/* Status */}
                    <TableCell className="py-3">
                      <span className={`chip ${c.status === 'ACTIVE' ? 'chip-positive' : 'chip-negative'}`}>
                        {c.status}
                      </span>
                    </TableCell>

                    {/* Actions */}
                    <TableCell className="py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {c.linkGenerated && c.interviewId && (
                          <button
                            onClick={() => handleCheckStatus(c.id)}
                            disabled={syncingId === c.id}
                            title="Sync status with API"
                            className="p-1.5 rounded-lg border border-[var(--line)] text-slate-700 hover:bg-slate-100 cursor-pointer"
                          >
                            <RefreshCw className={`w-3.5 h-3.5 ${syncingId === c.id ? 'animate-spin' : ''}`} />
                          </button>
                        )}

                        <button
                          onClick={() => assessment && onOpenReport(c, assessment)}
                          disabled={c.reportStatus !== 'GENERATED'}
                          title={c.reportStatus !== 'GENERATED' ? 'Report not generated yet' : 'View report'}
                          className={`p-1.5 rounded-lg border text-slate-700 hover:bg-slate-100 cursor-pointer ${
                            c.reportStatus !== 'GENERATED' ? 'opacity-30 cursor-not-allowed' : 'border-[var(--line)]'
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
                            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 cursor-pointer"
                          >
                            <MoreVertical className="w-4 h-4" />
                          </button>

                          {openMenuCandId === c.id && (
                            <>
                              <div className="fixed inset-0 z-30" onClick={() => setOpenMenuCandId(null)} />
                              <div className="absolute right-0 mt-1 w-44 bg-white border border-[var(--line)] rounded-xl shadow-lg py-1.5 z-40 text-left">
                                <button
                                  onClick={() => { setOpenMenuCandId(null); onToggleCandidateStatus(c.id); }}
                                  className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold hover:bg-slate-50 cursor-pointer"
                                >
                                  <Check className="w-3.5 h-3.5 text-emerald-600" /> Toggle Active
                                </button>
                                <button
                                  onClick={() => { setOpenMenuCandId(null); setPasswordEditCandId(c.id); setNewCandPassword(c.password || ''); }}
                                  className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold hover:bg-slate-50 cursor-pointer"
                                >
                                  <Lock className="w-3.5 h-3.5 text-slate-500" /> Update Password
                                </button>
                                <button
                                  onClick={() => { setOpenMenuCandId(null); handleRegenerateReport(c.id); }}
                                  disabled={!c.submittedDate}
                                  className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold ${
                                    c.submittedDate ? 'hover:bg-slate-50 cursor-pointer' : 'opacity-40 cursor-not-allowed'
                                  }`}
                                >
                                  <RefreshCw className="w-3.5 h-3.5 text-sky-600" /> Regenerate Report
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
                  <TableCell colSpan={8} className="py-12 text-center text-[var(--muted-ink)] italic text-xs">
                    No candidate records match the active filter criteria.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div className="p-3 bg-slate-50 border-t border-[var(--line)] flex items-center justify-between text-xs text-[var(--muted-ink)]">
          <span>Showing <strong>{filteredCandidates.length}</strong> of <strong>{candidates.length}</strong> total candidates</span>
          <span className="text-[11px] font-mono">Preserving filter context</span>
        </div>
      </div>

      {/* Update Password Dialog Modal */}
      {passwordEditCandId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div className="bg-white rounded-2xl border border-[var(--line)] shadow-xl w-full max-w-md p-6 space-y-4 text-left">
            <div>
              <h3 className="text-sm font-extrabold text-[var(--ink)] flex items-center gap-2">
                <Lock className="w-4 h-4 text-[var(--purple-600)]" /> Update Candidate Password
              </h3>
              <p className="text-xs text-[var(--muted-ink)] mt-1">
                Assign a custom login password credential for candidate login.
              </p>
            </div>

            <div className="space-y-1">
              <label className="eyebrow block text-[10px]">New Password Key *</label>
              <Input
                value={newCandPassword}
                onChange={(e) => setNewCandPassword(e.target.value)}
                placeholder="Enter password credential..."
                className="text-xs font-bold"
              />
            </div>

            <div className="flex gap-2 pt-2 border-t border-[var(--line)]">
              <button
                onClick={() => setPasswordEditCandId(null)}
                className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-bold cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleUpdatePasswordSubmit}
                disabled={isSavingPassword || !newCandPassword.trim()}
                className="flex-1 py-2 bg-[var(--purple-700)] hover:bg-[var(--purple-600)] text-white rounded-xl text-xs font-bold cursor-pointer"
              >
                Save Password
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
