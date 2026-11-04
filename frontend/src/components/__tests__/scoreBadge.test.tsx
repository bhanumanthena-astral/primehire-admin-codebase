import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import ScoreBadge, { scoreTone } from '../ScoreBadge';

describe('scoreTone', () => {
  it('marks at/above threshold as success', () => {
    expect(scoreTone(78, 60)).toBe('success');
    expect(scoreTone(60, 60)).toBe('success');
  });

  it('marks near-misses as warning and clear misses as danger', () => {
    expect(scoreTone(50, 60)).toBe('warning');
    expect(scoreTone(20, 60)).toBe('danger');
  });

  it('is neutral when unscored', () => {
    expect(scoreTone(null, 60)).toBe('neutral');
  });
});

describe('ScoreBadge', () => {
  it('shows the score with a threshold marker', () => {
    render(<ScoreBadge score={78} threshold={60} />);
    expect(screen.getByLabelText(/Score 78 of 100, threshold 60/)).toBeInTheDocument();
    expect(screen.getByText('78%')).toBeInTheDocument();
    expect(screen.getByText('/ 60%')).toBeInTheDocument();
  });

  it('flags needs-review and low-confidence candidates', () => {
    render(<ScoreBadge score={42} threshold={60} needsReview lowConfidence />);
    expect(screen.getByText('Needs review')).toBeInTheDocument();
    expect(screen.getByText('Low confidence')).toBeInTheDocument();
  });
});
