import { useState, Fragment } from 'react';
import { motion } from 'framer-motion';
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
      className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm"
    >
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm font-semibold text-slate-800">Selected Question Review</p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onNavigate(-1)}
            disabled={selectedIndex === 0}
            className="h-7 w-7 rounded-md border border-slate-200 flex items-center justify-center disabled:opacity-30 hover:bg-slate-50"
          >
            <ChevronLeft size={14} />
          </button>
          <span className="text-xs text-slate-400">
            {selectedIndex + 1} of {questions.length}
          </span>
          <button
            onClick={() => onNavigate(1)}
            disabled={selectedIndex === questions.length - 1}
            className="h-7 w-7 rounded-md border border-slate-200 flex items-center justify-center disabled:opacity-30 hover:bg-slate-50"
          >
            <ChevronRight size={14} />
          </button>
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
        <div className="w-full aspect-video rounded-xl bg-slate-100 flex items-center justify-center mb-4 text-sm text-slate-400">
          No video available for this question
        </div>
      )}

      <p className="text-sm text-slate-700 font-medium mb-3">{q.question}</p>

      <div className="flex items-center gap-1 border-b border-slate-100 mb-3">
        {SUB_TABS.map((t) => (
          <button
            key={t}
            onClick={() => setSubTab(t)}
            className={`px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors ${
              subTab === t ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            {t}
          </button>
        ))}
        {subTab === 'Transcript' && q.transcript && (
          <button onClick={handleCopy} className="ml-auto flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 pb-2">
            {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}
          </button>
        )}
      </div>

      <div className="min-h-[100px]">
        {subTab === 'Transcript' && (
          <p className="text-sm text-slate-600 leading-relaxed">
            {q.transcript || <span className="italic text-slate-400">No transcript available.</span>}
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
            {!q.isGenerated && <p className="text-sm text-amber-600 italic">{q.message || 'This response was not evaluated.'}</p>}
          </div>
        )}

        {subTab === 'Feedback' && (
          <div className="text-sm text-slate-600">
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
              <p className="italic text-amber-600">{q.message || 'Not evaluated.'}</p>
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
    <span className="text-xs px-2.5 py-1 rounded-full border border-slate-200 bg-slate-50 text-slate-600 capitalize">
      {label.replace(/_/g, ' ')}: <b style={{ color: grade?.color || '#334155' }}>{value}</b>
    </span>
  );
}
