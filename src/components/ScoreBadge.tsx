import React from 'react';
import { Pill } from './ui/primitives';

/**
 * Score badge: final score with a threshold marker and review flags.
 * Pure + exported internals for Vitest (consent/badge/reveal suite).
 */
export function scoreTone(score: number | null, threshold: number): 'success' | 'warning' | 'danger' | 'neutral' {
  if (score === null || score === undefined) return 'neutral';
  if (score >= threshold) return 'success';
  if (score >= threshold - 15) return 'warning';
  return 'danger';
}

export default function ScoreBadge({
  score,
  threshold,
  needsReview,
  lowConfidence,
}: {
  score: number | null;
  threshold: number;
  needsReview?: boolean;
  lowConfidence?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5" aria-label={`Score ${score ?? '—'} of 100, threshold ${threshold}`}>
      <Pill tone={scoreTone(score, threshold)}>
        {score === null || score === undefined ? '—' : `${score}%`}
      </Pill>
      <span className="text-xs opacity-60">/ {threshold}%</span>
      {needsReview && <Pill tone="warning">Needs review</Pill>}
      {lowConfidence && <Pill tone="warning">Low confidence</Pill>}
    </span>
  );
}
