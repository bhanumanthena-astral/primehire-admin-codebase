import {Button} from '@/components/ui/button';
import { useState, Fragment } from 'react';
import { motion } from 'motion/react';
import { ChevronLeft, ChevronRight, Copy, Check } from 'lucide-react';
import { getGrade, relevancyColor } from '../../utils/normalizeReport';
import type { NormalizedQuestion } from '../../utils/normalizeReport';

const SUB_TABS = ['Transcript', 'AI Analysis', 'Feedback'];

export default function VideoReview({
  questions,
  selectedIndex,
  onNavigate,
  delay = 0,
}: {
  questions: NormalizedQuestion[];
  selectedIndex: number;
  onNavigate: (dir: number) => void;
  delay?: number;
}) {
  const [subTab, setSubTab] = useState('Transcript');
  const [copied, setCopied] = useState(false);

  const q = questions[selectedIndex];
  if (!q) return null;

  const grade = getGrade(q.percentage);

  const handleCopy = () => {
    if (!q.transcript) return;
    navigator.clipboard.writeText(q.transcript);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4 }}
      className="bg-card border border-border rounded-2xl p-5 shadow-sm"
    >
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm font-semibold text-foreground">Selected Question Review</p>
        <div className="flex items-center gap-2">
          <Button variant="ghost"
            onClick={() => onNavigate(-1)}
            disabled={selectedIndex === 0}
            className="h-7 w-7 rounded-md border border-border flex items-center justify-center disabled:opacity-30 hover:bg-background"
          >
            <ChevronLeft size={14} />
          </Button>
          <span className="text-xs text-muted-foreground">
            {selectedIndex + 1} of {questions.length}
          </span>
          <Button variant="ghost"
            onClick={() => onNavigate(1)}
            disabled={selectedIndex === questions.length - 1}
            className="h-7 w-7 rounded-md border border-border flex items-center justify-center disabled:opacity-30 hover:bg-background"
          >
            <ChevronRight size={14} />
          </Button>
        </div>
      </div>

      {/* REAL VIDEO PLAYER — uses the actual video_url from the JSON */}
      {q.videoUrl ? (
        <video
          key={q.videoUrl}
          src={q.videoUrl}
          controls
          preload="metadata"
          className="w-full rounded-xl bg-black aspect-video mb-4"
        >
          Your browser does not support video playback.
        </video>
      ) : (
        <div className="w-full aspect-video rounded-xl bg-muted flex items-center justify-center mb-4 text-sm text-muted-foreground">
          No video available for this question
        </div>
      )}

      <p className="text-sm text-foreground font-medium mb-3">{q.question}</p>

      <div className="flex items-center gap-1 border-b border-border mb-3">
        {SUB_TABS.map((t) => (
          <Button variant="ghost"
            key={t}
            onClick={() => setSubTab(t)}
            className={`px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors ${
              subTab === t ? 'border-warning/30 text-warning font-semibold' : 'border-transparent text-muted-foreground hover:text-muted-foreground'
            }`}
          >
            {t}
          </Button>
        ))}
        {subTab === 'Transcript' && q.transcript && (
          <Button variant="ghost" onClick={handleCopy} className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-muted-foreground pb-2">
            {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}
          </Button>
        )}
      </div>

      <div className="min-h-[100px]">
        {subTab === 'Transcript' && (
          <p className="text-sm text-muted-foreground leading-relaxed">
            {q.transcript || <span className="italic text-muted-foreground">No transcript available.</span>}
          </p>
        )}

        {subTab === 'AI Analysis' && (
          <div className="flex flex-wrap gap-2">
            {q.technicalScore !== null && <Chip label="Technical" value={q.technicalScore} />}
            {q.confidenceScore !== null && <Chip label="Confidence" value={q.confidenceScore} />}
            {q.communication &&
              Object.entries(q.communication).map(([k, v]) =>
                typeof v === 'number' && k !== 'overall_score' && k !== 'overallScore' ? (
                  <Fragment key={k}>
                    <Chip label={k} value={v} />
                  </Fragment>
                ) : null
              )}
            {q.relevancy && relevancyColor[q.relevancy] && (
              <span
                className="text-xs font-medium px-2.5 py-1 rounded-full"
                style={{
                  background: relevancyColor[q.relevancy].bg,
                  color: relevancyColor[q.relevancy].color,
                }}
              >
                Relevancy: {q.relevancy}
              </span>
            )}
            {q.weightage !== null && <Chip label="Weightage" value={`${q.weightage}%`} plain />}
            {!q.isGenerated && <p className="text-sm text-warning italic">{q.message || 'This response was not evaluated.'}</p>}
          </div>
        )}

        {subTab === 'Feedback' && (
          <div className="text-sm text-muted-foreground">
            {q.isGenerated ? (
              <p>
                This answer scored{' '}
                <b style={{ color: grade.color }}>
                  {q.obtainedScore}/{q.maxScore}
                </b>{' '}
                ({grade.letter} grade).{' '}
                {(q.percentage ?? 0) >= 70
                  ? 'Strong response with good conceptual clarity.'
                  : (q.percentage ?? 0) >= 40
                    ? 'Adequate response but has room for more depth and precision.'
                    : 'This response shows significant gaps and should be revisited.'}
              </p>
            ) : (
              <p className="italic text-warning">{q.message || 'Not evaluated.'}</p>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

function Chip({ label, value, plain }: { label: string; value: number | string; plain?: boolean }) {
  const grade = plain || typeof value !== 'number' ? null : getGrade(value);
  return (
    <span className="text-xs px-2.5 py-1 rounded-full border border-border bg-background text-muted-foreground capitalize">
      {label.replace(/_/g, ' ')}: <b style={{ color: grade?.color || '#334155' }}>{value}</b>
    </span>
  );
}
