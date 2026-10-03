import type { NormalizedOverall } from './normalizeReport';

/**
 * Round-aware report configuration. Shared shell + per-round axis/KPI/tab
 * definitions so new round types plug in without a new application.
 */

export type RoundKind = 'TECHNICAL' | 'BASIC' | 'HR' | 'UNKNOWN';

export function roundKindOf(roundType: string | null | undefined): RoundKind {
  if (roundType === 'TECHNICAL' || roundType === 'BASIC' || roundType === 'HR') return roundType;
  return 'UNKNOWN';
}

export interface AxisDef {
  key: string;
  label: string;
  get: (o: NormalizedOverall) => number | null | undefined;
}

const comm = (o: NormalizedOverall): Record<string, any> => o.communication || {};

export const TECHNICAL_RADAR_AXES: AxisDef[] = [
  { key: 'technical', label: 'Technical', get: (o) => o.overallScore },
  { key: 'communication', label: 'Communication', get: (o) => comm(o).overall_score ?? comm(o).overallScore },
  { key: 'confidence', label: 'Confidence', get: (o) => o.confidenceScore },
  { key: 'fluency', label: 'Fluency', get: (o) => comm(o).fluency },
  { key: 'grammar', label: 'Grammar', get: (o) => comm(o).grammar },
  { key: 'pronunciation', label: 'Pronunciation', get: (o) => comm(o).pronunciation },
  { key: 'vocabulary', label: 'Vocabulary', get: (o) => comm(o).vocabulary },
];

export const COMM_RADAR_AXES: AxisDef[] = [
  { key: 'fluency', label: 'Fluency', get: (o) => comm(o).fluency },
  { key: 'grammar', label: 'Grammar', get: (o) => comm(o).grammar },
  { key: 'pronunciation', label: 'Pronunciation', get: (o) => comm(o).pronunciation },
  { key: 'vocabulary', label: 'Vocabulary', get: (o) => comm(o).vocabulary },
  { key: 'communication', label: 'Communication', get: (o) => comm(o).overall_score ?? comm(o).overallScore },
];

export interface KpiDef {
  key: string;
  label: string;
  hint: string;
  get: (o: NormalizedOverall) => number | null | undefined;
}

export const TECHNICAL_KPIS: KpiDef[] = [
  { key: 'technical', label: 'Technical', hint: 'Overall technical score', get: (o) => o.overallScore },
  {
    key: 'communication',
    label: 'Communication',
    hint: 'Overall communication score',
    get: (o) => comm(o).overall_score ?? comm(o).overallScore,
  },
  { key: 'confidence', label: 'Confidence', hint: 'Delivery confidence', get: (o) => o.confidenceScore },
];

export const BASIC_KPIS: KpiDef[] = [
  { key: 'overall', label: 'Overall', hint: 'Overall basic score', get: (o) => o.overallScore },
  {
    key: 'communication',
    label: 'Communication',
    hint: 'Overall communication score',
    get: (o) => comm(o).overall_score ?? comm(o).overallScore,
  },
];

export interface ReportTab {
  id: string;
  label: string;
}

export const TECHNICAL_TABS: ReportTab[] = [
  { id: 'overview', label: 'Hiring Snapshot' },
  { id: 'profile', label: 'Competency Profile' },
  { id: 'questions', label: 'Question Analysis' },
  { id: 'evidence', label: 'Evidence & Transcripts' },
  { id: 'proctoring', label: 'Proctoring Audit' },
  { id: 'decision', label: 'Decision Support' },
];

export const BASIC_TABS: ReportTab[] = [
  { id: 'overview', label: 'Hiring Snapshot' },
  { id: 'questions', label: 'Question Analysis' },
  { id: 'evidence', label: 'Evidence & Transcripts' },
  { id: 'proctoring', label: 'Proctoring Audit' },
  { id: 'decision', label: 'Decision Support' },
];

export const HR_TABS: ReportTab[] = [
  { id: 'overview', label: 'Hiring Snapshot' },
  { id: 'competencies', label: 'Competency Profile' },
  { id: 'questions', label: 'Behavioral Analysis' },
  { id: 'evidence', label: 'Evidence & Transcripts' },
  { id: 'proctoring', label: 'Proctoring Audit' },
  { id: 'decision', label: 'Decision Support' },
];

/** HR overall blocks that may appear when PrimeHire supplies them. */
export const HR_COMPETENCY_BLOCKS: Array<{ key: string; label: string }> = [
  { key: 'personalityInsights', label: 'Personality Insights' },
  { key: 'communicationAnalysis', label: 'Communication Analysis' },
  { key: 'interviewAnalysis', label: 'Interview Analysis' },
  { key: 'hrCompetencyAnalysis', label: 'HR Competency Analysis' },
  { key: 'vilsCompetencyAnalysis', label: 'VILS Competency Analysis' },
];

export function tabsFor(kind: RoundKind): ReportTab[] {
  if (kind === 'TECHNICAL') return TECHNICAL_TABS;
  if (kind === 'BASIC') return BASIC_TABS;
  if (kind === 'HR') return HR_TABS;
  return TECHNICAL_TABS;
}

/** Theme accent shared by all report visuals (Sky Blue brand). */
export const REPORT_ACCENT = '#0284c7';
export const REPORT_ACCENT_TEAL = '#38bdf8';
export const REPORT_ACCENT_SOFT = '#f0f9ff';
export const REPORT_GRID = '#e2e8f0';
export const REPORT_TICK = '#64748b';

export const VILS_BRAND = {
  cyan: '#0390CE',
  teal: '#03D8B2',
  mid: '#03A8C6',
  gradient: 'linear-gradient(135deg, #0390CE 0%, #03A8C6 45%, #03D8B2 100%)',
};
