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
  if (score >= 80) return { grade: 'A', color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200', label: 'Excellent' };
  if (score >= 60) return { grade: 'B', color: 'text-sky-700',     bg: 'bg-sky-50',     border: 'border-sky-200',     label: 'Good' };
  if (score >= 40) return { grade: 'C', color: 'text-amber-700',   bg: 'bg-amber-50',   border: 'border-amber-200',   label: 'Average' };
  if (score >= 20) return { grade: 'D', color: 'text-orange-700',  bg: 'bg-orange-50',  border: 'border-orange-200',  label: 'Below Average' };
  return           { grade: 'E', color: 'text-rose-700',    bg: 'bg-rose-50',    border: 'border-rose-200',    label: 'Needs Improvement' };
}

function getBarColor(score: number): string {
  if (score >= 80) return 'bg-emerald-500';
  if (score >= 60) return 'bg-sky-500';
  if (score >= 40) return 'bg-amber-500';
  if (score >= 20) return 'bg-orange-500';
  return 'bg-rose-500';
}

// ─────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

function ScoreBar({ label, score, max = 100 }: { label: string; score: number; max?: number }) {
  const pct = Math.min(100, Math.round((score / max) * 100));
  const { color, bg, border } = getGrade(pct);
  return (
    <div className="space-y-1.5 bg-white p-2.5 rounded-lg border border-slate-200/80 shadow-2xs">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-700">{label}</span>
        <div className="flex items-center gap-1.5">
          <span className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded ${bg} ${color} ${border} border font-mono`}>
            {score} / {max}
          </span>
        </div>
      </div>
      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${getBarColor(pct)}`}
          style={{ width: `${pct}%` }}
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
    <div className={`rounded-xl border p-4 bg-white shadow-xs border-slate-200 space-y-3 relative overflow-hidden`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-lg bg-slate-100 text-slate-700">
            {icon}
          </div>
          <div>
            <span className="text-xs font-bold text-slate-800 uppercase tracking-wider block">{label}</span>
            {subtitle && <span className="text-[11px] text-slate-500">{subtitle}</span>}
          </div>
        </div>
        <div className={`text-sm font-black px-2.5 py-1 rounded-md ${bg} ${color} ${border} border`}>
          Grade {grade}
        </div>
      </div>

      <div className="flex items-baseline justify-between pt-1">
        <div className="flex items-baseline gap-1">
          <span className="text-3xl font-black text-slate-900 tracking-tight">{score}</span>
          <span className="text-sm font-bold text-slate-400">/ 100</span>
        </div>
        <span className={`text-xs font-bold ${color}`}>{gradeLabel}</span>
      </div>

      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${getBarColor(score)}`}
          style={{ width: `${Math.min(100, Math.max(0, score))}%` }}
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
      <div className="bg-slate-900 border-t border-slate-800 px-3.5 py-2 flex items-center justify-between text-xs text-slate-300 font-mono">
        <div className="flex items-center gap-2">
          <Video className="w-3.5 h-3.5 text-sky-400" />
          <span>Question {questionNum} Video Recording</span>
        </div>
        <span className="text-[10px] text-slate-500 bg-slate-800 px-2 py-0.5 rounded font-mono">WebM Stream</span>
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
        <div className="p-4 bg-rose-50/80 border border-rose-200 rounded-xl space-y-2 shadow-2xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-rose-800 font-bold text-xs uppercase tracking-wider">
              <ShieldAlert className="w-4 h-4 text-rose-600" />
              Proctoring & Integrity Audit
            </div>
            <span className="text-[10px] font-bold bg-rose-100 text-rose-700 px-2 py-0.5 rounded border border-rose-200">
              AI Monitored
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 font-sans">
            <div className="bg-white border border-rose-150 p-2.5 rounded-lg flex items-center justify-between text-xs">
              <span className="text-slate-600 font-medium">Ideal Environment:</span>
              <span className="font-mono font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                {faceViolations.idealEnvironment ?? faceViolations.ideal_environment ?? 0}
              </span>
            </div>
            <div className="bg-white border border-rose-150 p-2.5 rounded-lg flex items-center justify-between text-xs">
              <span className="text-slate-600 font-medium">Multiple Faces:</span>
              <span className={`font-mono font-bold px-2 py-0.5 rounded border ${
                (faceViolations.multipleFacesDetected ?? faceViolations.multiple_faces_detected ?? 0) > 0
                  ? 'bg-rose-100 text-rose-700 border-rose-200'
                  : 'bg-emerald-50 text-emerald-700 border-emerald-200'
              }`}>
                {faceViolations.multipleFacesDetected ?? faceViolations.multiple_faces_detected ?? 0}
              </span>
            </div>
            <div className="bg-white border border-rose-150 p-2.5 rounded-lg flex items-center justify-between text-xs">
              <span className="text-slate-600 font-medium">Tab Switching:</span>
              <span className={`font-mono font-bold px-2 py-0.5 rounded border ${
                (faceViolations.tabSwitching ?? faceViolations.tab_switching ?? 0) > 0
                  ? 'bg-rose-100 text-rose-700 border-rose-200'
                  : 'bg-emerald-50 text-emerald-700 border-emerald-200'
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
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4 text-sky-600" /> Candidate Evaluation Overview
            </h3>
            <span className="text-[11px] font-semibold text-slate-400">
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
        <div className="bg-slate-50/80 border border-slate-200 rounded-xl p-4 space-y-3 shadow-2xs">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
              <Mic className="w-4 h-4 text-sky-600" /> Communication Sub-Metric Analysis
            </h3>
            <span className="text-[10px] font-bold bg-white text-slate-600 border border-slate-200 px-2 py-0.5 rounded-full">
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
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
              <MessageSquare className="w-4 h-4 text-sky-600" /> Question-Wise Detailed Analysis ({questions.length})
            </h3>
            <button
              onClick={() => {
                if (expandedQ) setExpandedQ(null);
                else setExpandedQ(questions[0]?.id || 'q-0');
              }}
              className="text-xs font-bold text-sky-600 hover:text-sky-700 hover:underline cursor-pointer"
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
                <div key={qId} className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-2xs transition-all">
                  {/* Question header row */}
                  <button
                    onClick={() => setExpandedQ(isExpanded ? 'NONE' : qId)}
                    className="w-full text-left p-4 hover:bg-slate-50/80 transition-colors cursor-pointer"
                  >
                    <div className="flex items-start gap-3">
                      {/* Q Index */}
                      <div className="shrink-0 flex flex-col items-center gap-1 pt-0.5">
                        <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center text-xs font-black">
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
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-slate-100 px-2 py-0.5 rounded font-mono">
                            {qType.replace(/_/g, ' ')}
                          </span>
                          {hasVideo && (
                            <span className="text-[10px] font-bold bg-sky-50 text-sky-700 border border-sky-200 px-2 py-0.5 rounded inline-flex items-center gap-1">
                              <Video className="w-3 h-3 text-sky-600" /> Video Response
                            </span>
                          )}
                          {!isResultGenerated && (
                            <span className="text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded">
                              Processing...
                            </span>
                          )}
                        </div>
                        <p className="text-sm font-bold text-slate-900 leading-relaxed">
                          {questionText}
                        </p>
                      </div>

                      {/* Score summary & Toggle chevron */}
                      <div className="shrink-0 flex flex-col items-end gap-1.5 ml-2">
                        {isResultGenerated && (
                          <div className="text-right">
                            <span className="text-base font-black text-slate-900">
                              {obtainedScore}
                              <span className="text-xs font-semibold text-slate-400">/{maxScore}</span>
                            </span>
                            <div className="w-20 h-2 rounded-full bg-slate-100 overflow-hidden mt-1">
                              <div
                                className={`h-full rounded-full ${getBarColor(scorePct)}`}
                                style={{ width: `${scorePct}%` }}
                              />
                            </div>
                          </div>
                        )}
                        {isExpanded
                          ? <ChevronUp className="w-5 h-5 text-slate-400 mt-1" />
                          : <ChevronDown className="w-5 h-5 text-slate-400 mt-1" />
                        }
                      </div>
                    </div>
                  </button>

                  {/* Expanded detail panel */}
                  {isExpanded && (
                    <div className="border-t border-slate-200 p-5 space-y-5 bg-slate-50/60">
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                        {/* Left: Video Player + Transcript */}
                        <div className="space-y-4">
                          {hasVideo && videoUrl && (
                            <VideoPlayer url={videoUrl} questionNum={idx + 1} />
                          )}

                          {/* Candidate Transcript Box */}
                          {transcript ? (
                            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2 shadow-2xs relative">
                              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                                  <Mic className="w-4 h-4 text-sky-600" /> Candidate Speech Transcript
                                </div>
                                <button
                                  onClick={() => copyTranscript(transcript, qId)}
                                  className="text-[11px] font-semibold text-slate-500 hover:text-sky-600 flex items-center gap-1 cursor-pointer transition"
                                >
                                  <Copy className="w-3 h-3" />
                                  {copiedId === qId ? 'Copied' : 'Copy'}
                                </button>
                              </div>
                              <p className="text-xs text-slate-700 leading-relaxed italic bg-slate-50/80 p-3 rounded-lg border border-slate-150">
                                "{transcript}"
                              </p>
                            </div>
                          ) : (
                            <div className="bg-white border border-slate-200 rounded-xl p-4 text-center text-xs text-slate-400 italic">
                              No spoken transcript captured for this question.
                            </div>
                          )}
                        </div>

                        {/* Right: Evaluation Metric Cards */}
                        <div className="space-y-3.5">
                          {/* Technical Score card */}
                          {qTech && (
                            <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-2 shadow-2xs">
                              <span className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                                <Brain className="w-3.5 h-3.5 text-indigo-600" /> Technical Accuracy Analysis
                              </span>
                              <ScoreBar label="Technical Score" score={qTech.overallScore ?? qTech.overall_score ?? 0} />
                            </div>
                          )}

                          {/* Communication breakdown card */}
                          {qComm && (
                            <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-2.5 shadow-2xs">
                              <span className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                                <MessageSquare className="w-3.5 h-3.5 text-sky-600" /> Communication Breakdown
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
                            <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-2 shadow-2xs">
                              <span className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                                <Activity className="w-3.5 h-3.5 text-emerald-600" /> Vocal Confidence & Delivery
                              </span>
                              <ScoreBar label="Confidence Score" score={qInt.confidenceScore ?? qInt.confidence_score ?? 0} />
                            </div>
                          )}

                          {/* Final Score Banner */}
                          <div className={`rounded-xl border p-4 flex items-center justify-between ${getGrade(scorePct).bg} ${getGrade(scorePct).border}`}>
                            <div>
                              <span className={`text-xs font-bold uppercase tracking-wider block ${getGrade(scorePct).color}`}>Question Obtained Score</span>
                              <span className="text-[11px] text-slate-500">Weightage: {q.weightage || 100}%</span>
                            </div>
                            <div className="text-right">
                              <span className={`text-2xl font-black ${getGrade(scorePct).color}`}>
                                {obtainedScore}
                              </span>
                              <span className="text-sm font-bold text-slate-400">/{maxScore}</span>
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
      <DialogContent className="max-w-5xl lg:max-w-6xl max-h-[92vh] overflow-y-auto text-slate-900 bg-white border border-slate-200 shadow-2xl p-0 font-sans rounded-2xl">
        
        {/* ── Executive Header Banner ── */}
        <div className="sticky top-0 z-20 bg-white/95 backdrop-blur-md border-b border-slate-200 px-6 py-4 shadow-2xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            
            {/* Candidate Metadata Summary */}
            <div className="flex items-center gap-3.5">
              <div className="w-11 h-11 rounded-xl bg-slate-900 text-white flex items-center justify-center font-black text-lg shadow-sm shrink-0">
                {candidate.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-extrabold text-slate-900">{candidate.name}</h2>
                  <span className="text-[10px] font-mono bg-slate-100 text-slate-600 px-2 py-0.5 rounded border border-slate-200">
                    {candidate.email}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                  <span className="font-semibold text-slate-700">{assessment.jobTitle}</span>
                  <span>•</span>
                  <span className="font-mono text-[11px] text-slate-400">
                    {candidate.submittedDate ? candidate.submittedDate : 'Submitted'}
                  </span>
                </div>
              </div>
            </div>

            {/* Status Tags */}
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[10px] font-extrabold tracking-wider px-2.5 py-1 rounded-lg border border-slate-200 bg-slate-100 text-slate-700 uppercase">
                {assessment.roundType} Round
              </span>
              <span className={`text-[10px] font-extrabold tracking-wider px-2.5 py-1 rounded-lg border uppercase inline-flex items-center gap-1 ${
                candidate.reportStatus === 'GENERATED'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                  : 'bg-amber-50 border-amber-200 text-amber-700'
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
            <div className="py-24 flex flex-col items-center justify-center gap-3 text-slate-400">
              <RefreshCw className="w-8 h-8 animate-spin text-sky-600" />
              <span className="text-xs font-bold text-slate-500">Retrieving evaluation metrics & response media...</span>
            </div>
          ) : error ? (
            <div className="py-16 text-center text-rose-600 flex flex-col items-center gap-2">
              <AlertCircle className="w-10 h-10 text-rose-500" />
              <p className="font-bold text-sm">Error Loading Evaluation Report</p>
              <p className="text-xs text-slate-500 max-w-md">{error}</p>
              <div className="flex items-center gap-3 mt-6">
                <button
                  onClick={fetchReport}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-bold cursor-pointer transition"
                >
                  Retry Load
                </button>
                <button
                  onClick={handleRegenerate}
                  disabled={regenerating}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-slate-700 hover:text-slate-900 border border-slate-200 hover:bg-slate-50 rounded-lg transition disabled:opacity-50 cursor-pointer"
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
              <div className="flex justify-between items-center border-t border-slate-200 pt-4 mt-8">
                <button
                  onClick={handleRegenerate}
                  disabled={regenerating}
                  className="flex items-center gap-2 px-4 py-2 text-xs font-bold text-slate-700 hover:text-slate-900 border border-slate-200 hover:bg-slate-50 rounded-xl transition disabled:opacity-50 cursor-pointer shadow-2xs"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${regenerating ? 'animate-spin' : ''}`} />
                  {regenerating ? 'Regenerating Report...' : 'Regenerate Evaluation'}
                </button>

                <button
                  onClick={onClose}
                  className="px-6 py-2.5 text-xs font-extrabold text-white rounded-xl bg-[var(--purple-700)] hover:bg-[var(--purple-600)] transition cursor-pointer shadow-xs"
                >
                  Close Report
                </button>
              </div>
            </>
          ) : (
            <div className="py-24 text-center text-slate-400 text-xs font-medium">
              No evaluation report data available for this candidate.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
