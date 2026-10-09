import type { Candidate } from '../types';
import { getGrade, normalizeReport } from './normalizeReport';

export const REPORT_GRADE_OPTIONS = [
  { value: 'A+', label: 'Grade A+ (90–100)', tone: 'success' as const },
  { value: 'A', label: 'Grade A (80–89)', tone: 'success' as const },
  { value: 'B+', label: 'Grade B+ (70–79)', tone: 'info' as const },
  { value: 'B', label: 'Grade B (60–69)', tone: 'info' as const },
  { value: 'C+', label: 'Grade C+ (50–59)', tone: 'warning' as const },
  { value: 'C', label: 'Grade C (40–49)', tone: 'warning' as const },
  { value: 'D', label: 'Grade D (30–39)', tone: 'warning' as const },
  { value: 'E', label: 'Grade E (20–29)', tone: 'danger' as const },
  { value: 'F', label: 'Grade F (0–19)', tone: 'danger' as const },
];

function scoreValue(value: unknown): number | null {
  if (typeof value === 'string' && value.trim() !== '') value = Number(value);
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

export function checkScoreFilter(score: number | null, scale: 'scale5' | 'scale3', value: string): boolean {
  if (scoreValue(score) === null) return false;
  if (scale === 'scale5') return getGrade(score).letter === value;
  if (value === '0 - 30') return score! <= 30;
  if (value === '30 - 60') return score! > 30 && score! <= 60;
  if (value === '60 - 100') return score! > 60 && score! <= 100;
  return false;
}

const fieldKey = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, '');
function field(object: any, ...names: string[]): any {
  if (!object || typeof object !== 'object') return undefined;
  const key = Object.keys(object).find(k => names.some(name => fieldKey(k) === fieldKey(name)));
  return key === undefined ? undefined : object[key];
}

function metricValue(value: any): number | null {
  if (value && typeof value === 'object') return scoreValue(field(value, 'score', 'overall score', 'percentage'));
  return scoreValue(value);
}

/** Uses the same normalization and grade function as ReportView. Missing metrics never become fake scores. */
export function getCandidateScore(
  candidate: Candidate,
  round: string,
  layer2: string | null,
  layer3: string | null,
  layer4: string | null,
  assessmentRound: string | undefined,
  rawReport?: any,
): number | null {
  if (candidate.reportStatus === 'GENERATING' || candidate.reportStatus === 'FAILED') return null;
  if (!assessmentRound || round !== assessmentRound) return null;
  const raw = rawReport ?? candidate.simulatedReport;
  if (!raw) return null;
  const normalized = normalizeReport(raw, assessmentRound);
  if (!normalized || normalized.isEmpty || normalized.meta.roundType !== round) return null;
  if ((round === 'BASIC' && layer2 === 'Overall Score') ||
      (round === 'TECHNICAL' && (layer2 === 'Overall Result' || layer2 === 'Technical Analysis (Overall Score)'))) {
    return scoreValue(normalized.overall.overallScore);
  }
  if (layer2 === 'Communication') {
    const comm = normalized.overall.communication;
    return metricValue(field(comm, layer3 || 'Overall Score'));
  }
  if (layer2 === 'Interview Analysis (Confidence Score)' || (layer2 === 'Interview Analysis' && layer3 === 'Confidence')) {
    return scoreValue(normalized.overall.confidenceScore);
  }
  if (round !== 'HR') return null;

  const body = raw.data ?? raw;
  const block = body.report ?? body;
  const overall = field(block, 'overall result') ?? block;
  const group = field(overall, layer2 || '', ...(layer2 === 'Values & Personality' ? ['personality insights'] : [])) ?? field(block, layer2 || '');
  const names = layer3 === 'Creativity & Innovation' ? [layer3, 'Creativity and Innovation'] : [layer3 || ''];
  const metric = field(group, ...names);
  return metricValue(layer4 ? field(metric, layer4, ...(layer4 === 'Extroversion' ? ['Extraversion'] : [])) : metric);
}
