import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import AssessmentPreview, { AssessmentDraft } from '../components/AssessmentPreview';
import { asJobId } from '../lib/primehireIds';

const draft: AssessmentDraft = {
  jobId: asJobId('JOB-PREVIEW'), jobTitle: 'Developer', jobDescription: 'Build accessible interfaces',
  language: 'ENGLISH', roundType: 'TECHNICAL',
  startDate: '2026-10-13T06:30:00Z', endDate: '2026-10-14T06:30:00Z',
  questions: [{ id: 'q1', text: 'Choose the framework', type: 'MCQ', maxDuration: 60,
    options: ['React', 'Python', 'Docker', 'Git', 'SQL'], correctOption: 'React', maxScore: 50, weightage: 100 }],
};

const render = (data: AssessmentDraft) => renderToStaticMarkup(
  <AssessmentPreview draft={data} saving={false} onBack={() => {}} onConfirm={() => {}} />,
);

describe('Assessment preview content', () => {
  it('shows all five MCQ choices, the answer, scores, duration and IST window before creation', () => {
    const html = render(draft);
    for (const value of ['Developer', 'Build accessible interfaces', 'JOB-PREVIEW', 'ENGLISH', 'TECHNICAL',
      'Choose the framework', 'React', 'Python', 'Docker', 'Git', 'SQL', 'Correct', '60 seconds',
      'Maximum score: 50', 'Weightage: 100%', '13/10/2026', '14/10/2026', 'IST']) expect(html).toContain(value);
    expect(html).toContain('cannot be edited');
    expect(html).toMatch(/disabled=""[^>]*>.*?Confirm and create assessment/s);
  });

  it.each(['TECHNICAL', 'BASIC'] as const)('shows the applicable spoken answer or rubric for %s', roundType => {
    const html = render({ ...draft, roundType, questions: [{ id: 'q', text: 'Explain your approach',
      type: 'SPEAK_TO_ANSWER', maxDuration: 90, referenceAnswer: 'Technical reference text',
      criteria: 'Basic rubric text', maxScore: 10, weightage: 100 }] });
    expect(html).toContain(roundType === 'TECHNICAL' ? 'Technical reference text' : 'Basic rubric text');
    expect(html).not.toContain(roundType === 'TECHNICAL' ? 'Basic rubric text' : 'Technical reference text');
  });

  it('does not present unused reference answers or scoring fields for an HR spoken question', () => {
    const html = render({ ...draft, roundType: 'HR', questions: [{ id: 'q', text: 'Why this role?',
      type: 'SPEAK_TO_ANSWER', maxDuration: 90, referenceAnswer: 'Unused answer', maxScore: 50, weightage: 100 }] });
    expect(html).toContain('Why this role?');
    expect(html).not.toContain('Unused answer');
    expect(html).not.toContain('Maximum score');
    expect(html).not.toContain('Total weightage');
  });
});
