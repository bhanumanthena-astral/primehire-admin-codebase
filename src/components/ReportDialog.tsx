/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { Candidate, AssessmentProfile } from '../types';
import { mockGetReport, mockRegenerateReport } from '../mockData';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  X, RefreshCw, AlertCircle, CheckCircle, Award, Star, ThumbsUp, ThumbsDown,
  Mic, Video, TrendingUp, MessageSquare, Brain, Activity, AlertTriangle,
  ChevronDown, ChevronUp, Play, Pause, Volume2, Maximize2, ShieldAlert,
  User, Mail, Briefcase, Calendar, CheckCircle2, ShieldCheck, Copy, Sparkles
} from 'lucide-react';
import { toast } from 'sonner';

// ─────────────────────────────────────────────────────────────────────────────
// SCORE UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

function getGrade(score: number): { grade: string; color: string; bg: string; border: string; label: string } {
  if (score >= 80) return { grade: 'A', color: 'text-success', bg: 'bg-success/10', border: 'border-success/20', label: 'Excellent' };
  if (score >= 60) return { grade: 'B', color: 'text-info', bg: 'bg-accent/10', border: 'border-accent/20', label: 'Good' };
  if (score >= 40) return { grade: 'C', color: 'text-warning', bg: 'bg-warning/15', border: 'border-warning/25', label: 'Average' };
  if (score >= 20) return { grade: 'D', color: 'text-warning', bg: 'bg-warning/15', border: 'border-warning/25', label: 'Below Average' };
  return { grade: 'E', color: 'text-destructive', bg: 'bg-destructive/10', border: 'border-destructive/20', label: 'Needs Improvement' };
}

function getBarColor(score: number): string {
  // locked grade palette: A #16a34a B #6366f1 C #eab308 D #f97316 E #ef4444
  if (score >= 80) return '#16a34a';
  if (score >= 60) return '#6366f1';
  if (score >= 40) return '#eab308';
  if (score >= 20) return '#f97316';
  return '#ef4444';
}

// ─────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

function ScoreBar({ label, score, max = 100 }: { label: string; score: number; max?: number }) {
  const pct = Math.min(100, Math.round((score / max) * 100));
  const { color, bg, border } = getGrade(pct);
  return (
    <div className="space-y-1.5 bg-card p-3 rounded-lg border border-border/60 shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-foreground">{label}</span>
        <div className="flex items-center gap-1.5">
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${bg} ${color} ${border} border font-mono tnum tabular-nums`}>
            {score} / {max}
          </span>
        </div>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, background: getBarColor(pct) }}
        />
      </div>
    </div>
  );
}

function ExecutiveScoreCard({
  label,
  score,
  icon,
  subtitle,
  accent = 'sky'
}: {
  label: string;
  score: number;
  icon: React.ReactNode;
  subtitle?: string;
  accent?: 'emerald' | 'sky' | 'indigo' | 'amber';
}) {
  const { grade, color, bg, border, label: gradeLabel } = getGrade(score);

  return (
    <div className="rounded-2xl border border-border/70 p-4 bg-card shadow-[var(--shadow-card)] space-y-3 relative overflow-hidden transition-all duration-200 hover:-translate-y-0.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-accent/10 text-accent border border-accent/15">
            {icon}
          </div>
          <div>
            <span className="text-xs font-semibold text-foreground uppercase tracking-wider block">{label}</span>
            {subtitle && <span className="text-[11px] text-muted-foreground">{subtitle}</span>}
          </div>
        </div>
        <div className={`text-xs font-semibold px-2.5 py-1 rounded-full ${bg} ${color} ${border} border`}>
          Grade {grade}
        </div>
      </div>

      <div className="flex items-baseline justify-between pt-1">
        <div className="flex items-baseline gap-1">
          <span className="text-2xl font-semibold tracking-tight text-foreground tnum tabular-nums">{score}</span>
          <span className="text-sm font-medium text-muted-foreground">/ 100</span>
        </div>
        <span className={`text-xs font-semibold ${color}`}>{gradeLabel}</span>
      </div>

      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.min(100, Math.max(0, score))}%`, background: getBarColor(score) }}
        />
      </div>
    </div>
  );
}

function VideoPlayer({ url, questionNum }: { url: string; questionNum: number }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  return (
    <div className="rounded-xl overflow-hidden border border-slate-800 bg-slate-950 shadow-md">
      <div className="relative aspect-video max-h-72 bg-black flex items-center justify-center">
        <video
          ref={videoRef}
          src={url}
          className="w-full h-full object-contain"
          controls
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => setIsPlaying(false)}
          preload="metadata"
        />
      </div>
      <div className="bg-gradient-primary border-t border-primary-foreground/15 px-3.5 py-2 flex items-center justify-between text-xs text-primary-foreground/80 font-mono">
        <div className="flex items-center gap-2">
          <Video className="w-3.5 h-3.5 text-sky-400" />
          <span>Question {questionNum} Video Recording</span>
        </div>
        <span className="text-[10px] text-muted-foreground bg-slate-800 px-2 py-0.5 rounded font-mono">WebM Stream</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// REAL REPORT RENDERER
// ─────────────────────────────────────────────────────────────────────────────

function RealTechnicalReport({
  report,
  candidate,
  assessment
}: {
  report: any;
  candidate: Candidate;
  assessment: AssessmentProfile;
}) {
  const [expandedQ, setExpandedQ] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Support both camelCase (from API proxy keysToCamel) and snake_case (raw API JSON)
  const reportData = report.report || report;
  const overall = reportData.overallResult || reportData.overall_result;
  const questions: any[] = reportData.questionWiseResult || reportData.question_wise_result || [];
  const faceViolations = report.faceapiViolations || report.faceapi_violations;
  const hasFaceViolations = faceViolations && Object.keys(faceViolations).length > 0;

  const techAnalysis = overall?.technicalAnalysis || overall?.technical_analysis;
  const commAnalysis = overall?.communicationAnalysis || overall?.communication_analysis;
  const intAnalysis = overall?.interviewAnalysis || overall?.interview_analysis;

  const techScore = techAnalysis?.overallScore ?? techAnalysis?.overall_score ?? 0;
  const commScore = commAnalysis?.overallScore ?? commAnalysis?.overall_score ?? 0;
  const confScore = intAnalysis?.confidenceScore ?? intAnalysis?.confidence_score ?? 0;

  const copyTranscript = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    toast.success('Transcript copied to clipboard!');
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="space-y-6 pt-2">

      {/* ── Proctoring & Integrity Audit Banner ───────────────────── */}
      {hasFaceViolations && (
        <div className="p-4 bg-destructive/5 border border-destructive/20 rounded-xl space-y-2 shadow-2xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-destructive font-bold text-xs uppercase tracking-wider">
              <ShieldAlert className="w-4 h-4 text-destructive" />
              Proctoring & Integrity Audit
            </div>
            <span className="text-[10px] font-bold bg-rose-100 text-rose-700 px-2 py-0.5 rounded border border-rose-200">
              AI Monitored
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 font-sans">
            <div className="bg-card border border-destructive/20 p-2.5 rounded-lg flex items-center justify-between text-xs">
              <span className="text-muted-foreground font-medium">Ideal Environment:</span>
              <span className="font-mono font-bold text-success bg-success/10 px-2 py-0.5 rounded border border-success/20">
                {faceViolations.idealEnvironment ?? faceViolations.ideal_environment ?? 0}
              </span>
            </div>
            <div className="bg-card border border-destructive/20 p-2.5 rounded-lg flex items-center justify-between text-xs">
              <span className="text-muted-foreground font-medium">Multiple Faces:</span>
              <span className={`font-mono font-bold px-2 py-0.5 rounded border ${
                (faceViolations.multipleFacesDetected ?? faceViolations.multiple_faces_detected ?? 0) > 0
                  ? 'bg-destructive/10 text-destructive border-destructive/20'
                  : 'bg-emerald-50 text-emerald-700 border-success/20'
              }`}>
                {faceViolations.multipleFacesDetected ?? faceViolations.multiple_faces_detected ?? 0}
              </span>
            </div>
            <div className="bg-card border border-destructive/20 p-2.5 rounded-lg flex items-center justify-between text-xs">
              <span className="text-muted-foreground font-medium">Tab Switching:</span>
              <span className={`font-mono font-bold px-2 py-0.5 rounded border ${
                (faceViolations.tabSwitching ?? faceViolations.tab_switching ?? 0) > 0
                  ? 'bg-destructive/10 text-destructive border-destructive/20'
                  : 'bg-emerald-50 text-emerald-700 border-success/20'
              }`}>
                {faceViolations.tabSwitching ?? faceViolations.tab_switching ?? 0}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── Executive Performance Summary Cards ────────────────────── */}
      {overall && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4 text-accent" /> Candidate Evaluation Overview
            </h3>
            <span className="text-[11px] font-semibold text-muted-foreground">
              Evaluated via PrimeHire AI Engine
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <ExecutiveScoreCard
              label="Technical Proficiency"
              score={techScore}
              icon={<Brain className="w-4 h-4" />}
              subtitle="Domain knowledge & correctness"
              accent="indigo"
            />
            <ExecutiveScoreCard
              label="Communication Index"
              score={commScore}
              icon={<MessageSquare className="w-4 h-4" />}
              subtitle="Fluency, grammar & articulation"
              accent="sky"
            />
            <ExecutiveScoreCard
              label="Interview Presence"
              score={confScore}
              icon={<Activity className="w-4 h-4" />}
              subtitle="Confidence & vocal delivery"
              accent="emerald"
            />
          </div>
        </div>
      )}

      {/* ── Communication Detailed Breakdown ─────────────────────── */}
      {commAnalysis && (
        <div className="bg-muted/40/80 border border-border/60 rounded-xl p-4 space-y-3 shadow-2xs">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Mic className="w-4 h-4 text-accent" /> Communication Sub-Metric Analysis
            </h3>
            <span className="text-[10px] font-bold bg-card text-muted-foreground border border-border/60 px-2 py-0.5 rounded-full">
              Speech Analytics
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <ScoreBar label="Fluency" score={commAnalysis.fluency ?? 0} />
            <ScoreBar label="Grammar" score={commAnalysis.grammar ?? 0} />
            <ScoreBar label="Pronunciation" score={commAnalysis.pronunciation ?? 0} />
            <ScoreBar label="Vocabulary" score={commAnalysis.vocabulary ?? 0} />
          </div>
        </div>
      )}

      {/* ── Detailed Question-Wise Performance ───────────────────── */}
      {questions.length > 0 && (
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-foreground flex items-center gap-1.5">
              <MessageSquare className="w-4 h-4 text-accent" /> Question-Wise Detailed Analysis ({questions.length})
            </h3>
            <button
              onClick={() => {
                if (expandedQ) setExpandedQ(null);
                else setExpandedQ(questions[0]?.id || 'q-0');
              }}
              className="text-xs font-bold text-accent hover:text-sky-700 hover:underline cursor-pointer"
            >
              {expandedQ ? 'Collapse All' : 'Expand All'}
            </button>
          </div>

          <div className="space-y-3">
            {questions.map((q: any, idx: number) => {
              const qId = q.id || `q-${idx}`;
              // Default first question expanded if none selected
              const isExpanded = expandedQ === qId || (expandedQ === null && idx === 0);
              const qResult = q.result || {};
              const qTech = qResult.technicalAnalysis || qResult.technical_analysis;
              const qComm = qResult.communicationAnalysis || qResult.communication_analysis;
              const qInt = qResult.interviewAnalysis || qResult.interview_analysis;

              const qTechScore = qTech?.overallScore ?? qTech?.overall_score ?? q.obtainedScore ?? q.obtained_score ?? 0;
              const obtainedScore = q.obtainedScore ?? q.obtained_score ?? 0;
              const maxScore = q.maxScore ?? q.max_score ?? 100;
              const scorePct = maxScore > 0 ? Math.round((obtainedScore / maxScore) * 100) : 0;
              const { grade, color, bg, border } = getGrade(qTechScore);

              const videoUrl = q.videoUrl || q.video_url;
              const hasVideo = !!videoUrl;
              const isResultGenerated = q.isResultGenerated ?? q.is_result_generated ?? true;
              const transcript = qResult.transcript || q.transcript || '';
              const questionText = q.question || q.text || '';
              const qType = q.type || 'SPEAK_TO_ANSWER';

              return (
                <div key={qId} className="border border-border/60 rounded-xl overflow-hidden bg-card shadow-2xs transition-all">
                  {/* Question header row */}
                  <button
                    onClick={() => setExpandedQ(isExpanded ? 'NONE' : qId)}
                    className="w-full text-left p-4 hover:bg-muted/40/80 transition-colors cursor-pointer"
                  >
                    <div className="flex items-start gap-3">
                      {/* Q Index */}
                      <div className="shrink-0 flex flex-col items-center gap-1 pt-0.5">
                        <div className="w-8 h-8 rounded-lg bg-gradient-primary text-white flex items-center justify-center text-xs font-black">
                          Q{idx + 1}
                        </div>
                        {isResultGenerated && (
                          <div className={`text-[9px] font-black px-1.5 py-0.5 rounded ${bg} ${color} ${border} border leading-none font-mono`}>
                            {grade}
                          </div>
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1.5">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground bg-muted px-2 py-0.5 rounded font-mono">
                            {qType.replace(/_/g, ' ')}
                          </span>
                          {hasVideo && (
                            <span className="text-[10px] font-bold bg-accent/10 text-accent border border-accent/20 px-2 py-0.5 rounded inline-flex items-center gap-1">
                              <Video className="w-3 h-3 text-accent" /> Video Response
                            </span>
                          )}
                          {!isResultGenerated && (
                            <span className="text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded">
                              Processing...
                            </span>
                          )}
                        </div>
                        <p className="text-sm font-bold text-foreground leading-relaxed">
                          {questionText}
                        </p>
                      </div>

                      {/* Score summary & Toggle chevron */}
                      <div className="shrink-0 flex flex-col items-end gap-1.5 ml-2">
                        {isResultGenerated && (
                          <div className="text-right">
                            <span className="text-base font-black text-foreground">
                              {obtainedScore}
                              <span className="text-xs font-semibold text-muted-foreground">/{maxScore}</span>
                            </span>
                            <div className="w-20 h-2 rounded-full bg-muted overflow-hidden mt-1">
                              <div
                                className={`h-full rounded-full ${getBarColor(scorePct)}`}
                                style={{ width: `${scorePct}%` }}
                              />
                            </div>
                          </div>
                        )}
                        {isExpanded
                          ? <ChevronUp className="w-5 h-5 text-muted-foreground mt-1" />
                          : <ChevronDown className="w-5 h-5 text-muted-foreground mt-1" />
                        }
                      </div>
                    </div>
                  </button>

                  {/* Expanded detail panel */}
                  {isExpanded && (
                    <div className="border-t border-border/60 p-5 space-y-5 bg-muted/40/60">
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                        {/* Left: Video Player + Transcript */}
                        <div className="space-y-4">
                          {hasVideo && videoUrl && (
                            <VideoPlayer url={videoUrl} questionNum={idx + 1} />
                          )}

                          {/* Candidate Transcript Box */}
                          {transcript ? (
                            <div className="bg-card border border-border/60 rounded-xl p-4 space-y-2 shadow-2xs relative">
                              <div className="flex items-center justify-between border-b border-border/60 pb-2">
                                <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
                                  <Mic className="w-4 h-4 text-accent" /> Candidate Speech Transcript
                                </div>
                                <button
                                  onClick={() => copyTranscript(transcript, qId)}
                                  className="text-[11px] font-semibold text-muted-foreground hover:text-accent flex items-center gap-1 cursor-pointer transition"
                                >
                                  <Copy className="w-3 h-3" />
                                  {copiedId === qId ? 'Copied' : 'Copy'}
                                </button>
                              </div>
                              <p className="text-xs text-foreground leading-relaxed italic bg-muted/40/80 p-3 rounded-lg border border-border/60">
                                "{transcript}"
                              </p>
                            </div>
                          ) : (
                            <div className="bg-card border border-border/60 rounded-xl p-4 text-center text-xs text-muted-foreground italic">
                              No spoken transcript captured for this question.
                            </div>
                          )}
                        </div>

                        {/* Right: Evaluation Metric Cards */}
                        <div className="space-y-3.5">
                          {/* Technical Score card */}
                          {qTech && (
                            <div className="bg-card border border-border/60 rounded-xl p-3.5 space-y-2 shadow-2xs">
                              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                                <Brain className="w-3.5 h-3.5 text-indigo-600" /> Technical Accuracy Analysis
                              </span>
                              <ScoreBar label="Technical Score" score={qTech.overallScore ?? qTech.overall_score ?? 0} />
                            </div>
                          )}

                          {/* Communication breakdown card */}
                          {qComm && (
                            <div className="bg-card border border-border/60 rounded-xl p-3.5 space-y-2.5 shadow-2xs">
                              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                                <MessageSquare className="w-3.5 h-3.5 text-accent" /> Communication Breakdown
                              </span>
                              <div className="grid grid-cols-2 gap-2">
                                <ScoreBar label="Fluency" score={qComm.fluency ?? 0} />
                                <ScoreBar label="Grammar" score={qComm.grammar ?? 0} />
                                <ScoreBar label="Pronunciation" score={qComm.pronunciation ?? 0} />
                                <ScoreBar label="Vocabulary" score={qComm.vocabulary ?? 0} />
                              </div>
                            </div>
                          )}

                          {/* Confidence Score card */}
                          {qInt && (
                            <div className="bg-card border border-border/60 rounded-xl p-3.5 space-y-2 shadow-2xs">
                              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                                <Activity className="w-3.5 h-3.5 text-success" /> Vocal Confidence & Delivery
                              </span>
                              <ScoreBar label="Confidence Score" score={qInt.confidenceScore ?? qInt.confidence_score ?? 0} />
                            </div>
                          )}

                          {/* Final Score Banner */}
                          <div className={`rounded-xl border p-4 flex items-center justify-between ${getGrade(scorePct).bg} ${getGrade(scorePct).border}`}>
                            <div>
                              <span className={`text-xs font-bold uppercase tracking-wider block ${getGrade(scorePct).color}`}>Question Obtained Score</span>
                              <span className="text-[11px] text-muted-foreground">Weightage: {q.weightage || 100}%</span>
                            </div>
                            <div className="text-right">
                              <span className={`text-2xl font-black ${getGrade(scorePct).color}`}>
                                {obtainedScore}
                              </span>
                              <span className="text-sm font-bold text-muted-foreground">/{maxScore}</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Notes / Message from evaluation engine */}
                      {q.message && (
                        <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
                          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
                          <div>
                            <span className="font-bold">Evaluation Note: </span>
                            {q.message}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN REPORT DIALOG
// ─────────────────────────────────────────────────────────────────────────────

interface ReportDialogProps {
  candidate: Candidate | null;
  assessment: AssessmentProfile | null;
  isOpen: boolean;
  onClose: () => void;
  onReportUpdated: (updatedCandidates: Candidate[]) => void;
  allCandidates: Candidate[];
}

export default function ReportDialog({ candidate, assessment, isOpen, onClose, onReportUpdated, allCandidates }: ReportDialogProps) {
  const [loading, setLoading] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [report, setReport] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && candidate) {
      fetchReport();
    } else {
      setReport(null);
      setError(null);
    }
  }, [isOpen, candidate]);

  const fetchReport = async () => {
    if (!candidate) return;
    setLoading(true);
    setError(null);
    try {
      const data = await mockGetReport(candidate.id, allCandidates);
      setReport(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load report data');
    } finally {
      setLoading(false);
    }
  };

  const handleRegenerate = async () => {
    if (!candidate) return;
    setRegenerating(true);
    try {
      const updatedCandidates = await mockRegenerateReport(candidate.id, allCandidates);
      onReportUpdated(updatedCandidates);
      toast.success('Evaluation report has been successfully regenerated!');
      await fetchReport();
    } catch (err: any) {
      toast.error('Failed to regenerate report: ' + err.message);
    } finally {
      setRegenerating(false);
    }
  };

  if (!candidate || !assessment) return null;

  const isRealReport = report?._isRealReport === true || !!report?.report || !!report?.interviewDetails || !!report?.interview_details;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-5xl lg:max-w-6xl max-h-[92vh] overflow-y-auto text-foreground bg-card border border-border/60 shadow-2xl p-0 font-sans rounded-2xl">
        
        {/* ── Executive Header Banner ── */}
        <div className="sticky top-0 z-20 bg-card/95 backdrop-blur-md border-b border-border/60 px-6 py-4 shadow-2xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            
            {/* Candidate Metadata Summary */}
            <div className="flex items-center gap-3.5">
              <div className="w-11 h-11 rounded-xl bg-gradient-primary text-white flex items-center justify-center font-black text-lg shadow-sm shrink-0">
                {candidate.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-extrabold text-foreground">{candidate.name}</h2>
                  <span className="text-[10px] font-mono bg-muted text-muted-foreground px-2 py-0.5 rounded border border-border/60">
                    {candidate.email}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                  <span className="font-semibold text-foreground">{assessment.jobTitle}</span>
                  <span>•</span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {candidate.submittedDate ? candidate.submittedDate : 'Submitted'}
                  </span>
                </div>
              </div>
            </div>

            {/* Status Tags */}
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[10px] font-extrabold tracking-wider px-2.5 py-1 rounded-lg border border-border/60 bg-muted text-foreground uppercase">
                {assessment.roundType} Round
              </span>
              <span className={`text-[10px] font-semibold tracking-wider px-2.5 py-1 rounded-full border uppercase inline-flex items-center gap-1 ${
                candidate.reportStatus === 'GENERATED'
                  ? 'bg-success/10 border-success/20 text-success'
                  : 'bg-warning/15 border-warning/25 text-warning'
              }`}>
                <CheckCircle2 className="w-3 h-3" />
                {candidate.reportStatus === 'GENERATED' ? 'Evaluated' : candidate.reportStatus || 'Pending'}
              </span>
            </div>
          </div>
        </div>

        {/* ── Dialog Body Content ── */}
        <div className="px-6 pb-6 pt-2">
          {loading ? (
            <div className="py-24 flex flex-col items-center justify-center gap-3 text-muted-foreground">
              <RefreshCw className="w-8 h-8 animate-spin text-accent" />
              <span className="text-xs font-bold text-muted-foreground">Retrieving evaluation metrics & response media...</span>
            </div>
          ) : error ? (
            <div className="py-16 text-center text-destructive flex flex-col items-center gap-2">
              <AlertCircle className="w-10 h-10 text-destructive" />
              <p className="font-semibold text-sm text-foreground">Error Loading Evaluation Report</p>
              <p className="text-xs text-muted-foreground max-w-md">{error}</p>
              <div className="flex items-center gap-3 mt-6">
                <button
                  onClick={fetchReport}
                  className="px-4 py-2 bg-muted hover:bg-muted/70 text-foreground rounded-full text-xs font-semibold cursor-pointer transition"
                >
                  Retry Load
                </button>
                <button
                  onClick={handleRegenerate}
                  disabled={regenerating}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-foreground border border-border/70 hover:bg-muted rounded-full transition disabled:opacity-50 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${regenerating ? 'animate-spin' : ''}`} />
                  {regenerating ? 'Regenerating...' : 'Regenerate Report'}
                </button>
              </div>
            </div>
          ) : report ? (
            <>
              <RealTechnicalReport report={report} candidate={candidate} assessment={assessment} />

              {/* ── Modal Footer Bar ── */}
              <div className="flex justify-between items-center border-t border-border/60 pt-4 mt-8">
                <button
                  onClick={handleRegenerate}
                  disabled={regenerating}
                  className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-foreground border border-border/70 hover:bg-muted rounded-full transition disabled:opacity-50 cursor-pointer shadow-[var(--shadow-card)]"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${regenerating ? 'animate-spin' : ''}`} />
                  {regenerating ? 'Regenerating Report...' : 'Regenerate Evaluation'}
                </button>

                <button
                  onClick={onClose}
                  className="px-6 py-2.5 text-xs font-semibold text-primary-foreground rounded-full bg-gradient-primary hover:-translate-y-0.5 hover:shadow-[var(--shadow-glow)] transition-all duration-200 cursor-pointer"
                >
                  Close Report
                </button>
              </div>
            </>
          ) : (
            <div className="py-24 text-center text-muted-foreground text-xs font-medium">
              No evaluation report data available for this candidate.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
