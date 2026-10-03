import type { NormalizedOverall, NormalizedQuestion } from './normalizeReport';

/**
 * Derived report metrics. Every value here is computed mathematically from
 * normalized data — no invented scores, no benchmarks, no batch averages.
 * Anything derived (rather than supplied) is labeled as such at the call
 * site via the `derived: true` flags below.
 */

export interface Coverage {
  total: number;
  /** null when the source never reports is_attempted (do not guess). */
  attempted: number | null;
  evaluated: number;
  pending: number;
  recordings: number;
}

export function getCoverage(questions: NormalizedQuestion[]): Coverage {
  const attemptedFlags = questions.map((q) => q.isAttempted);
  const attemptedKnown = attemptedFlags.filter((v): v is boolean => v !== null);
  return {
    total: questions.length,
    attempted: attemptedKnown.length === questions.length ? attemptedKnown.filter(Boolean).length : null,
    evaluated: questions.filter((q) => q.isGenerated).length,
    pending: questions.filter((q) => !q.isGenerated).length,
    recordings: questions.filter((q) => !!q.videoUrl).length,
  };
}

export interface Aggregates {
  evaluated: number;
  /** Mean of evaluated question percentages (labeled "derived", never shown as the official score). */
  avg: number | null;
  high: number | null;
  low: number | null;
  /** Weightage-weighted mean; null when no weightages are present. */
  weighted: number | null;
  derived: true;
}

export function getAggregates(questions: NormalizedQuestion[]): Aggregates {
  const pcts = questions
    .filter((q) => q.isGenerated && q.percentage !== null)
    .map((q) => q.percentage as number);
  if (pcts.length === 0) {
    return { evaluated: 0, avg: null, high: null, low: null, weighted: null, derived: true };
  }
  const weightedItems = questions.filter(
    (q) => q.isGenerated && q.percentage !== null && q.weightage !== null && (q.weightage as number) > 0,
  );
  const wSum = weightedItems.reduce((a, q) => a + (q.weightage as number), 0);
  return {
    evaluated: pcts.length,
    avg: Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length),
    high: Math.max(...pcts),
    low: Math.min(...pcts),
    weighted:
      wSum > 0
        ? Math.round(
            weightedItems.reduce((a, q) => a + (q.percentage as number) * (q.weightage as number), 0) / wSum,
          )
        : null,
    derived: true,
  };
}

export interface RadarPoint {
  key: string;
  label: string;
  value: number | null;
}

/** Keep ONLY axes with real values — "not evaluated" is never plotted as 0. */
export function getRadarPoints(
  overall: NormalizedOverall,
  defs: Array<{ key: string; label: string; get: (o: NormalizedOverall) => number | null | undefined }>,
): RadarPoint[] {
  return defs
    .map((d) => ({ key: d.key, label: d.label, value: d.get(overall) ?? null }))
    .filter((p): p is RadarPoint & { value: number } => p.value !== null)
    .map((p) => ({ ...p }));
}

export function commOf(overall: NormalizedOverall): Record<string, any> {
  return overall.communication || {};
}

export interface TopicGroup {
  label: string;
  /** Always true: topics are a heuristic UI grouping, never supplier data. */
  inferred: true;
}

const TOPIC_RULES: Array<{ label: string; test: RegExp }> = [
  { label: 'Memory & Pointers', test: /pointer|malloc|calloc|realloc|heap|stack|dangling|memory|address/i },
  { label: 'Control Flow', test: /while|for |loop|if |else|switch|break|continue|recursion/i },
  { label: 'Functions', test: /function|main\(|return|argument|parameter|call/i },
  { label: 'Data & Structures', test: /struct|array|variable|declaration|definition|type|enum|union/i },
  { label: 'OOP & Design', test: /class|object|inherit|polymorph|encapsulat|interface|design/i },
];

/** Heuristic bucket from question text. Presentation only — scores untouched. */
export function deriveTopic(question: string): TopicGroup {
  const rule = TOPIC_RULES.find((r) => r.test.test(question || ''));
  return { label: rule ? rule.label : 'General', inferred: true };
}

export interface DistributionBin {
  index: number;
  label: string;
  percentage: number | null;
}

/** Per-question percentages in index order (nulls preserved, never zeroed). */
export function getDistribution(questions: NormalizedQuestion[]): DistributionBin[] {
  return questions.map((q) => ({
    index: q.index,
    label: `Q${q.index}`,
    percentage: q.isGenerated ? q.percentage : null,
  }));
}

export function formatScore(value: number | null | undefined): string {
  return value === null || value === undefined ? 'N/A' : `${Math.round(value)}`;
}
