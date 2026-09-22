/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { Candidate, AssessmentProfile, Question } from '../types';
import { 
  CheckCircle, 
  AlertCircle, 
  Mic, 
  MicOff, 
  Video, 
  Volume2, 
  Lock, 
  Play, 
  ArrowRight, 
  ArrowLeft, 
  Sparkles, 
  Check, 
  RotateCcw, 
  HelpCircle,
  Clock,
  Loader2
} from 'lucide-react';
import { toast } from 'sonner';

interface CandidateWorkspaceSimulatorProps {
  candidate: Candidate;
  assessment: AssessmentProfile;
  onSubmit: (answers: Record<string, string>, simulatedReport: any) => void;
  onClose: () => void;
}

type StepType = 'LOGIN' | 'CALIBRATION' | 'INSTRUCTIONS' | 'TEST' | 'SUBMITTING' | 'COMPLETE';

export default function CandidateWorkspaceSimulator({
  candidate,
  assessment,
  onSubmit,
  onClose
}: CandidateWorkspaceSimulatorProps) {
  const [step, setStep] = useState<StepType>('LOGIN');
  const [passwordInput, setPasswordInput] = useState('');
  
  // Calibration steps
  const [micActive, setMicActive] = useState(false);
  const [camActive, setCamActive] = useState(false);
  const [micLevel, setMicLevel] = useState(0);

  // Test states
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  
  // Recording states
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [questionTimer, setQuestionTimer] = useState(0);
  const [customTranscript, setCustomTranscript] = useState('');

  // Submitting evaluation animation states
  const [evalStep, setEvalStep] = useState(0);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number | null>(null);

  const questions = assessment.questions;
  const currentQuestion = questions[currentQuestionIndex];

  // Simulated Mic meter
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (micActive) {
      interval = setInterval(() => {
        setMicLevel(Math.floor(Math.random() * 60) + 20);
      }, 150);
    } else {
      setMicLevel(0);
    }
    return () => clearInterval(interval);
  }, [micActive]);

  // Audio wave visualizer animation during recording
  useEffect(() => {
    if (isRecording) {
      let phase = 0;
      const draw = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = '#111827';
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        
        ctx.beginPath();
        const width = canvas.width;
        const height = canvas.height;
        const midY = height / 2;
        
        // Draw 3 layers of overlapping waves
        for (let wave = 0; wave < 3; wave++) {
          ctx.beginPath();
          ctx.strokeStyle = wave === 0 ? 'rgba(17, 24, 39, 0.9)' : wave === 1 ? 'rgba(79, 70, 229, 0.4)' : 'rgba(16, 185, 129, 0.4)';
          ctx.lineWidth = wave === 0 ? 2 : 1.5;
          const amplitude = (wave === 0 ? 20 : wave === 1 ? 12 : 8) * (micLevel / 100 + 0.2);
          
          for (let x = 0; x < width; x++) {
            const angle = (x / width) * Math.PI * 4 + phase + (wave * 2);
            const y = midY + Math.sin(angle) * amplitude;
            if (x === 0) {
              ctx.moveTo(x, y);
            } else {
              ctx.lineTo(x, y);
            }
          }
          ctx.stroke();
        }
        
        phase += 0.15;
        animFrameRef.current = requestAnimationFrame(draw);
      };
      draw();
    } else {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    }
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isRecording, micLevel]);

  // Question Timer count down
  useEffect(() => {
    if (step === 'TEST' && currentQuestion) {
      // Reset timer for question
      setQuestionTimer(currentQuestion.maxDuration);
      
      if (timerRef.current) clearInterval(timerRef.current);
      
      timerRef.current = setInterval(() => {
        setQuestionTimer(prev => {
          if (prev <= 1) {
            // Auto skip or stop recording
            handleNextQuestion();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [step, currentQuestionIndex]);

  // Recording counter
  useEffect(() => {
    if (isRecording) {
      setRecordingSeconds(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds(prev => prev + 1);
      }, 1000);
    } else {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    }
    return () => {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    };
  }, [isRecording]);

  const handlePasswordLogin = () => {
    if (passwordInput.trim() === candidate.password) {
      toast.success('Access credentials authenticated. Commencing system check.');
      setStep('CALIBRATION');
    } else {
      toast.error('Invalid access password. Please copy the password from the table.');
    }
  };

  const startRecording = () => {
    setIsRecording(true);
    setMicLevel(40);
    // Auto-populate some spoken speech simulation text after a few seconds
    setTimeout(() => {
      if (isRecording) return; // guard
    }, 2000);
  };

  const stopRecording = () => {
    setIsRecording(false);
    // Autofill simulated transcription based on question text if they didn't write anything
    if (!customTranscript.trim()) {
      const responses: Record<string, string> = {
        'Senior React Developer': `We use useMemo to memoize heavy calculations so they don't block the thread during state re-renders. useCallback is specifically used to preserve callback references between renders, which prevents child components from unneeded paint loops. I would always default to primitive dependencies.`,
        'Customer Success Specialist': `My main priority would be showing deep empathy to the customer. I will reassure them that we possess database snapshots and backup servers that can recover data. I would stay calm, escalate to engineering immediately, and keep them informed of every progress step.`,
        'HR Operations Manager': `I would arrange structured one-on-one sessions with each leader to isolate their personal blockers. Next, I would host a joint session focusing strictly on team KPIs rather than emotional friction. Finally, we would lock in daily brief alignments to restore workplace collaboration.`,
      };
      
      const defaultResp = `My recommendation for resolving this is to establish a secure fallback routine, keeping performance and team cohesion at the center. We should monitor indicators and adjust our response metrics continuously.`;
      
      const matchKey = Object.keys(responses).find(key => assessment.jobTitle.includes(key) || key.includes(assessment.jobTitle));
      const textToSet = matchKey ? responses[matchKey] : defaultResp;
      setCustomTranscript(textToSet);
      setAnswers(prev => ({
        ...prev,
        [currentQuestion.id]: textToSet
      }));
    } else {
      setAnswers(prev => ({
        ...prev,
        [currentQuestion.id]: customTranscript
      }));
    }
    toast.success('Audio answer recorded and transcribed successfully.');
  };

  const handleMCQSelect = (opt: string) => {
    setAnswers(prev => ({
      ...prev,
      [currentQuestion.id]: opt
    }));
  };

  const handleNextQuestion = () => {
    if (isRecording) {
      stopRecording();
    }
    setCustomTranscript('');
    
    if (currentQuestionIndex < questions.length - 1) {
      setCurrentQuestionIndex(prev => prev + 1);
    } else {
      setStep('INSTRUCTIONS'); // Or a final preview step before submission
    }
  };

  const handlePrevQuestion = () => {
    if (isRecording) {
      stopRecording();
    }
    setCustomTranscript('');
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex(prev => prev - 1);
    }
  };

  const triggerEvaluationProcess = () => {
    setStep('SUBMITTING');
    setEvalStep(0);

    // Sequence of mock AI steps
    const timers = [
      setTimeout(() => setEvalStep(1), 1000), // Uploading audio
      setTimeout(() => setEvalStep(2), 2200), // AI Analysis
      setTimeout(() => setEvalStep(3), 3500), // Building scorecard
      setTimeout(() => setEvalStep(4), 4500), // Completed!
    ];

    // Grading logic based on the user's answers
    setTimeout(() => {
      // Calculate MCQ score and assemble feed
      let mcqScore = 0;
      let totalMaxMcq = 0;
      let totalQuestionsGraded = 0;
      let overallGradedSum = 0;
      
      const feedbackList: any[] = [];
      const strengthsList: string[] = [];
      const weaknessesList: string[] = [];

      questions.forEach((q, idx) => {
        const ans = answers[q.id] || '';
        const maxQScore = q.maxScore || 10;
        
        if (q.type === 'MCQ') {
          totalMaxMcq += maxQScore;
          const isCorrect = ans === q.correctOption;
          const scoreGained = isCorrect ? maxQScore : 0;
          mcqScore += scoreGained;
          overallGradedSum += scoreGained;
          totalQuestionsGraded += maxQScore;

          feedbackList.push({
            questionId: q.id,
            score: scoreGained,
            maxScore: maxQScore,
            feedback: isCorrect 
              ? `Correctly answered the MCQ option [${q.correctOption}] instantly. Outstanding knowledge accuracy.`
              : `Incorrectly selected [${ans || 'No response'}]. The correct option was [${q.correctOption}]. Recommendation: review standard guidelines.`
          });

          if (isCorrect) {
            strengthsList.push(`Excellent theoretical knowledge of subject matter (Question #${idx + 1}).`);
          } else {
            weaknessesList.push(`Needs structural review of MCQ core specifications.`);
          }
        } else {
          // Speak to answer
          totalQuestionsGraded += maxQScore;
          // evaluate answer depth
          let scoreGained = Math.floor(maxQScore * 0.75); // default base score
          let feedMessage = '';

          if (!ans.trim() || ans.length < 10) {
            scoreGained = 0;
            feedMessage = 'The candidate provided no audible or text response. Voice answer transcript was empty. Scoring zero for this metric.';
            weaknessesList.push(`Did not respond or expand details on verbal Question #${idx + 1}.`);
          } else {
            // Check keywords
            const textLower = ans.toLowerCase();
            const keywordHits: string[] = [];
            
            if (textLower.includes('memo') || textLower.includes('usememo')) keywordHits.push('memoization');
            if (textLower.includes('callback') || textLower.includes('reference')) keywordHits.push('reference safety');
            if (textLower.includes('empathy') || textLower.includes('calm')) keywordHits.push('de-escalation pacing');
            if (textLower.includes('escalate') || textLower.includes('engineer')) keywordHits.push('operational workflow');
            if (textLower.includes('conflict') || textLower.includes('session')) keywordHits.push('collaborative strategy');

            if (keywordHits.length >= 2) {
              scoreGained = Math.floor(maxQScore * 0.95);
              feedMessage = `Outstanding verbal answer! Accurately highlighted crucial concepts including ${keywordHits.join(' and ')}. Speech cadence was clear and vocabulary highly appropriate.`;
              strengthsList.push(`Highly articulate explanation of complex scenarios on Question #${idx + 1}.`);
            } else if (keywordHits.length === 1) {
              scoreGained = Math.floor(maxQScore * 0.85);
              feedMessage = `Strong vocal response, highlighting standard concepts of ${keywordHits[0]}. Recommended to enrich with slightly deeper technical metrics.`;
              strengthsList.push(`Solid foundational verbal explanation.`);
            } else {
              scoreGained = Math.floor(maxQScore * 0.65);
              feedMessage = 'Adequate vocal explanation. However, the response was too generalized and did not address key industry-standard keywords.';
              weaknessesList.push(`Verbal explanation on Question #${idx + 1} lacked specific industry-standard vocabulary.`);
            }
          }

          overallGradedSum += scoreGained;
          feedbackList.push({
            questionId: q.id,
            score: scoreGained,
            maxScore: maxQScore,
            feedback: feedMessage
          });
        }
      });

      // Calculate final weighted overall score out of 100
      let finalOverallScore = 0;
      if (totalQuestionsGraded > 0) {
        finalOverallScore = Math.min(100, Math.round((overallGradedSum / totalQuestionsGraded) * 100));
      }

      // Default lists fallback
      if (strengthsList.length === 0) {
        strengthsList.push('Professional spoken tone and highly audible recording volume.');
      }
      if (weaknessesList.length === 0) {
        weaknessesList.push('Minor vocabulary improvements suggested during fast-paced segments.');
      }

      const mockGradedReport = {
        overallScore: finalOverallScore,
        strengths: strengthsList,
        weaknesses: weaknessesList,
        answersFeedback: feedbackList
      };

      // Bubble up the answers and report
      onSubmit(answers, mockGradedReport);
      setStep('COMPLETE');

    }, 5500);
  };

  return (
    <div className="fixed inset-0 bg-[#0f172a] text-white z-50 overflow-y-auto flex flex-col font-sans">
      {/* Simulation Top bar */}
      <div className="bg-amber-500 text-slate-900 px-6 py-2 flex items-center justify-between text-xs font-bold select-none shrink-0 shadow-md">
        <div className="flex items-center gap-2">
          <span className="bg-[#111827] text-white text-[10px] px-2 py-0.5 rounded uppercase">SIMULATOR ACTIVE</span>
          <span>Testing End-to-End Candidate Lifecycle for: <span className="underline">{candidate.name}</span> ({assessment.jobTitle})</span>
        </div>
        <button 
          onClick={onClose}
          className="bg-slate-900 hover:bg-slate-800 text-white px-3 py-1 rounded text-[11px] cursor-pointer transition"
        >
          Close Simulator & Return
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-3xl bg-[#1e293b] border border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col min-h-[500px]">
          
          {/* 1. Login Step */}
          {step === 'LOGIN' && (
            <div className="p-8 md:p-12 flex-1 flex flex-col justify-center max-w-md mx-auto w-full text-center space-y-6">
              <div className="mx-auto w-12 h-12 bg-indigo-500/10 border border-indigo-500/30 rounded-xl flex items-center justify-center text-indigo-400">
                <Lock className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-xl font-extrabold tracking-tight">Access Verification Required</h3>
                <p className="text-slate-400 text-xs mt-1.5">
                  Welcome to the PrimeHire evaluation sandbox. Please enter the generated password to proceed with the assessment simulation.
                </p>
              </div>

              <div className="space-y-3">
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Enter Candidate Password"
                    value={passwordInput}
                    onChange={(e) => setPasswordInput(e.target.value)}
                    className="w-full bg-slate-900/60 border border-slate-700 rounded-lg px-4 py-2.5 text-center text-sm font-mono tracking-widest text-white focus:outline-hidden focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                <div className="p-3 bg-slate-900/40 border border-slate-800 rounded-lg flex items-center justify-between text-xs">
                  <span className="text-slate-400 font-semibold">Autofill credentials:</span>
                  <button
                    onClick={() => setPasswordInput(candidate.password || '')}
                    className="text-indigo-400 hover:text-indigo-300 font-bold underline"
                  >
                    {candidate.password}
                  </button>
                </div>
                
                <button
                  onClick={handlePasswordLogin}
                  className="w-full bg-[var(--purple-700)] hover:bg-[var(--purple-600)] text-white font-bold py-2.5 px-4 rounded-lg text-xs transition cursor-pointer flex items-center justify-center gap-1.5 shadow-sm"
                >
                  <Play className="w-3.5 h-3.5" /> Start Assessment Simulation
                </button>
              </div>
            </div>
          )}

          {/* 2. Calibration Step */}
          {step === 'CALIBRATION' && (
            <div className="p-8 flex-1 flex flex-col justify-between space-y-8">
              <div className="space-y-2">
                <h3 className="text-lg font-bold text-white">System & Hardware Calibration</h3>
                <p className="text-xs text-slate-400">
                  Please calibrate your mic and camera to ensure speech-to-answer responses process with maximum transcription fidelity.
                </p>
              </div>

              {/* Simulation Widgets */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 flex-1">
                {/* Microphone Widget */}
                <div className="bg-slate-900/60 border border-slate-700 rounded-xl p-5 flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Mic className={`w-4 h-4 ${micActive ? 'text-emerald-400' : 'text-slate-400'}`} />
                      <span className="text-xs font-bold">Microphone Channel</span>
                    </div>
                    <button
                      onClick={() => setMicActive(!micActive)}
                      className={`text-[10px] font-bold px-2 py-1 rounded transition ${
                        micActive ? 'bg-red-500/10 text-red-400 border border-red-500/30' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                      }`}
                    >
                      {micActive ? 'Mute Mic' : 'Activate Mic'}
                    </button>
                  </div>

                  <div className="space-y-2 py-4">
                    <div className="text-[10px] text-slate-400 font-semibold uppercase">Real-Time Decibels</div>
                    <div className="h-6 w-full bg-slate-950 rounded overflow-hidden p-1 flex items-center gap-0.5">
                      {Array.from({ length: 24 }).map((_, i) => {
                        const active = micActive && (micLevel / 100 * 24) > i;
                        return (
                          <div 
                            key={i} 
                            className={`h-full flex-1 rounded-sm transition-all duration-100 ${
                              active 
                                ? i > 18 
                                  ? 'bg-red-500' 
                                  : i > 12 
                                    ? 'bg-amber-400' 
                                    : 'bg-emerald-400' 
                                : 'bg-slate-800'
                            }`}
                          />
                        );
                      })}
                    </div>
                  </div>

                  <div className="text-[10px] text-slate-500 flex items-center gap-1.5">
                    {micActive ? (
                      <span className="text-emerald-400 font-semibold flex items-center gap-1"><Check className="w-3.5 h-3.5" /> Signal detected: OK</span>
                    ) : (
                      <span>Microphone inactive. Click activate above to test.</span>
                    )}
                  </div>
                </div>

                {/* Camera Widget */}
                <div className="bg-slate-900/60 border border-slate-700 rounded-xl p-5 flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Video className={`w-4 h-4 ${camActive ? 'text-indigo-400' : 'text-slate-400'}`} />
                      <span className="text-xs font-bold">Camera Feed</span>
                    </div>
                    <button
                      onClick={() => setCamActive(!camActive)}
                      className={`text-[10px] font-bold px-2 py-1 rounded transition ${
                        camActive ? 'bg-slate-800 text-slate-300' : 'bg-indigo-600 text-white'
                      }`}
                    >
                      {camActive ? 'Turn Off' : 'Turn On'}
                    </button>
                  </div>

                  {/* Simulated screen */}
                  <div className="h-24 w-full rounded-lg bg-slate-950 overflow-hidden relative border border-slate-800 flex items-center justify-center my-3">
                    {camActive ? (
                      <div className="absolute inset-0 bg-gradient-to-tr from-indigo-900/50 via-slate-900 to-slate-900 flex items-center justify-center">
                        <div className="w-8 h-8 rounded-full border-2 border-indigo-400 border-dashed animate-spin absolute" />
                        <div className="text-center z-10">
                          <span className="text-[10px] bg-[#111827]/80 text-emerald-400 px-2 py-0.5 rounded border border-emerald-500/20 font-mono">
                            LIVE FEED (MOCK)
                          </span>
                          <span className="block text-[9px] text-slate-400 font-mono mt-1">
                            Candidate camera active
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="text-slate-600 text-center space-y-1">
                        <MicOff className="w-5 h-5 mx-auto opacity-50" />
                        <span className="text-[9px] block">Feed Disconnected</span>
                      </div>
                    )}
                  </div>

                  <div className="text-[10px] text-slate-500">
                    Proctoring checks will ensure candidate presence during actual interview flow.
                  </div>
                </div>
              </div>

              {/* Action row */}
              <div className="flex justify-end gap-3 pt-4 border-t border-slate-700">
                <button
                  onClick={() => {
                    setMicActive(true);
                    setCamActive(true);
                    setStep('TEST');
                  }}
                  className="bg-[var(--purple-700)] hover:bg-[var(--purple-600)] text-white text-xs font-bold py-2 px-5 rounded-lg transition flex items-center gap-1 shadow-sm"
                >
                  Confirm & Proceed <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* 3. Question Answering Step */}
          {step === 'TEST' && currentQuestion && (
            <div className="flex-1 flex flex-col justify-between">
              {/* Question Header Status */}
              <div className="bg-slate-900/40 border-b border-slate-700 px-6 py-4 flex items-center justify-between text-xs">
                <div>
                  <span className="text-slate-400 font-bold uppercase tracking-widest text-[10px] block">
                    {assessment.jobTitle}
                  </span>
                  <span className="font-extrabold text-white text-sm">
                    Question {currentQuestionIndex + 1} of {questions.length}
                  </span>
                </div>

                <div className="flex items-center gap-4">
                  {/* Timer */}
                  <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-700 px-3 py-1 rounded-md font-mono text-xs">
                    <Clock className={`w-3.5 h-3.5 ${questionTimer < 15 ? 'text-red-400 animate-pulse' : 'text-slate-400'}`} />
                    <span className={questionTimer < 15 ? 'text-red-400 font-bold' : 'text-white'}>
                      {Math.floor(questionTimer / 60)}:{(questionTimer % 60).toString().padStart(2, '0')}
                    </span>
                  </div>
                </div>
              </div>

              {/* Active Question Body */}
              <div className="p-6 md:p-8 flex-1 space-y-6">
                <div className="space-y-2">
                  <div className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest flex items-center gap-1">
                    <HelpCircle className="w-3 h-3" /> Question Type: {currentQuestion.type}
                  </div>
                  <h4 className="text-base font-bold text-white leading-relaxed">
                    {currentQuestion.text}
                  </h4>
                </div>

                {/* Answer Inputs container */}
                <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-5 min-h-[160px] flex flex-col justify-center">
                  
                  {/* MCQ Interface */}
                  {currentQuestion.type === 'MCQ' && currentQuestion.options && (
                    <div className="space-y-3 w-full">
                      {currentQuestion.options.map((option) => {
                        const isSelected = answers[currentQuestion.id] === option;
                        return (
                          <button
                            key={option}
                            onClick={() => handleMCQSelect(option)}
                            className={`w-full text-left p-3.5 rounded-lg text-xs font-semibold border transition flex items-center justify-between ${
                              isSelected
                                ? 'bg-indigo-600/20 border-indigo-500 text-white'
                                : 'bg-slate-950/40 border-slate-800 text-slate-300 hover:bg-slate-950/60'
                            }`}
                          >
                            <span>{option}</span>
                            <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                              isSelected ? 'border-indigo-400 bg-indigo-500 text-white' : 'border-slate-600'
                            }`}>
                              {isSelected && <Check className="w-3 h-3" />}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Speak-to-Answer Interface */}
                  {currentQuestion.type === 'SPEAK_TO_ANSWER' && (
                    <div className="space-y-5 text-center w-full">
                      
                      {!isRecording && !answers[currentQuestion.id] && (
                        <div className="space-y-4">
                          <p className="text-xs text-slate-400 max-w-md mx-auto">
                            This is a speak-to-answer evaluation round. Click start below, speak clearly into your mic, and your answer will automatically transcribe.
                          </p>
                          <button
                            onClick={startRecording}
                            className="mx-auto w-14 h-14 bg-[var(--purple-700)] hover:bg-[var(--purple-600)] text-white rounded-full flex items-center justify-center shadow-lg transition hover:scale-105 cursor-pointer"
                          >
                            <Mic className="w-6 h-6" />
                          </button>
                          <span className="text-[10px] text-slate-500 block font-semibold uppercase tracking-widest">
                            Click to start recording
                          </span>
                        </div>
                      )}

                      {isRecording && (
                        <div className="space-y-4">
                          <div className="text-xs font-mono text-red-400 flex items-center justify-center gap-2 animate-pulse font-bold">
                            <span className="w-2.5 h-2.5 bg-red-500 rounded-full"></span>
                            RECORDING IN PROGRESS ({recordingSeconds}s)
                          </div>
                          
                          {/* Animated wave visualizer canvas */}
                          <canvas 
                            ref={canvasRef} 
                            width={320} 
                            height={60} 
                            className="mx-auto bg-slate-950/40 rounded-lg border border-slate-800"
                          />

                          <button
                            onClick={stopRecording}
                            className="mx-auto px-6 py-2 bg-red-600 hover:bg-red-500 text-white text-xs font-bold rounded-lg shadow-md transition cursor-pointer"
                          >
                            Finish & Transcribe Answer
                          </button>
                        </div>
                      )}

                      {/* Recorded response transcript review */}
                      {!isRecording && answers[currentQuestion.id] && (
                        <div className="text-left space-y-3">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-slate-400 font-bold uppercase tracking-wider">Voice Transcript Preview (Editable)</span>
                            <button
                              onClick={() => {
                                setAnswers(prev => {
                                  const updated = { ...prev };
                                  delete updated[currentQuestion.id];
                                  return updated;
                                });
                                setCustomTranscript('');
                              }}
                              className="text-red-400 hover:text-red-300 font-semibold inline-flex items-center gap-1 cursor-pointer"
                            >
                              <RotateCcw className="w-3 h-3" /> Re-record Audio
                            </button>
                          </div>
                          <textarea
                            value={answers[currentQuestion.id]}
                            onChange={(e) => {
                              const text = e.target.value;
                              setAnswers(prev => ({ ...prev, [currentQuestion.id]: text }));
                              setCustomTranscript(text);
                            }}
                            className="w-full bg-slate-950/60 border border-slate-800 rounded-lg p-3 text-xs text-slate-200 focus:outline-hidden focus:border-indigo-500"
                            rows={4}
                            placeholder="Type or speak response details..."
                          />
                          <p className="text-[10px] text-slate-500 italic">
                            Tip: Feel free to edit the generated speech transcript above to simulate different answer depths.
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                </div>
              </div>

              {/* Question Navigation Footer */}
              <div className="bg-slate-900/60 border-t border-slate-700 px-6 py-4 flex items-center justify-between">
                <button
                  onClick={handlePrevQuestion}
                  disabled={currentQuestionIndex === 0}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-30 disabled:hover:bg-slate-800 rounded-lg text-xs font-bold transition flex items-center gap-1 cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" /> Previous Question
                </button>

                <div className="text-xs text-slate-400 font-mono">
                  {Object.keys(answers).length} of {questions.length} Answered
                </div>

                <button
                  onClick={handleNextQuestion}
                  className="px-4 py-2 bg-[var(--purple-700)] hover:bg-[var(--purple-600)] text-white rounded-lg text-xs font-bold transition flex items-center gap-1 cursor-pointer shadow-sm"
                >
                  {currentQuestionIndex === questions.length - 1 ? 'Review Submission' : 'Next Question'} <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* 4. Instructions/Review Step before Final Submit */}
          {step === 'INSTRUCTIONS' && (
            <div className="p-8 flex-1 flex flex-col justify-between space-y-6">
              <div className="space-y-2">
                <h3 className="text-lg font-bold text-white">Review Assessment Responses</h3>
                <p className="text-xs text-slate-400">
                  Please review the status of each question prior to submitting your assessment profile for AI analysis.
                </p>
              </div>

              {/* List of answers */}
              <div className="space-y-2.5 max-h-[220px] overflow-y-auto pr-1">
                {questions.map((q, idx) => {
                  const isAnswered = answers[q.id] !== undefined && answers[q.id] !== '';
                  return (
                    <div key={q.id} className="p-3.5 bg-slate-900/40 border border-slate-800 rounded-lg flex items-center justify-between text-xs">
                      <div className="space-y-0.5 max-w-[80%]">
                        <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">Question #{idx + 1} ({q.type})</span>
                        <p className="font-semibold text-slate-200 truncate">{q.text}</p>
                      </div>

                      {isAnswered ? (
                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                          <Check className="w-3 h-3" /> Answered
                        </span>
                      ) : (
                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center gap-1">
                          <HelpCircle className="w-3 h-3" /> Skipped
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Action row */}
              <div className="flex justify-between items-center pt-4 border-t border-slate-700">
                <button
                  onClick={() => {
                    setCurrentQuestionIndex(0);
                    setStep('TEST');
                  }}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-bold transition flex items-center gap-1 cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" /> Go Back to Test
                </button>

                <button
                  onClick={triggerEvaluationProcess}
                  className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition flex items-center gap-1 cursor-pointer shadow-lg animate-pulse"
                >
                  <Sparkles className="w-3.5 h-3.5" /> Submit Assessment for AI Grading
                </button>
              </div>
            </div>
          )}

          {/* 5. Submitting Loader with Real-time Grading Animation */}
          {step === 'SUBMITTING' && (
            <div className="p-8 md:p-12 flex-1 flex flex-col justify-center text-center space-y-6">
              <div className="mx-auto">
                <Loader2 className="w-12 h-12 text-indigo-500 animate-spin" />
              </div>
              
              <div className="space-y-1">
                <h4 className="text-lg font-bold text-white">Processing Assessment Submission</h4>
                <p className="text-xs text-slate-400 max-w-md mx-auto">
                  Our simulated AI proctor and grading system is analyzing candidate inputs. Please remain on this screen.
                </p>
              </div>

              {/* Real-time steps indicator */}
              <div className="max-w-xs mx-auto w-full space-y-2.5 text-left pt-2">
                <div className="flex items-center gap-2 text-xs">
                  <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] ${
                    evalStep > 0 ? 'bg-emerald-500 text-slate-900 font-bold' : 'bg-slate-800 border border-slate-700 text-slate-400'
                  }`}>
                    {evalStep > 0 ? '✓' : '1'}
                  </div>
                  <span className={evalStep > 0 ? 'text-emerald-400 font-semibold' : 'text-slate-400'}>
                    Uploading verbal waveforms...
                  </span>
                </div>

                <div className="flex items-center gap-2 text-xs">
                  <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] ${
                    evalStep > 1 ? 'bg-emerald-500 text-slate-900 font-bold' : 'bg-slate-800 border border-slate-700 text-slate-400'
                  }`}>
                    {evalStep > 1 ? '✓' : '2'}
                  </div>
                  <span className={evalStep > 1 ? 'text-emerald-400 font-semibold' : 'text-slate-400'}>
                    AI parsing answer contextual keywords...
                  </span>
                </div>

                <div className="flex items-center gap-2 text-xs">
                  <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] ${
                    evalStep > 2 ? 'bg-emerald-500 text-slate-900 font-bold' : 'bg-slate-800 border border-slate-700 text-slate-400'
                  }`}>
                    {evalStep > 2 ? '✓' : '3'}
                  </div>
                  <span className={evalStep > 2 ? 'text-emerald-400 font-semibold' : 'text-slate-400'}>
                    Generating Strength & Weakness report...
                  </span>
                </div>

                <div className="flex items-center gap-2 text-xs">
                  <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] ${
                    evalStep > 3 ? 'bg-emerald-500 text-slate-900 font-bold' : 'bg-slate-800 border border-slate-700 text-slate-400'
                  }`}>
                    {evalStep > 3 ? '✓' : '4'}
                  </div>
                  <span className={evalStep > 3 ? 'text-emerald-400 font-semibold' : 'text-slate-400'}>
                    Finalizing overall candidate scorecard...
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* 6. Complete Screen */}
          {step === 'COMPLETE' && (
            <div className="p-8 md:p-12 flex-1 flex flex-col justify-center text-center space-y-6">
              <div className="mx-auto w-14 h-14 bg-emerald-500/10 border border-emerald-500/30 rounded-full flex items-center justify-center text-emerald-400 animate-bounce">
                <CheckCircle className="w-8 h-8" />
              </div>
              
              <div>
                <h4 className="text-xl font-extrabold tracking-tight">Assessment Simulation Complete!</h4>
                <p className="text-xs text-slate-400 mt-1.5 max-w-sm mx-auto">
                  Excellent! You have successfully completed the test flow for <span className="font-bold text-white">{candidate.name}</span>. The evaluation has compiled instantly.
                </p>
              </div>

              <div className="p-4 bg-slate-900/60 border border-slate-800 rounded-xl max-w-md mx-auto w-full text-left space-y-2">
                <div className="text-xs text-slate-400 font-bold uppercase tracking-wider text-center border-b border-slate-800 pb-2">
                  Simulation Metadata Log
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">Evaluation Mode:</span>
                  <span className="font-semibold text-indigo-400 font-mono">AI Sandbox Engine</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">Questions Answered:</span>
                  <span className="font-semibold text-slate-200">{Object.keys(answers).length} / {questions.length}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">Status Output:</span>
                  <span className="font-bold text-emerald-400">GENERATED</span>
                </div>
              </div>

              <div className="pt-2">
                <button
                  onClick={onClose}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2.5 px-6 rounded-lg text-xs transition cursor-pointer flex items-center gap-1.5 mx-auto shadow-md"
                >
                  Return to Recruiter Dashboard & View Report <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
