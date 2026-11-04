import {Button} from '@/components/ui/button';
import type React from 'react';
import { useEffect, useState, Fragment } from 'react';
import { motion } from 'motion/react';
import { ChevronLeft, ChevronRight, AlertCircle } from 'lucide-react';
import QuestionList from './QuestionList';
import TranscriptPanel from './TranscriptPanel';
import ScoreBar from './ScoreBar';
import { getGrade, relevancyColor } from '../../utils/normalizeReport';
import type { NormalizedQuestion } from '../../utils/normalizeReport';

const DETAIL_TABS = ['Response', 'Transcript', 'Evaluation'] as const;

/**
 * Two-panel interactive review: question list (left) + selected question
 * (right). Only the selected video is ever mounted.
 */
export default function QuestionReview({
  questions,
  selectedIndex,
  onSelect,
  delay = 0,
}: {
  questions: NormalizedQuestion[];
  selectedIndex: number;
  onSelect: (i: number) => void;
  delay?: number;
}) {
  if (questions.length === 0) return null;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <QuestionList questions={questions} selectedIndex={selectedIndex} onSelect={onSelect} delay={delay} />
      <QuestionDetail q={questions[selectedIndex]} qkey={questions[selectedIndex]?.key ?? selectedIndex} delay={delay + 0.05} />
    </div>
  );
}

export function QuestionNavigate({
  index,
  total,
  onNavigate,
}: {
  index: number;
  total: number;
  onNavigate: (dir: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Button variant="ghost"
        type="button"
        onClick={() => onNavigate(-1)}
        disabled={index === 0}
        aria-label="Previous question"
        className="flex h-7 w-7 items-center justify-center rounded-md border border-border disabled:opacity-30 hover:bg-background"
      >
        <ChevronLeft size={14} />
      </Button>
      <span className="text-xs text-muted-foreground tnum">
        {index + 1} of {total}
      </span>
      <Button variant="ghost"
        type="button"
        onClick={() => onNavigate(1)}
        disabled={index === total - 1}
        aria-label="Next question"
        className="flex h-7 w-7 items-center justify-center rounded-md border border-border disabled:opacity-30 hover:bg-background"
      >
        <ChevronRight size={14} />
      </Button>
    </div>
  );
}

function QuestionDetail({ q, qkey, delay = 0 }: { q: NormalizedQuestion | undefined; qkey: string | number; delay?: number }) {
  const [tab, setTab] = useState<(typeof DETAIL_TABS)[number]>('Response');
  const [videoError, setVideoError] = useState(false);
  // Reset detail state whenever a different question is selected.
  useEffect(() => {
    setTab('Response');
    setVideoError(false);
  }, [qkey]);
  if (!q) return null;
  const grade = getGrade(q.percentage);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.3 }}
      className="rounded-2xl border border-border bg-card p-5 shadow-sm"
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[0.6875rem] font-bold uppercase tracking-wide text-muted-foreground">Question {q.index}</p>
          <p className="truncate text-sm font-semibold text-foreground" title={q.question}>
            {q.question || 'Untitled question'}
          </p>
        </div>
        <span
          className="shrink-0 rounded-full px-2.5 py-1 text-[0.6875rem] font-bold"
          style={{ background: grade.bg, color: grade.color }}
        >
          {q.isGenerated ? grade.letter : 'N/A'}
        </span>
      </div>

      {q.videoUrl && !videoError ? (
        <video
          key={q.videoUrl}
          src={q.videoUrl}
          controls
          preload="metadata"
          onError={() => setVideoError(true)}
          className="mb-4 aspect-video w-full rounded-xl bg-black"
          aria-label={`Video response for question ${q.index}`}
        >
          Your browser does not support video playback.
        </video>
      ) : (
        <div className="mb-4 flex aspect-video w-full items-center justify-center rounded-xl bg-muted text-sm text-muted-foreground">
          {q.videoUrl ? 'Video failed to load.' : 'No video available for this question.'}
        </div>
      )}

      <div className="mb-3 flex items-center gap-1 border-b border-border" role="tablist" aria-label="Question detail">
        {DETAIL_TABS.map((t) => (
          <Button variant="ghost"
            key={t}
            role="tab"
            aria-selected={tab === t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-xs font-medium transition-colors ${
              tab === t ? 'border-b-2 border-warning/30 text-warning font-semibold' : 'text-muted-foreground hover:text-muted-foreground'
            } -mb-px`}
          >
            {t}
          </Button>
        ))}
      </div>

      {tab === 'Response' && (
        <div className="space-y-2.5">
          <ScoreBar label="Obtained score" value={q.percentage} right={q.isGenerated ? `${q.obtainedScore} / ${q.maxScore}` : undefined} />
          {q.weightage !== null && (
            <p className="text-xs text-muted-foreground">
              Weightage: <b className="text-foreground">{q.weightage}%</b>
            </p>
          )}
          {!q.isGenerated && (
            <p className="flex items-start gap-1.5 text-xs italic text-warning">
              <AlertCircle size={13} className="mt-0.5 shrink-0" />
              {q.message || 'This response was not evaluated.'}
            </p>
          )}
        </div>
      )}

      {tab === 'Transcript' && <TranscriptPanel text={q.transcript} />}

      {tab === 'Evaluation' && (
        <div className="flex flex-wrap gap-2">
          {q.technicalScore !== null && <EvalChip label="Technical" value={q.technicalScore} />}
          {q.confidenceScore !== null && <EvalChip label="Confidence" value={q.confidenceScore} />}
          {q.communication &&
            Object.entries(q.communication).map(([k, v]) =>
              typeof v === 'number' && k !== 'overall_score' && k !== 'overallScore' ? (
                <Fragment key={k}>
                  <EvalChip label={k.replace(/_/g, ' ')} value={v} />
                </Fragment>
              ) : null,
            )}
          {q.communication?.overall_score !== undefined && typeof q.communication.overall_score === 'number' && (
            <EvalChip label="Communication" value={q.communication.overall_score} />
          )}
          {q.communication?.overallScore !== undefined && typeof q.communication.overallScore === 'number' && (
            <EvalChip label="Communication" value={q.communication.overallScore} />
          )}
          {q.relevancy && relevancyColor[q.relevancy] && (
            <span
              className="rounded-full px-2.5 py-1 text-xs font-medium"
              style={{ background: relevancyColor[q.relevancy].bg, color: relevancyColor[q.relevancy].color }}
            >
              Relevancy: {q.relevancy}
            </span>
          )}
          {q.technicalScore === null && q.confidenceScore === null && !q.communication && (
            <p className="text-xs italic text-muted-foreground">
              {q.message || 'No evaluation data for this question.'}
            </p>
          )}
        </div>
      )}
    </motion.div>
  );
}

function EvalChip({ label, value }: { key?: React.Key; label: string; value: number }) {
  const grade = getGrade(value);
  return (
    <span className="rounded-full border border-border bg-background px-2.5 py-1 text-xs capitalize text-muted-foreground">
      {label}: <b style={{ color: grade.color }}>{value}</b>
    </span>
  );
}
