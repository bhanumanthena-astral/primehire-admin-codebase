/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { AssessmentProfile, Question, Candidate, MailTemplate, RoundType, QuestionType, CandidateStatus } from '../types';
import { cn } from '@/lib/utils';
import { 
  mockGenerateLink,
  mockRegenerateLink,
  mockRescheduleInterview,
  mockResetCandidatePassword,
  mockRegenerateReport,
  mockSendInvite,
  mockBulkSendInvite,
  mockGetInterviewStatus,
  generateId,
  renderTemplate
} from '../mockData';
import {
  createCandidatesBulk,
  updateCandidate,
  deleteCandidate,
  syncCandidateToServer,
  createAssessment as apiCreateAssessment,
  putAssessment as apiPutAssessment,
  setAssessmentActive as apiSetAssessmentActive,
  retryAssessmentSync as apiRetryAssessmentSync,
  assessmentToPayload,
  newIdempotencyKey,
  ApiError,
} from '../lib/mongoApi';
import { asJobId, asLocalCandidateId, JobId, LocalCandidateId, generate32BitId } from '../lib/primehireIds';
import { primehireClient } from '../lib/primehireClient';
import {
  SCHEDULE_GRACE_MS,
  MIN_GENERATE_BUFFER_MS,
  MIN_RESCHEDULE_BUFFER_MS,
  formatUtcInstant,
  formatLocalInstant,
  formatInterviewWindow,
  parseServerDate,
  formatToDatetimeLocal,
} from '../utils/dates';
import { 
  ChevronRight, 
  Plus, 
  ArrowLeft, 
  Trash2, 
  Cpu, 
  Calendar, 
  Settings, 
  Eye, 
  UserPlus, 
  Check, 
  X,
  AlertCircle, 
  Clock, 
  Lock, 
  ExternalLink, 
  Copy, 
  Send, 
  ChevronDown, 
  ChevronUp, 
  Upload, 
  Sparkles, 
  Edit,
  Trash,
  CheckCircle,
  HelpCircle,
  FileSpreadsheet,
  AlertTriangle,
  Play,
  Bell,
  History,
  Loader2,
  MailCheck,
  MailQuestion,
  MoreVertical,
  SlidersHorizontal,
  RotateCcw,
  RefreshCw,
  Info
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SectionHeader, Panel, PanelTitle, Pill, PAButton, IconSquare, EmptyNote, Bar } from './ui/primitives';
import { toast } from 'sonner';

const LAYER2_OPTIONS: Record<string, string[]> = {
  BASIC: ['Overall Score', 'Communication'],
  TECHNICAL: ['Overall Result', 'Technical Analysis (Overall Score)', 'Interview Analysis (Confidence Score)', 'Communication'],
  HR: ['Communication', 'Interview Analysis', 'HR Competency Analysis', 'VILS Competency Analysis', 'Values & Personality']
};

const LAYER3_OPTIONS: Record<string, Record<string, string[]>> = {
  BASIC: {
    'Communication': ['Overall Score', 'Fluency', 'Grammar', 'Pronunciation', 'Vocabulary']
  },
  TECHNICAL: {
    'Communication': ['Overall Score', 'Fluency', 'Grammar', 'Pronunciation', 'Vocabulary']
  },
  HR: {
    'Communication': ['Grammar', 'Fluency', 'Vocabulary', 'Pronunciation'],
    'Interview Analysis': ['Confidence'],
    'HR Competency Analysis': [
      'Self Discipline', 'Time Management', 'Detail Orientation', 'Teamwork', 'Professionalism', 
      'Leadership', 'Motivation', 'Learning Ability', 'Adaptability', 'Creativity & Innovation', 
      'Positive Attitude', 'Problem Solving'
    ],
    'VILS Competency Analysis': [
      'Leading and Deciding', 'Supporting and Cooperating', 'Interacting and Presenting', 
      'Analysing and Interpreting', 'Creating and Conceptualising', 'Organising and Executing', 
      'Adapting and Coping', 'Enterprising and Performing'
    ],
    'Values & Personality': ['Personal Values (Big Five)', 'Societal Values', 'Dark Triad Risk Assessment']
  }
};

const LAYER4_OPTIONS: Record<string, string[]> = {
  'Personal Values (Big Five)': ['Openness', 'Extroversion', 'Conscientiousness', 'Agreeableness', 'Neurotic'],
  'Societal Values': [
    'Hedonism', 'Power', 'Stimulation', 'Conformity', 'Universalism', 
    'Self Direction', 'Achievement', 'Traditional', 'Benevolence', 'Security'
  ],
  'Dark Triad Risk Assessment': ['Machiavellianism', 'Narcissism', 'Psychopathy']
};

function getScoreScale(round: string, layer2: string | null, layer3: string | null, layer4: string | null): 'scale5' | 'scale3' | null {
  if (round === 'ALL' || !round) return null;
  
  if (round === 'BASIC') {
    if (layer2 === 'Overall Score') return 'scale5';
    if (layer2 === 'Communication') return 'scale5';
  }
  
  if (round === 'TECHNICAL') {
    if (layer2 === 'Overall Result') return 'scale5';
    if (layer2 === 'Technical Analysis (Overall Score)') return 'scale5';
    if (layer2 === 'Interview Analysis (Confidence Score)') return 'scale5';
    if (layer2 === 'Communication') return 'scale5';
  }
  
  if (round === 'HR') {
    if (layer2 === 'Communication') return 'scale5';
    if (layer2 === 'Interview Analysis') return 'scale5';
    if (layer2 === 'HR Competency Analysis') return 'scale3';
    if (layer2 === 'VILS Competency Analysis') return 'scale3';
    if (layer2 === 'Values & Personality') return 'scale3';
  }
  
  return null;
}

function checkScoreFilter(score: number, scale: 'scale5' | 'scale3', filterValue: string): boolean {
  if (score < 0) return false;

  if (scale === 'scale5') {
    // Mirrors getGrade() in normalizeReport.ts. Single letters are inclusive.
    if (filterValue === 'A+') return score >= 90;
    if (filterValue === 'A') return score >= 80;
    if (filterValue === 'B+') return score >= 70 && score < 90;
    if (filterValue === 'B') return score >= 60 && score < 80;
    if (filterValue === 'C+') return score >= 50 && score < 60;
    if (filterValue === 'C') return score >= 40 && score < 60;
    if (filterValue === 'D') return score >= 30 && score < 40;
    if (filterValue === 'E') return score >= 20 && score < 30;
    if (filterValue === 'F') return score < 20;
  }
  
  if (scale === 'scale3') {
    if (filterValue === '0 - 30') return score <= 30;
    if (filterValue === '30 - 60') return score > 30 && score <= 60;
    if (filterValue === '60 - 100') return score > 60 && score <= 100;
  }
  
  return false;
}

function getCandidateScore(
  c: Candidate,
  round: string,
  layer2: string | null,
  layer3: string | null,
  layer4: string | null
): number {
  if (c.reportStatus !== 'GENERATED') return -1;

  // If no specific sub-metric (layer3) or trait (layer4) is selected,
  // we evaluate the overall score directly, as these represent overall evaluation metrics.
  if (!layer3 && !layer4) {
    if (c.simulatedReport?.overallScore !== undefined) {
      return c.simulatedReport.overallScore;
    }
  }

  const metricName = layer4 || layer3 || layer2 || round;
  
  if (
    (round === 'BASIC' && layer2 === 'Overall Score') ||
    (round === 'TECHNICAL' && (layer2 === 'Overall Result' || layer2 === 'Technical Analysis (Overall Score)'))
  ) {
    if (c.simulatedReport?.overallScore !== undefined) {
      return c.simulatedReport.overallScore;
    }
  }

  const str = c.id + '-' + metricName;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const score = 15 + Math.abs(hash % 85); 
  return score;
}

interface AssessmentsAndAssignmentsProps {
  assessments: AssessmentProfile[];
  candidates: Candidate[];
  templates: MailTemplate[];
  globalRoundFilter?: string;
  globalSearchQuery?: string;
  assessmentsLoading: boolean;
  assessmentsError: string | null;
  lastSyncedAt: string | null;
  onRefreshAssessments: () => void;
  onSetAssessments: (asm: AssessmentProfile[] | ((prev: AssessmentProfile[]) => AssessmentProfile[])) => void;
  onSetCandidates: React.Dispatch<React.SetStateAction<Candidate[]>>;
  onOpenReport: (candidate: Candidate, assessment: AssessmentProfile) => void;
}

export default function AssessmentsAndAssignments({
  assessments,
  candidates,
  templates,
  globalRoundFilter = 'ALL',
  globalSearchQuery = '',
  assessmentsLoading,
  assessmentsError,
  lastSyncedAt,
  onRefreshAssessments,
  onSetAssessments,
  onSetCandidates,
  onOpenReport
}: AssessmentsAndAssignmentsProps) {
  // Navigation inside this module
  // 'LIST' | 'CREATE' | 'DETAIL' | 'UPLOAD' | 'EDIT'
  const [currentView, setCurrentView] = useState<'LIST' | 'CREATE' | 'DETAIL' | 'UPLOAD' | 'EDIT'>('LIST');
  const [selectedAssessmentId, setSelectedAssessmentId] = useState<string | null>(null);

  // Detail collapsible sections
  const [expandedDetails, setExpandedDetails] = useState(true);
  const [expandedQuestions, setExpandedQuestions] = useState(false);

  // ==========================================
  // 1. ASSESSMENT LIST VIEW STATE
  // ==========================================
  // (Main state passed via props)

  // ==========================================
  // 2. CREATION MODULE STATE
  // ==========================================
  const [formJobId, setFormJobId] = useState(() => 'JOB-' + generate32BitId());
  const [formJobTitle, setFormJobTitle] = useState('');
  const [formJobDescription, setFormJobDescription] = useState('');
  const [formLanguage, setFormLanguage] = useState('ENGLISH');
  const [formRoundType, setFormRoundType] = useState<RoundType>('TECHNICAL');
  const [formQuestions, setFormQuestions] = useState<Question[]>([
    { id: 'q-1', text: '', type: 'SPEAK_TO_ANSWER', maxDuration: 120, maxScore: 50, weightage: 100 }
  ]);
  const [formStartDate, setFormStartDate] = useState('');
  const [formEndDate, setFormEndDate] = useState('');
  const [editingAssessmentId, setEditingAssessmentId] = useState<string | null>(null);
  const [activeDropdownAsmId, setActiveDropdownAsmId] = useState<string | null>(null);
  const [simulateCreateFailure, setSimulateCreateFailure] = useState(false);
  const [isSavingAssessment, setIsSavingAssessment] = useState(false);

  // ==========================================
  // 3. DETAIL VIEW STATE (Candidate list scoped to selected Assessment)
  // ==========================================
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<LocalCandidateId[]>([]);
  const [deleteConfirmCandId, setDeleteConfirmCandId] = useState<string | null>(null); // Step 1 delete
  const [doubleConfirmCandId, setDoubleConfirmCandId] = useState<string | null>(null); // Step 2 delete
  const [openMenuCandId, setOpenMenuCandId] = useState<string | null>(null); // Candidate actions dropdown menu
  const menuContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!openMenuCandId) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (menuContainerRef.current && !menuContainerRef.current.contains(e.target as Node)) {
        setOpenMenuCandId(null);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [openMenuCandId]);

  // ==========================================
  // 3b. RESCHEDULE MODAL STATE
  // ==========================================
  const [rescheduleCandId, setRescheduleCandId] = useState<LocalCandidateId | null>(null);
  const [rescheduleStartTime, setRescheduleStartTime] = useState('');
  const [rescheduleEndTime, setRescheduleEndTime] = useState('');
  const [isRescheduling, setIsRescheduling] = useState(false);

  const [passwordEditCandId, setPasswordEditCandId] = useState<LocalCandidateId | null>(null);
  const [newCandPassword, setNewCandPassword] = useState('');
  const [isSavingPassword, setIsSavingPassword] = useState(false);

  // ==========================================
  // 3c. SEND INVITE TEMPLATE PICKER STATE
  // ==========================================
  const [inviteDialogCandIds, setInviteDialogCandIds] = useState<LocalCandidateId[]>([]);
  const [inviteTemplateId, setInviteTemplateId] = useState<string>('');
  const [isSendingInvite, setIsSendingInvite] = useState(false);

  // ==========================================
  // 5. PIPELINE FILTERS STATE
  // ==========================================
  const [filterRound, setFilterRound] = useState<'ALL' | 'BASIC' | 'TECHNICAL' | 'HR'>('ALL');
  const [filterLayer2, setFilterLayer2] = useState<string | null>(null);
  const [filterLayer3, setFilterLayer3] = useState<string | null>(null);
  const [filterLayer4, setFilterLayer4] = useState<string | null>(null);
  const [filterScoreValue, setFilterScoreValue] = useState<string | null>(null);

  const handleSetFilterRound = (round: 'ALL' | 'BASIC' | 'TECHNICAL' | 'HR') => {
    setFilterRound(round);
    setFilterLayer2(null);
    setFilterLayer3(null);
    setFilterLayer4(null);
    setFilterScoreValue(null);
  };

  const handleSetFilterLayer2 = (val: string | null) => {
    setFilterLayer2(val);
    setFilterLayer3(null);
    setFilterLayer4(null);
    setFilterScoreValue(null);
  };

  const handleSetFilterLayer3 = (val: string | null) => {
    setFilterLayer3(val);
    setFilterLayer4(null);
    setFilterScoreValue(null);
  };

  const handleSetFilterLayer4 = (val: string | null) => {
    setFilterLayer4(val);
    setFilterScoreValue(null);
  };

  const handleSetFilterScoreValue = (val: string | null) => {
    setFilterScoreValue(val);
  };

  const handleResetAllFilters = () => {
    setFilterRound('ALL');
    setFilterLayer2(null);
    setFilterLayer3(null);
    setFilterLayer4(null);
    setFilterScoreValue(null);
    toast.success('All pipeline filters have been reset.');
  };

  // ==========================================
  // 4. UPLOAD MODULE STATE
  // ==========================================
  const [isDragging, setIsDragging] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState('');
  const [parsedRows, setParsedRows] = useState<any[]>([]); // parsed candidates ready for validation
  const [validationErrors, setValidationErrors] = useState<{ row: number; col: string; type: 'red' | 'yellow'; message: string }[]>([]);
  const [importSearch, setImportSearch] = useState('');

  // Manual Candidate Form fields
  const [manualName, setManualName] = useState('');
  const [manualEmail, setManualEmail] = useState('');
  const [manualPhone, setManualPhone] = useState('');
  const [manualStartTime, setManualStartTime] = useState('');
  const [manualEndTime, setManualEndTime] = useState('');
  const [timeConsent, setTimeConsent] = useState(false);

  // Dynamic validator that evaluates candidate records in real time
  const runValidation = (rows: any[]) => {
    const errors: { row: number; col: string; type: 'red' | 'yellow'; message: string }[] = [];
    const emailsSeen = new Set<string>();

    rows.forEach((row, index) => {
      const rowNum = index + 1;
      const { name, email, phone, startTime, endTime } = row;

      // 1. Name is mandatory. Allows standard chars and dot "."
      if (!name || name.trim() === '') {
        errors.push({ row: rowNum, col: 'Name', type: 'red', message: 'Name is mandatory.' });
      } else {
        const nameRegex = /^[a-zA-Z\s.\-]+$/;
        if (!nameRegex.test(name)) {
          errors.push({ row: rowNum, col: 'Name', type: 'red', message: 'Name can only contain letters, spaces, hyphens, and dots.' });
        }
      }

      // 2. Email format validation - must contain "@" and dot in domain
      if (!email || email.trim() === '') {
        errors.push({ row: rowNum, col: 'Email', type: 'red', message: 'Email is required.' });
      } else {
        if (!email.includes('@')) {
          errors.push({ row: rowNum, col: 'Email', type: 'red', message: 'Email must contain "@" symbol.' });
        } else {
          const parts = email.split('@');
          if (parts.length !== 2 || !parts[0] || !parts[1]) {
            errors.push({ row: rowNum, col: 'Email', type: 'red', message: 'Invalid email structure around "@".' });
          } else {
            const domain = parts[1];
            if (!domain.includes('.')) {
              errors.push({ row: rowNum, col: 'Email', type: 'red', message: 'Email domain must contain a dot (e.g. ".com").' });
            } else {
              const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
              if (!emailRegex.test(email)) {
                errors.push({ row: rowNum, col: 'Email', type: 'yellow', message: 'Email format seems irregular.' });
              }
            }
          }
        }

        // Duplicate email check
        if (emailsSeen.has(email.toLowerCase())) {
          errors.push({ row: rowNum, col: 'Email', type: 'red', message: `Duplicate email detected: ${email}` });
        } else {
          emailsSeen.add(email.toLowerCase());
        }
      }

      // 3. Phone validation - must be exactly 10 digits
      if (phone) {
        const digitsOnly = phone.replace(/\D/g, '');
        if (digitsOnly.length !== 10) {
          errors.push({ row: rowNum, col: 'Phone', type: 'red', message: 'Phone number must contain exactly 10 digits.' });
        }
      }

      // 4. Start & End times validation (optional format check if present)
      let isStartValid = false;
      let isEndValid = false;

      const ISO_8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;
      if (startTime && startTime.trim() !== '') {
        const s = startTime.trim();
        const d = Date.parse(s);
        if (isNaN(d) || !ISO_8601_RE.test(s)) {
          errors.push({ row: rowNum, col: 'Start Time', type: 'red', message: 'Start Time must be ISO 8601 (e.g. 2026-07-05T09:00:00Z).' });
        } else {
          isStartValid = true;
        }
      }

      if (endTime && endTime.trim() !== '') {
        const s = endTime.trim();
        const d = Date.parse(s);
        if (isNaN(d) || !ISO_8601_RE.test(s)) {
          errors.push({ row: rowNum, col: 'End Time', type: 'red', message: 'End Time must be ISO 8601 (e.g. 2026-07-05T12:00:00Z).' });
        } else {
          isEndValid = true;
        }
      }

      if (isStartValid && isEndValid) {
        if (new Date(endTime).getTime() <= new Date(startTime).getTime()) {
          errors.push({ row: rowNum, col: 'Times', type: 'red', message: 'End Time must be after Start Time.' });
        }
        // QA #12: PrimeHire rejects windows that already started ("interview
        // time has been passed"). Warn here (yellow, non-blocking for record
        // keeping); the Generate-link action blocks with an error instead.
        const now = Date.now();
        if (new Date(startTime).getTime() < now - SCHEDULE_GRACE_MS) {
          errors.push({ row: rowNum, col: 'Start Time', type: 'yellow', message: 'Start Time is in the past — PrimeHire will reject link generation. Pick a future window.' });
        } else if (new Date(endTime).getTime() <= now) {
          errors.push({ row: rowNum, col: 'End Time', type: 'yellow', message: 'End Time already passed — PrimeHire will reject link generation. Pick a future window.' });
        }
      }
    });

    return errors;
  };

  // Run dynamic validation instantly when parsedRows array changes
  useEffect(() => {
    const errors = runValidation(parsedRows);
    setValidationErrors(errors);
  }, [parsedRows]);

  // Find active selected assessment
  const activeAssessment = assessments.find(a => a.id === selectedAssessmentId);
  const activeAssessmentCandidates = candidates.filter(c => c.assessmentId === selectedAssessmentId);

  // Cascading pipeline filter helpers
  const shouldShowLayer3 = (() => {
    if (filterRound === 'BASIC' && filterLayer2 === 'Communication') return true;
    if (filterRound === 'TECHNICAL' && filterLayer2 === 'Communication') return true;
    if (filterRound === 'HR' && filterLayer2) return true;
    return false;
  })();

  const layer3Options = (() => {
    if (filterRound === 'BASIC') {
      return LAYER3_OPTIONS.BASIC[filterLayer2 as keyof typeof LAYER3_OPTIONS.BASIC];
    }
    if (filterRound === 'TECHNICAL') {
      return LAYER3_OPTIONS.TECHNICAL[filterLayer2 as keyof typeof LAYER3_OPTIONS.TECHNICAL];
    }
    if (filterRound === 'HR') {
      return LAYER3_OPTIONS.HR[filterLayer2 as keyof typeof LAYER3_OPTIONS.HR];
    }
    return [];
  })();

  const shouldShowLayer4 = (() => {
    if (filterRound === 'HR' && filterLayer2 === 'Values & Personality' && filterLayer3) return true;
    return false;
  })();

  const layer4Options = (() => {
    if (filterRound === 'HR' && filterLayer2 === 'Values & Personality' && filterLayer3) {
      return LAYER4_OPTIONS[filterLayer3 as keyof typeof LAYER4_OPTIONS];
    }
    return [];
  })();

  const activeScale = getScoreScale(filterRound, filterLayer2, filterLayer3, filterLayer4);

  // Filtered candidates according to cascading pipeline filter rules
  const filteredCandidates = activeAssessmentCandidates.filter(c => {
    // 1. If Round selection is ALL, return all candidates (optional & additive!)
    if (filterRound === 'ALL') return true;

    // Check if current assessment roundType matches the filterRound.
    // Since we're looking at candidates for the active assessment, if the active assessment's round type
    // is different from filterRound, none should show (retaining strict consistency)
    if (activeAssessment?.roundType !== filterRound) {
      return false;
    }

    // 3. If no scoreFilter is active, we don't filter out by scores (optional & additive!)
    if (!filterScoreValue) return true;

    // Evaluate score & scale
    const score = getCandidateScore(c, filterRound, filterLayer2, filterLayer3, filterLayer4);
    const scale = getScoreScale(filterRound, filterLayer2, filterLayer3, filterLayer4);

    if (score === -1 || !scale) {
      return false; // No report generated yet or invalid cascade path
    }

    return checkScoreFilter(score, scale, filterScoreValue);
  });

  // Total weightage sum computed for TECHNICAL/BASIC
  const totalWeightageSum = formQuestions.reduce((sum, q) => sum + (q.weightage || 0), 0);

  // =========================================================================
  // HANDLERS FOR CREATION MODULE
  // =========================================================================
  const handleAddQuestion = () => {
    const nextIdx = formQuestions.length + 1;
    setFormQuestions(prev => [
      ...prev,
      {
        id: 'q-' + Math.random().toString(36).substring(2, 5),
        text: '',
        type: 'SPEAK_TO_ANSWER',
        maxDuration: 120,
        maxScore: 10,
        weightage: 10
      }
    ]);
  };

  const handleRemoveQuestion = (idx: number) => {
    if (formQuestions.length <= 1) {
      toast.error('At least one question is required.');
      return;
    }
    setFormQuestions(prev => prev.filter((_, i) => i !== idx));
  };

  const handleUpdateQuestion = (idx: number, updates: Partial<Question>) => {
    setFormQuestions(prev => prev.map((q, i) => {
      if (i === idx) {
        const updated = { ...q, ...updates };
        // Keep correctOption in sync when options are edited (BUG#14)
        if (updates.options && !updates.correctOption) {
          const nextOpts = updates.options;
          if (!nextOpts.includes(updated.correctOption || '')) {
            updated.correctOption = nextOpts[0] || '';
          }
        }
        // Clean conditional fields if question type changes
        if (updates.type === 'MCQ') {
          delete updated.referenceAnswer;
          delete updated.criteria;
          if (!updated.options || updated.options.length === 0) {
            updated.options = ['Option A', 'Option B'];
            updated.correctOption = 'Option A';
          }
        } else if (updates.type === 'SPEAK_TO_ANSWER') {
          delete updated.options;
          delete updated.correctOption;
          if (formRoundType === 'TECHNICAL') {
            updated.referenceAnswer = '';
          } else if (formRoundType === 'BASIC') {
            updated.criteria = '';
          }
        }
        return updated;
      }
      return q;
    }));
  };

  // Friendly, non-raw error text for assessment writes. Form data is always
  // kept on failure so nothing is lost.
  const friendlyAssessmentError = (err: any, action: string): string => {
    if (err instanceof ApiError) {
      if (err.status === 409 && err.code === 'VERSION_CONFLICT') {
        return 'This was changed by someone else, reload to see the latest version.';
      }
      if (err.status === 409) {
        return 'An assessment with this Job ID and round already exists.';
      }
      if (err.status === 422) return `Could not ${action}: please check the highlighted fields.`;
      if (err.status === 503 || /unreachable|network|fetch|failed/i.test(err.message)) {
        return `Server unreachable — could not ${action}. Your entries were kept; retry when back online.`;
      }
      return `Could not ${action}. Your entries were kept.`;
    }
    return `Could not ${action}. Your entries were kept.`;
  };

  const handleCreateAssessmentSubmit = async () => {
    if (isSavingAssessment) return; // double-submit protection (clicks + Enter)
    // 1. Check required headers
    if (!formJobId.trim() || !formJobTitle.trim() || !formJobDescription.trim()) {
      toast.error('Job ID, Job Title, and Job Description are mandatory fields.');
      return;
    }

    // 2. Validate Start and End Dates (optional; only check order when both set)
    if (formStartDate && formEndDate && new Date(formEndDate) <= new Date(formStartDate)) {
      toast.error('End Date must be after the Start Date.');
      return;
    }

    // 3. Validate Questions text + per-question bounds
    for (let i = 0; i < formQuestions.length; i++) {
      if (!formQuestions[i].text.trim()) {
        toast.error(`Question #${i + 1} text is required.`);
        return;
      }
      const dur = Number(formQuestions[i].maxDuration);
      if (!Number.isFinite(dur) || dur < 1 || dur > 120) {
        toast.error(`Question #${i + 1} Max Duration must be between 1 and 120 seconds.`);
        return;
      }
      if (formRoundType !== 'HR') {
        const ms = Number(formQuestions[i].maxScore);
        const wt = Number(formQuestions[i].weightage);
        if (!Number.isFinite(ms) || ms < 1) {
          toast.error(`Question #${i + 1} Max Score is required and must be at least 1.`);
          return;
        }
        if (!Number.isFinite(wt) || wt < 0) {
          toast.error(`Question #${i + 1} Weightage % is required.`);
          return;
        }
      }
      // MCQ Validation
      if (formQuestions[i].type === 'MCQ') {
        const opts = formQuestions[i].options || [];
        if (opts.length === 0 || opts.some(o => !o.trim())) {
          toast.error(`Question #${i + 1} (MCQ) needs options with non-empty content.`);
          return;
        }
        if (!formQuestions[i].correctOption || !opts.includes(formQuestions[i].correctOption!)) {
          toast.error(`Question #${i + 1} Correct Option must match one of its options.`);
          return;
        }
      }
      // Speak Validation
      if (formQuestions[i].type === 'SPEAK_TO_ANSWER') {
        if (formRoundType === 'TECHNICAL' && !formQuestions[i].referenceAnswer?.trim()) {
          toast.error(`Question #${i + 1} (TECHNICAL) requires a Reference Answer.`);
          return;
        }
        if (formRoundType === 'BASIC' && !formQuestions[i].criteria?.trim()) {
          toast.error(`Question #${i + 1} (BASIC) requires grading Criteria/Rubric.`);
          return;
        }
      }
    }

    // 4. Technical/Basic weightage validation
    if (formRoundType !== 'HR' && totalWeightageSum !== 100) {
      toast.error(`Validation Failed: Sum of question weightages must be exactly 100%. Currently it is ${totalWeightageSum}%.`);
      return;
    }

    // Simulate failure flag check
    if (simulateCreateFailure) {
      toast.error('API Error: Simulated POST /assessment server failure. Your entered form data was preserved.');
      return;
    }

    // Handle Edit Save — server-truth via PUT with optimistic concurrency.
    if (editingAssessmentId) {
      const target = assessments.find(a => a.id === editingAssessmentId);
      if (!target) {
        toast.error('Assessment not found — it may have been removed. Reloading.');
        onRefreshAssessments();
        return;
      }
      setIsSavingAssessment(true);
      try {
        const payload = assessmentToPayload({
          jobId: target.jobId,
          jobTitle: formJobTitle,
          jobDescription: formJobDescription,
          language: formLanguage,
          roundType: target.roundType,
          questions: formQuestions,
          startDate: formStartDate ? new Date(formStartDate).toISOString() : undefined,
          endDate: formEndDate ? new Date(formEndDate).toISOString() : undefined,
        });
        const updated = await apiPutAssessment(target.jobId, {
          ...payload,
          version: target.version ?? 1,
        });
        onSetAssessments(prev => prev.map(a => (a.id === editingAssessmentId ? updated : a)));
        toast.success(`Assessment "${updated.jobTitle}" updated successfully!`);
        
        // Reset Creation Fields
        setEditingAssessmentId(null);
        setFormJobId('JOB-' + generate32BitId());
        setFormJobTitle('');
        setFormJobDescription('');
        setFormQuestions([{ id: 'q-1', text: '', type: 'SPEAK_TO_ANSWER', maxDuration: 120, maxScore: 50, weightage: 100 }]);
        setFormStartDate('');
        setFormEndDate('');
        setCurrentView('LIST');
      } catch (err: any) {
        const msg = friendlyAssessmentError(err, 'update this assessment');
        if (err instanceof ApiError && err.status === 409) {
          toast.error(msg, { action: { label: 'Reload', onClick: () => onRefreshAssessments() } });
          onRefreshAssessments();
        } else {
          toast.error(msg);
        }
      } finally {
        setIsSavingAssessment(false);
      }
      return;
    }

    // Fresh Idempotency-Key per submit attempt (reused only on auto-retry).
    const idempotencyKey = newIdempotencyKey();
    setIsSavingAssessment(true);
    try {
      const payload = assessmentToPayload({
        jobId: formJobId,
        jobTitle: formJobTitle,
        jobDescription: formJobDescription,
        language: formLanguage,
        roundType: formRoundType,
        questions: formQuestions,
        startDate: formStartDate ? new Date(formStartDate).toISOString() : undefined,
        endDate: formEndDate ? new Date(formEndDate).toISOString() : undefined,
      });

      // Server-truth create: FastAPI validates, stores pending, calls
      // PrimeHire server-side, then marks synced/failed. The browser never
      // calls the PrimeHire proxy for assessments any more.
      const newAsm = await apiCreateAssessment(payload, idempotencyKey);
      onSetAssessments(prev => [newAsm, ...prev]);

      if (newAsm.syncState?.state === 'failed') {
        toast.warning(
          `Assessment "${newAsm.jobTitle}" saved, but PrimeHire sync failed. Retry from the list.`,
        );
      } else {
        toast.success(`Assessment "${newAsm.jobTitle}" created successfully!`);
      }
      
      // Reset Creation Fields and generate a new Job ID
      setFormJobId('JOB-' + generate32BitId());
      setFormJobTitle('');
      setFormJobDescription('');
      setFormQuestions([{ id: 'q-1', text: '', type: 'SPEAK_TO_ANSWER', maxDuration: 120, maxScore: 50, weightage: 100 }]);
      setFormStartDate('');
      setFormEndDate('');
      setCurrentView('LIST');
    } catch (err: any) {
      console.error('[Create Assessment Error]', err);
      // Keep entered form data intact on failure (no reset here) so nothing is lost.
      toast.error(friendlyAssessmentError(err, 'create this assessment'));
    } finally {
      setIsSavingAssessment(false);
    }
  };

  const handleStartEditAssessment = (asm: AssessmentProfile) => {
    setEditingAssessmentId(asm.id);
    setFormJobId(asm.jobId);
    setFormJobTitle(asm.jobTitle);
    setFormJobDescription(asm.jobDescription);
    setFormLanguage(asm.language);
    setFormRoundType(asm.roundType);
    setFormQuestions(asm.questions);
    
    // Convert ISO string back to local datetime-local format: 'YYYY-MM-DDTHH:mm'
    const formatToDatetimeLocal = (isoStr?: string) => {
      if (!isoStr) return '';
      try {
        const d = new Date(isoStr);
        if (isNaN(d.getTime())) return '';
        const pad = (num: number) => num.toString().padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      } catch {
        return '';
      }
    };
    
    setFormStartDate(formatToDatetimeLocal(asm.startDate));
    setFormEndDate(formatToDatetimeLocal(asm.endDate));
    setCurrentView('EDIT');
  };

  // =========================================================================
  // HANDLERS FOR DETAIL / ASSIGNMENT PIPELINE
  // =========================================================================
  // Server-truth toggle: state changes only when MongoDB confirms.
  const [togglingAsmId, setTogglingAsmId] = useState<string | null>(null);
  const [retryingAsmId, setRetryingAsmId] = useState<string | null>(null);

  const handleToggleAssessmentActiveState = async (id: string) => {
    const target = assessments.find(a => a.id === id);
    if (!target || togglingAsmId) return;
    setTogglingAsmId(id);
    try {
      const updated = await apiSetAssessmentActive(target.jobId, !target.isActive, target.version ?? 1);
      onSetAssessments(prev => prev.map(a => (a.id === id ? updated : a)));
      toast.success(`Assessment is now ${updated.isActive ? 'ACTIVE' : 'INACTIVE'} (saved to server).`);
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 409) {
        toast.error('This was changed by someone else, reload to see the latest version.', {
          action: { label: 'Reload', onClick: () => onRefreshAssessments() },
        });
        onRefreshAssessments();
      } else {
        toast.error(friendlyAssessmentError(err, 'change this assessment'));
      }
    } finally {
      setTogglingAsmId(null);
    }
  };

  const handleRetryAssessmentSync = async (asm: AssessmentProfile) => {
    if (retryingAsmId) return;
    setRetryingAsmId(asm.id);
    try {
      const updated = await apiRetryAssessmentSync(asm.jobId);
      onSetAssessments(prev => prev.map(a => (a.id === asm.id ? updated : a)));
      if (updated.syncState?.state === 'synced') {
        toast.success(`PrimeHire sync recovered for "${updated.jobTitle}".`);
      } else {
        toast.warning(`Still failing: ${updated.syncState?.error || 'unknown error'}. Kept for another retry.`);
      }
    } catch (err: any) {
      toast.error(friendlyAssessmentError(err, 'retry the PrimeHire sync'));
    } finally {
      setRetryingAsmId(null);
    }
  };

  // =========================================================================
  // SERVER PERSISTENCE (candidate write path: React -> FastAPI -> MongoDB).
  // Local state updates first for responsiveness; these helpers then mirror
  // the fresh state to the server. Failures are reported, never silent.
  // =========================================================================
  const pushStatusToServer = async (ids: string[], status: 'ACTIVE' | 'INACTIVE') => {
    const targets = candidates.filter(c => ids.includes(c.id) && c.mongoId);
    if (targets.length === 0) return;
    const results = await Promise.allSettled(
      targets.map(c => updateCandidate(c.id, { status })),
    );
    const failed = results.filter(r => r.status === 'rejected').length;
    if (failed > 0) {
      toast.warning(`Server sync failed for ${failed} candidate(s) — showing local change only.`);
    }
  };

  const pushCandidatesToServer = async (list: Candidate[]): Promise<number> => {
    const targets = list.filter(c => c.mongoId);
    if (targets.length === 0) return 0;
    const results = await Promise.allSettled(targets.map(c => syncCandidateToServer(c)));
    return results.filter(r => r.status === 'rejected' || r.value === 'failed').length;
  };

  const handleGenerateCandidateLink = async (candId: LocalCandidateId) => {
    if (!activeAssessment) return;
    const cand = candidates.find(c => c.id === candId);
    if (cand && cand.status !== 'ACTIVE') {
      toast.error('Cannot generate link for an Inactive candidate.');
      return;
    }
    // QA #12: PrimeHire rejects windows that already started ("interview time
    // has been passed"). Block client-side with the stored window + now, so a
    // stale calendar pick never reaches POST /interview.
    if (cand) {
      const start = parseServerDate(cand.startTime);
      const end = parseServerDate(cand.endTime);
      const nowMs = Date.now();
      const now = new Date(nowMs);
      if (!start || !end || isNaN(start.getTime()) || isNaN(end.getTime())) {
        toast.error('Cannot generate link: this candidate has an invalid interview window. Reschedule first.', {
          action: { label: 'Reschedule', onClick: () => handleOpenRescheduleModal(candId) },
        });
        return;
      }
      if (end.getTime() <= nowMs) {
        toast.error(
          `Interview cannot be generated because the window has ended.\n\nCurrent window:\nStart: ${formatLocalInstant(start)}\nEnd: ${formatLocalInstant(end)}\n\nPlease reschedule to a future window and try again.`,
          {
            duration: 8000,
            action: { label: 'Reschedule', onClick: () => handleOpenRescheduleModal(candId) },
          },
        );
        return;
      }
      if (start.getTime() < nowMs + MIN_GENERATE_BUFFER_MS) {
        toast.error(
          `Interview cannot be generated because the stored start time has already passed.\n\nCurrent window:\nStart: ${formatLocalInstant(start)}\nEnd: ${formatLocalInstant(end)}\n\nPlease reschedule the start time to a future time and try again.`,
          {
            duration: 8000,
            action: { label: 'Reschedule', onClick: () => handleOpenRescheduleModal(candId) },
          },
        );
        return;
      }
      if (end.getTime() <= start.getTime()) {
        toast.error(
          `Interview cannot be generated because the end time is not after the start time.\n\nCurrent window:\nStart: ${formatLocalInstant(start)}\nEnd: ${formatLocalInstant(end)}\n\nPlease reschedule with a valid window and try again.`,
          {
            duration: 8000,
            action: { label: 'Reschedule', onClick: () => handleOpenRescheduleModal(candId) },
          },
        );
        return;
      }
    }

    // Set rowLoading to true for this specific candidate to disable the button and show a spinner
    onSetCandidates(prev => prev.map(c => c.id === candId ? { ...c, rowLoading: true } : c));

    try {
      const updated = await mockGenerateLink([candId], candidates, activeAssessment.roundType, activeAssessment.jobId);
      onSetCandidates(updated);
      toast.success('Evaluation link and password generated successfully.');
      const failed = await pushCandidatesToServer(updated.filter(c => c.id === candId));
      if (failed > 0) {
        toast.warning('Link created, but server sync failed — the link may not appear in other browsers.');
      }
    } catch (err: any) {
      // Revert loading state
      onSetCandidates(prev => prev.map(c => c.id === candId ? { ...c, rowLoading: false } : c));
      toast.error('Link generation failed: ' + err.message);
    }
  };

  const handleOpenRescheduleModal = (candId: LocalCandidateId) => {
    if (!activeAssessment) return;
    const cand = candidates.find(c => c.id === candId);
    if (cand && cand.status !== 'ACTIVE') {
      toast.error('Cannot reschedule for an Inactive candidate.');
      return;
    }
    // Allow reschedule even without interviewId — the operator may need to
    // fix a stale start time before the first link is generated.
    // Pre-fill with current schedule or empty
    setRescheduleStartTime(formatToDatetimeLocal(cand?.startTime));
    setRescheduleEndTime(formatToDatetimeLocal(cand?.endTime));
    setRescheduleCandId(candId);
  };

  const handleRescheduleSubmit = async () => {
    if (!rescheduleCandId) return;

    if (!rescheduleStartTime) {
      toast.error('New Start Time is required.');
      return;
    }
    if (!rescheduleEndTime) {
      toast.error('New End Time is required.');
      return;
    }
    if (new Date(rescheduleEndTime) <= new Date(rescheduleStartTime)) {
      toast.error('End Time must be after Start Time.');
      return;
    }
    // Strict future-start validation: PrimeHire rejects windows that have
    // already started. Use MIN_RESCHEDULE_BUFFER_MS for a safe operational
    // margin, giving the operator time to generate the link.
    {
      const nowMs = Date.now();
      const startMs = new Date(rescheduleStartTime).getTime();
      const endMs = new Date(rescheduleEndTime).getTime();
      if (endMs <= nowMs) {
        toast.error('Cannot reschedule: End Time has already passed. Pick a future window.');
        return;
      }
      if (startMs < nowMs + MIN_RESCHEDULE_BUFFER_MS) {
        const bufferMin = Math.ceil(MIN_RESCHEDULE_BUFFER_MS / 60_000);
        toast.error(
          `Cannot reschedule: Start Time must be at least ${bufferMin} minutes in the future. Pick a later time.`,
        );
        return;
      }
    }

    setIsRescheduling(true);
    try {
      const startIso = new Date(rescheduleStartTime).toISOString();
      const endIso = new Date(rescheduleEndTime).toISOString();

      const cand = candidates.find(c => c.id === rescheduleCandId);

      if (cand?.interviewId) {
        // Candidate has an existing interview — call PrimeHire reschedule API
        const updated = await mockRescheduleInterview(rescheduleCandId, candidates, startIso, endIso);
        onSetCandidates(updated);
        toast.success('Interview rescheduled successfully! New schedule window applied.');
        if (await pushCandidatesToServer(updated.filter(c => c.id === rescheduleCandId)) > 0) {
          toast.warning('Rescheduled, but server sync failed — the change may not appear in other browsers.');
        }
      } else {
        // No interview yet — just update the stored times locally + MongoDB
        onSetCandidates(prev => prev.map(c =>
          c.id === rescheduleCandId
            ? { ...c, startTime: startIso, endTime: endIso }
            : c
        ));
        toast.success('Interview window updated. You can now generate a link.');
        // Sync the updated candidate to MongoDB
        const updatedCand = { ...cand!, startTime: startIso, endTime: endIso };
        if (updatedCand.mongoId) {
          try {
            await updateCandidate(updatedCand.id, { startTime: startIso, endTime: endIso });
          } catch {
            toast.warning('Window updated locally, but server sync failed.');
          }
        }
      }

      setRescheduleCandId(null);
      setRescheduleStartTime('');
      setRescheduleEndTime('');
    } catch (err: any) {
      toast.error('Reschedule failed: ' + err.message);
    } finally {
      setIsRescheduling(false);
    }
  };

  const handleUpdatePasswordSubmit = async () => {
    if (!passwordEditCandId) return;
    if (!newCandPassword.trim()) {
      toast.error('New Password cannot be empty.');
      return;
    }

    setIsSavingPassword(true);
    try {
      const updated = await mockResetCandidatePassword(passwordEditCandId, candidates, newCandPassword.trim());
      onSetCandidates(updated);
      toast.success('Candidate password updated successfully on PrimeHire API!');
      setPasswordEditCandId(null);
      setNewCandPassword('');
    } catch (err: any) {
      toast.error('Failed to update password: ' + err.message);
    } finally {
      setIsSavingPassword(false);
    }
  };

  const handleRegenerateReport = async (candId: LocalCandidateId) => {
    try {
      const updated = await mockRegenerateReport(candId, candidates);
      onSetCandidates(updated);
      toast.success('Report regeneration requested successfully! Status is now Analyzing.');
      if (await pushCandidatesToServer(updated.filter(c => c.id === candId)) > 0) {
        toast.warning('Regeneration requested, but server sync failed — status may not appear in other browsers.');
      }
    } catch (err: any) {
      toast.error('Failed to regenerate report: ' + err.message);
    }
  };

  // Legacy fallback: regenerate link for candidates without an interviewId
  const handleRegenerateCandidateLink = async (candId: LocalCandidateId) => {
    if (!activeAssessment) return;
    const cand = candidates.find(c => c.id === candId);
    if (cand && cand.status !== 'ACTIVE') {
      toast.error('Cannot regenerate link for an Inactive candidate.');
      return;
    }
    try {
      const updated = await mockRegenerateLink(candId, candidates, activeAssessment.roundType, activeAssessment.jobId);
      onSetCandidates(updated);
      toast.success('Previous link invalidated. Issued fresh credentials.');
      if (await pushCandidatesToServer(updated.filter(c => c.id === candId)) > 0) {
        toast.warning('Link reissued, but server sync failed — the new link may not appear in other browsers.');
      }
    } catch (err: any) {
      toast.error('Regeneration failed: ' + err.message);
    }
  };

  const [syncingCandidateId, setSyncingCandidateId] = useState<string | null>(null);

  const handleCheckCandidateStatus = async (candId: LocalCandidateId) => {
    setSyncingCandidateId(candId);
    try {
      const updated = await mockGetInterviewStatus(candId, candidates);
      onSetCandidates(updated);
      const target = updated.find(c => c.id === candId);
      if (await pushCandidatesToServer(updated.filter(c => c.id === candId)) > 0) {
        toast.warning('Status synced from PrimeHire, but saving it to the server failed.');
      } else if (target?.submittedDate) {
        toast.success(`Synced successfully! Assessment completed: ${target.submittedDate}`);
      } else {
        toast.info('Interview not completed yet.');
      }
    } catch (err: any) {
      toast.error('Failed to sync status: ' + err.message);
    } finally {
      setSyncingCandidateId(null);
    }
  };

  const sendEmailViaApi = async (toEmail: string, toName: string, subject: string, plainTextBody: string) => {
    const htmlBody = `
      <div style="font-family: sans-serif; font-size: 14px; color: #111827; line-height: 1.6; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px;">
        ${plainTextBody.split('\n').map(line => line.trim() ? `<div>${line}</div>` : '<br/>').join('')}
      </div>
    `;

    const response = await fetch('/api/send-email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        toEmail,
        toName,
        subject,
        htmlBody
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      let parsedErr = errText;
      try {
        const json = JSON.parse(errText);
        parsedErr = json.error || errText;
      } catch {
        // use errText as is
      }
      throw new Error(parsedErr || `Server error ${response.status}`);
    }

    return await response.json();
  };

  // Invitation eligibility: generated link + active + not completed + window not ended.
  const isInviteEligible = (c: Candidate) =>
    (c.link !== null && c.link !== '') &&
    c.status === 'ACTIVE' &&
    !c.submittedDate &&
    !(new Date() > new Date(c.endTime) || c.interviewExpired);

  // Opens the template picker instead of sending immediately — the mail is
  // sent only with the template the operator selects in the dialog.
  const openInviteDialog = (candIds: LocalCandidateId[]) => {
    const targets = activeAssessmentCandidates.filter(c => candIds.includes(c.id));
    if (targets.length === 1) {
      const t = targets[0];
      if (!t.link) {
        toast.error('Cannot send invitation before a valid credentials link is generated.');
        return;
      }
      if (t.submittedDate) {
        toast.error('Cannot send invitation to a student who has completed the assessment.');
        return;
      }
      if (t.status === 'INACTIVE') {
        toast.error('Cannot send email to an inactive candidate.');
        return;
      }
      if (new Date() > new Date(t.endTime) || t.interviewExpired) {
        toast.error('Cannot send invitation for an expired assessment.');
        return;
      }
    }
    const eligible = targets.filter(isInviteEligible);
    if (eligible.length === 0) {
      toast.error('No selected active candidates meet invitation criteria (must have generated links, not be completed, and be active).');
      return;
    }
    if (templates.length === 0) {
      toast.error('No mail templates available. Create one under Mail Templates first.');
      return;
    }
    const def = templates.find(t => t.type === 'STANDARD_INVITATION') || templates[0];
    setInviteTemplateId(def.id);
    setInviteDialogCandIds(eligible.map(c => c.id));
  };

  // Sends using ONLY the dialog-selected template (single or bulk).
  const executeSendInvites = async () => {
    const template = templates.find(t => t.id === inviteTemplateId);
    if (!template) {
      toast.error('Select a mail template first.');
      return;
    }
    const targets = activeAssessmentCandidates
      .filter(c => inviteDialogCandIds.includes(c.id))
      .filter(isInviteEligible);
    if (targets.length === 0) {
      toast.error('No eligible candidates left to invite.');
      setInviteDialogCandIds([]);
      return;
    }
    const single = targets.length === 1;
    setIsSendingInvite(true);
    onSetCandidates(prev => prev.map(c =>
      targets.some(tc => tc.id === c.id)
        ? { ...c, rowLoading: true, mailStatus: 'Sending' as const }
        : c
    ));
    let successCount = 0;
    let failCount = 0;
    let inviteSyncFailCount = 0;
    for (const cand of targets) {
      try {
        const { subject, body } = renderTemplate(template, cand, activeAssessment!);
        await sendEmailViaApi(cand.email, cand.name, subject, body);
        successCount++;
        const nowIso = new Date().toISOString();
        onSetCandidates(prev => prev.map(c => {
          if (c.id === cand.id) {
            return {
              ...c,
              rowLoading: false,
              inviteSent: true,
              inviteSentAt: nowIso,
              lastInviteSentAt: nowIso,
              mailStatus: 'Invite Sent' as const
            };
          }
          return c;
        }));
        const synced: Candidate = {
          ...cand,
          rowLoading: false,
          inviteSent: true,
          inviteSentAt: nowIso,
          lastInviteSentAt: nowIso,
          mailStatus: 'Invite Sent' as const,
        };
        if (await syncCandidateToServer(synced) === 'failed') inviteSyncFailCount++;
      } catch (err: any) {
        console.error(`Invite fail for ${cand.email}:`, err);
        failCount++;
        onSetCandidates(prev => prev.map(c => {
          if (c.id === cand.id) {
            return { ...c, rowLoading: false, mailStatus: 'Failed' as const };
          }
          return c;
        }));
      }
    }
    setIsSendingInvite(false);
    setInviteDialogCandIds([]);
    setSelectedCandidateIds([]);
    if (single && successCount === 1) {
      toast.success(`Invitation email transmitted successfully to ${targets[0].name}.`);
    } else if (successCount > 0) {
      toast.success(`Bulk dispatched invitations for ${successCount} candidate(s).`);
    }
    if (failCount > 0) {
      toast.error(`Failed to dispatch invitations for ${failCount} candidate(s).`);
    }
    if (inviteSyncFailCount > 0) {
      toast.warning(`Server sync failed for ${inviteSyncFailCount} invited candidate(s).`);
    }
  };

  const handleSendReminder = async (candId: LocalCandidateId) => {
    const target = candidates.find(c => c.id === candId);
    if (!target) return;

    if (!target.lastInviteSentAt && !target.inviteSent) {
      toast.error('Cannot send reminder before an invitation has been sent.');
      return;
    }
    if (target.submittedDate) {
      toast.error('Cannot send reminder for a completed assessment.');
      return;
    }
    if (target.status === 'INACTIVE') {
      toast.error('Cannot send reminder to an inactive candidate.');
      return;
    }
    const isExpired = new Date() > new Date(target.endTime);
    if (isExpired || target.interviewExpired) {
      toast.error('Cannot send reminder for an expired assessment.');
      return;
    }

    // Set row loading & mailStatus
    onSetCandidates(prev => prev.map(c => c.id === candId ? { ...c, rowLoading: true, mailStatus: 'Sending' } : c));

    try {
      const template = templates.find(t => t.type === 'REMINDER') || templates.find(t => t.id === 'tpl-reminder') || templates[0];
      if (!template) {
        throw new Error('No reminder email template found.');
      }

      const { subject, body } = renderTemplate(template, target, activeAssessment!);

      await sendEmailViaApi(target.email, target.name, subject, body);

      const nowIso = new Date().toISOString();
      onSetCandidates(prev => prev.map(c => {
        if (c.id === candId) {
          return {
            ...c,
            rowLoading: false,
            lastReminderSentAt: nowIso,
            reminderCount: (c.reminderCount || 0) + 1,
            mailStatus: 'Reminder Sent' as const
          };
        }
        return c;
      }));
      toast.success(`Reminder email transmitted successfully to ${target.name}.`);
      const reminderSynced: Candidate = {
        ...target,
        rowLoading: false,
        lastReminderSentAt: nowIso,
        reminderCount: (target.reminderCount || 0) + 1,
        mailStatus: 'Reminder Sent' as const,
      };
      if (await syncCandidateToServer(reminderSynced) === 'failed') {
        toast.warning('Reminder sent, but server sync failed — reminder state may not appear in other browsers.');
      }
    } catch (err: any) {
      onSetCandidates(prev => prev.map(c => c.id === candId ? { ...c, rowLoading: false, mailStatus: 'Failed' } : c));
      toast.error(`Failed to send reminder: ${err.message}`);
    }
  };

  const handleBulkGenerateLinks = async () => {
    if (selectedCandidateIds.length === 0 || !activeAssessment) {
      toast.error('Select at least one candidate first.');
      return;
    }
    const activeSelectedIds = selectedCandidateIds.filter(id => {
      const cand = candidates.find(c => c.id === id);
      return cand && cand.status === 'ACTIVE';
    });
    if (activeSelectedIds.length === 0) {
      toast.error('None of the selected candidates are Active. Cannot generate links.');
      return;
    }
    // QA #12: skip windows PrimeHire would reject (already started/ended).
    const nowMs = Date.now();
    const sendableIds = activeSelectedIds.filter(id => {
      const cand = candidates.find(c => c.id === id);
      if (!cand) return false;
      const start = parseServerDate(cand.startTime);
      const end = parseServerDate(cand.endTime);
      return (
        !!start && !!end &&
        end.getTime() > nowMs &&
        start.getTime() >= nowMs + MIN_GENERATE_BUFFER_MS &&
        end.getTime() > start.getTime()
      );
    });
    const skipped = activeSelectedIds.filter(id => !sendableIds.includes(id));
    if (skipped.length > 0) {
      toast.error(
        `${skipped.length} candidate(s) skipped: interview window already started or ended. Reschedule them to a future window first.`,
      );
      if (sendableIds.length === 0) return;
    }

    // Set rowLoading to true for all sendable candidates to show spinners and disable actions
    onSetCandidates(prev => prev.map(c => sendableIds.includes(c.id) ? { ...c, rowLoading: true } : c));

    try {
      const updated = await mockGenerateLink(sendableIds, candidates, activeAssessment.roundType, activeAssessment.jobId);
      onSetCandidates(updated);
      if (sendableIds.length < selectedCandidateIds.length) {
        toast.success(`Generated links for ${sendableIds.length} candidate(s). Others were skipped (inactive or past window).`);
      } else {
        toast.success('All of the links generated.');
      }
      if (await pushCandidatesToServer(updated.filter(c => sendableIds.includes(c.id))) > 0) {
        toast.warning('Links created, but server sync failed for some candidates.');
      }
      setSelectedCandidateIds([]);
    } catch (err: any) {
      // Revert loading states on error
      onSetCandidates(prev => prev.map(c => sendableIds.includes(c.id) ? { ...c, rowLoading: false } : c));
      toast.error('Bulk generation failed: ' + err.message);
    }
  };

  // Bulk invites go through the same template picker dialog (one template
  // chosen by the operator is applied to every selected candidate).
  const handleBulkSendInvites = () => {
    openInviteDialog(selectedCandidateIds);
  };

  const handleBulkSendReminders = async () => {
    const selectedActiveCands = activeAssessmentCandidates.filter(c => selectedCandidateIds.includes(c.id));
    // Rule: selected rows with invite already sent and not completed only, must also be active and not expired
    const targetCands = selectedActiveCands.filter(c => 
      (c.inviteSent || !!c.lastInviteSentAt) && 
      !c.submittedDate && 
      c.status === 'ACTIVE' &&
      !(new Date() > new Date(c.endTime) || c.interviewExpired)
    );

    if (targetCands.length === 0) {
      toast.error('No selected active candidates meet the criteria for a reminder (must be invited, not completed, active, and not expired).');
      return;
    }

    // Set row loading for all targets
    onSetCandidates(prev => prev.map(c => 
      targetCands.some(tc => tc.id === c.id) 
        ? { ...c, rowLoading: true, mailStatus: 'Sending' } 
        : c
    ));

    const template = templates.find(t => t.type === 'REMINDER') || templates.find(t => t.id === 'tpl-reminder') || templates[0];
    if (!template) {
      toast.error('No reminder template found.');
      onSetCandidates(prev => prev.map(c => 
        targetCands.some(tc => tc.id === c.id) ? { ...c, rowLoading: false } : c
      ));
      return;
    }

    let successCount = 0;
    let failCount = 0;
    let reminderSyncFailCount = 0;

    const promises = targetCands.map(async (cand) => {
      try {
        const { subject, body } = renderTemplate(template, cand, activeAssessment!);
        await sendEmailViaApi(cand.email, cand.name, subject, body);
        successCount++;

        const nowIso = new Date().toISOString();
        onSetCandidates(prev => prev.map(c => {
          if (c.id === cand.id) {
            return {
              ...c,
              rowLoading: false,
              lastReminderSentAt: nowIso,
              reminderCount: (c.reminderCount || 0) + 1,
              mailStatus: 'Reminder Sent' as const
            };
          }
          return c;
        }));
        const synced: Candidate = {
          ...cand,
          rowLoading: false,
          lastReminderSentAt: nowIso,
          reminderCount: (cand.reminderCount || 0) + 1,
          mailStatus: 'Reminder Sent' as const,
        };
        if (await syncCandidateToServer(synced) === 'failed') reminderSyncFailCount++;
      } catch (err: any) {
        console.error(`Bulk reminder fail for ${cand.email}:`, err);
        failCount++;
        onSetCandidates(prev => prev.map(c => {
          if (c.id === cand.id) {
            return {
              ...c,
              rowLoading: false,
              mailStatus: 'Failed' as const
            };
          }
          return c;
        }));
      }
    });

    await Promise.all(promises);

    if (successCount > 0) {
      toast.success(`Bulk dispatched reminders for ${successCount} candidate(s).`);
    }
    if (failCount > 0) {
      toast.error(`Failed to dispatch reminders for ${failCount} candidate(s).`);
    }
    if (reminderSyncFailCount > 0) {
      toast.warning(`Server sync failed for ${reminderSyncFailCount} reminded candidate(s).`);
    }
    setSelectedCandidateIds([]);
  };

  const handleSimulateCompletion = (candId: string) => {
    const target = candidates.find(c => c.id === candId);
    if (!target) return;

    onSetCandidates(prev => prev.map(c => {
      if (c.id === candId) {
        return {
          ...c,
          submittedDate: new Date().toISOString(),
          assessmentStatus: 'COMPLETED',
          reportStatus: 'GENERATED' as const,
          answers: { 'q-react-1': 'Simulated response from Recruiter Admin sandbox.' },
          simulatedReport: {
            overallScore: 88,
            strengths: ['Clear articulate formulation', 'In-depth conceptual grasp'],
            weaknesses: ['Minor edge case oversight'],
            answersFeedback: [
              { questionId: 'q-react-1', score: 18, maxScore: 20, feedback: 'Strong architectural answers.' }
            ]
          }
        };
      }
      return c;
    }));
    toast.success(`Simulated candidate ${target.name} completing their assessment. Review AI Scorecard now!`);
  };

  const handleToggleExpiry = (candId: string) => {
    const target = candidates.find(c => c.id === candId);
    if (!target) return;

    const isCurrentlyExpired = new Date() > new Date(target.endTime) || target.interviewExpired;
    const nextEndTime = isCurrentlyExpired 
      ? new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString() // 3 days in future
      : new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // 1 day in past

    onSetCandidates(prev => prev.map(c => {
      if (c.id === candId) {
        return {
          ...c,
          endTime: nextEndTime,
          interviewExpired: !isCurrentlyExpired
        };
      }
      return c;
    }));
    toast.success(`Schedules updated for ${target.name}: evaluation is now ${!isCurrentlyExpired ? 'EXPIRED' : 'ACTIVE'}.`);
  };

  // Two step delete confirmation handlers
  const handleTriggerDeleteCandidate = (id: string) => {
    setDeleteConfirmCandId(id);
    setDoubleConfirmCandId(null);
  };

  const handleDoubleConfirmDeleteCandidate = (id: string) => {
    setDoubleConfirmCandId(id);
  };

  // Server-first delete: the candidate is soft-deleted on the server (kept
  // with deletedAt/deletedBy + audit trail, hidden from reads; PrimeHire
  // interviews/reports are never touched). Local state only changes on
  // server success — a failed delete keeps the candidate with an error.
  const handleFinalDeleteCandidate = async (id: string) => {
    const target = candidates.find(c => c.id === id);
    if (target?.mongoId) {
      try {
        await deleteCandidate(id);
      } catch (err: any) {
        toast.error(`Delete failed on server (${err?.message || err}) — candidate kept.`);
        return;
      }
    }
    onSetCandidates(prev => prev.filter(c => c.id !== id));
    toast.success(
      target?.mongoId
        ? 'Candidate registration deleted successfully (server).'
        : 'Candidate removed locally (was never saved to server).',
    );
    setDeleteConfirmCandId(null);
    setDoubleConfirmCandId(null);
  };

  const handleBulkDeleteCandidates = async () => {
    if (selectedCandidateIds.length === 0) {
      toast.error('Select candidates to delete.');
      return;
    }
    const targets = candidates.filter(c => selectedCandidateIds.includes(c.id));
    const persisted = targets.filter(c => c.mongoId);
    const results = await Promise.allSettled(persisted.map(c => deleteCandidate(c.id)));
    const failedIds = new Set(
      persisted.filter((_, i) => results[i].status === 'rejected').map(c => c.id),
    );
    const removed = targets.filter(c => !failedIds.has(c.id)).length;
    onSetCandidates(prev => prev.filter(c => !selectedCandidateIds.includes(c.id) || failedIds.has(c.id)));
    if (failedIds.size > 0) {
      toast.error(`Server delete failed for ${failedIds.size} candidate(s) — kept locally.`);
      setSelectedCandidateIds(prev => prev.filter(id => failedIds.has(id)));
    } else {
      toast.success(`Deleted ${removed} candidates (server).`);
      setSelectedCandidateIds([]);
    }
  };

  // =========================================================================
  // HANDLERS FOR CANDIDATE UPLOAD MODULE (CSV PARSER)
  // =========================================================================
  const triggerSampleTemplateCSV = () => {
    const csvContent = `Name,Email,Phone,Start Time,End Time
Isaac Newton,newton@cambridge.edu,+44-1234-5678,2026-07-05T09:00:00Z,2026-07-05T12:00:00Z
Marie Curie,curie@sorbonne.fr,,2026-07-06T10:00:00Z,2026-07-06T13:00:00Z
Albert Einstein,einstein@ias.edu,+1-555-1915,2026-07-07T14:00:00Z,2026-07-07T17:00:00Z
Galileo Galilei,galileo@pisa.it,invalid_phone,2026-07-08T09:00:00Z,2026-07-08T08:00:00Z
Duplicate User,curie@sorbonne.fr,+1-555-0000,2026-07-09T10:00:00Z,2026-07-09T12:00:00Z
,missing.name@test.com,,2026-07-10T11:00:00Z,2026-07-10T13:00:00Z`;
    
    setUploadedFileName('sample_candidates.csv');
    parseCSVContent(csvContent);
  };

  const handleCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (file.size > 10 * 1024 * 1024) {
      toast.error('Maximum upload size is 10MB.');
      return;
    }

    setUploadedFileName(file.name);
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      parseCSVContent(text);
    };
    reader.readAsText(file);
  };

  const parseCSVContent = (text: string) => {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length <= 1) {
      toast.error('Uploaded CSV is empty or only contains headers.');
      return;
    }

    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    
    // Expected headers check
    const expected = ['name', 'email', 'phone', 'start time', 'end time'];
    const headersMatch = expected.every(exp => headers.includes(exp));

    if (!headersMatch) {
      toast.error('CSV headers mismatch. Required: Name, Email, Phone, Start Time, End Time');
      return;
    }

    const colIndex = {
      name: headers.indexOf('name'),
      email: headers.indexOf('email'),
      phone: headers.indexOf('phone'),
      start: headers.indexOf('start time'),
      end: headers.indexOf('end time')
    };

    const parsedData: any[] = [];

    for (let i = 1; i < lines.length; i++) {
      // Split by commas, handling basic text splitting
      const cols = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));

      const name = cols[colIndex.name] || '';
      const email = cols[colIndex.email] || '';
      const phone = cols[colIndex.phone] || '';
      const start = cols[colIndex.start] || '';
      const end = cols[colIndex.end] || '';

      const rowObj = {
        rowId: 'row-' + i,
        name,
        email,
        phone,
        startTime: start,
        endTime: end
      };

      parsedData.push(rowObj);
    }

    setParsedRows(parsedData);
    toast.success(`Successfully read ${parsedData.length} records. Please review validations.`);
  };

  const handleUpdateImportRow = (rowId: string, field: string, value: string) => {
    setParsedRows(prev => prev.map(r => r.rowId === rowId ? { ...r, [field]: value } : r));
    // Trigger re-validation simple mock
    toast.info('Recalculating inline edit validation checks...');
  };

  const handleRemoveImportRow = (rowId: string) => {
    setParsedRows(prev => prev.filter(r => r.rowId !== rowId));
  };

  const handleConfirmCandidateImport = async () => {
    if (parsedRows.length === 0) {
      toast.error('No candidate data rows found.');
      return;
    }

    // Block if there are red validations
    const hasRedErrors = validationErrors.some(e => e.type === 'red');
    if (hasRedErrors) {
      toast.error('Import Blocked: Resolve all red/blocking errors before submitting.');
      return;
    }

    try {
      const formatted = parsedRows.map(r => {
        let start = r.startTime ? r.startTime.trim() : '';
        let end = r.endTime ? r.endTime.trim() : '';

        // If empty, assign standard default dates:
        if (!start) {
          start = new Date().toISOString();
        } else {
          start = new Date(start).toISOString();
        }

        if (!end) {
          end = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
        } else {
          end = new Date(end).toISOString();
        }

        return {
          name: r.name,
          email: r.email,
          phone: r.phone,
          startTime: start,
          endTime: end
        };
      });

      // Server-first persistence: React -> FastAPI POST /api/candidates/bulk
      // -> MongoDB. Nothing is added locally until the server confirms it,
      // so a failed save can never look like a success in another browser.
      const payloads = formatted.map(f => ({
        assessmentId: selectedAssessmentId!,
        name: f.name,
        email: f.email,
        phone: f.phone,
        startTime: f.startTime,
        endTime: f.endTime,
      }));
      const { items, errors } = await createCandidatesBulk(payloads);
      if (items.length > 0) {
        onSetCandidates(prev => [...prev, ...items]);
      }
      if (errors.length === 0) {
        toast.success(`Dispatched ${items.length} candidates into assignment pipeline (saved to server).`);
        // Cleanup Upload view
        setParsedRows([]);
        setValidationErrors([]);
        setUploadedFileName('');
        setCurrentView('DETAIL');
      } else if (items.length > 0) {
        const failedIdx = new Set(errors.map(e => e.index));
        const failedMsgs = errors.slice(0, 3).map(e => `row ${e.index + 1} [${e.code}]: ${e.message}`).join('; ');
        toast.warning(`Saved ${items.length} to server, ${errors.length} failed (${failedMsgs}). Failed rows kept in review.`);
        // Keep only failed rows in the review list for correction.
        setParsedRows(prev => prev.filter((_, i) => failedIdx.has(i)));
        setValidationErrors([]);
        setUploadedFileName('');
      } else {
        const failedMsgs = errors.slice(0, 3).map(e => `row ${e.index + 1} [${e.code}]: ${e.message}`).join('; ');
        toast.error(`Save failed — nothing was stored (${failedMsgs}). Review list kept.`);
      }
    } catch (err: any) {
      toast.error('Save failed: ' + (err?.message || err) + ' — nothing was stored. Review list kept.');
    }
  };

  const handleAddManualCandidate = (e: React.FormEvent) => {
    e.preventDefault();

    if (!manualName.trim()) {
      toast.error('Name is mandatory.');
      return;
    }
    const nameRegex = /^[a-zA-Z\s.\-]+$/;
    if (!nameRegex.test(manualName)) {
      toast.error('Name can only contain letters, spaces, hyphens, and dots.');
      return;
    }

    if (!manualEmail.trim()) {
      toast.error('Email is required.');
      return;
    }
    if (!manualEmail.includes('@')) {
      toast.error('Email must contain "@" symbol.');
      return;
    }
    const parts = manualEmail.split('@');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      toast.error('Invalid email structure around "@".');
      return;
    }
    const domain = parts[1];
    if (!domain.includes('.')) {
      toast.error('Email domain must contain a dot (e.g. ".com").');
      return;
    }

    if (manualPhone.trim()) {
      const digitsOnly = manualPhone.replace(/\D/g, '');
      if (digitsOnly.length !== 10) {
        toast.error('Phone number must contain exactly 10 digits.');
        return;
      }
    }

    // Checking if times are empty
    const isStartEmpty = !manualStartTime.trim();
    const isEndEmpty = !manualEndTime.trim();
    if ((isStartEmpty || isEndEmpty) && !timeConsent) {
      toast.error('Start Time or End Time is empty. Please check the consent box below to proceed with default scheduling.');
      return;
    }

    // Determine default start and end times if empty
    let finalStart = manualStartTime.trim();
    let finalEnd = manualEndTime.trim();

    if (!finalStart) {
      finalStart = new Date().toISOString().substring(0, 16); // Local format or ISO
    }
    if (!finalEnd) {
      finalEnd = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().substring(0, 16);
    }

    const newRowObj = {
      rowId: 'manual-' + Date.now() + '-' + Math.random().toString(36).substring(2, 5),
      name: manualName.trim(),
      email: manualEmail.trim(),
      phone: manualPhone.trim() ? manualPhone.trim() : '',
      startTime: finalStart,
      endTime: finalEnd
    };

    setParsedRows(prev => [...prev, ...[newRowObj]]);
    toast.success(`Successfully registered ${manualName.trim()} in the review list!`);

    // Reset fields
    setManualName('');
    setManualEmail('');
    setManualPhone('');
    setManualStartTime('');
    setManualEndTime('');
    setTimeConsent(false);
  };

  return (
    <div className="space-y-6 text-foreground">
      {/* =========================================================================
          VIEW 1: ASSESSMENT CARD LIST
          ========================================================================= */}
      {currentView === 'LIST' && (
        <div className="space-y-6">
          <div className="flex justify-between items-start gap-4">
            <div className="flex items-start gap-3">
              <IconSquare><Cpu className="w-5 h-5" /></IconSquare>
              <div>
                <span className="eyebrow block">Profiles & scheduling</span>
                <h2 className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground">
                  Assessments & Candidate Assignments
                </h2>
                <p className="text-xs text-muted-foreground mt-1">
                  Establish individual assessment profiles, assign candidate schedules via CSV uploads, and monitor security access credentials.
                </p>
              </div>
            </div>
            <PAButton
              onClick={() => {
                setEditingAssessmentId(null);
                setFormJobId('JOB-' + generate32BitId());
                setFormJobTitle('');
                setFormJobDescription('');
                setFormLanguage('ENGLISH');
                setFormRoundType('TECHNICAL');
                setFormQuestions([
                  { id: 'q-1', text: '', type: 'SPEAK_TO_ANSWER', maxDuration: 120, maxScore: 50, weightage: 100 }
                ]);
                setFormStartDate('');
                setFormEndDate('');
                setCurrentView('CREATE');
              }}
              className="shrink-0"
            >
              <Plus className="w-3.5 h-3.5" /> New Assessment
            </PAButton>
          </div>



          {(() => {
            const query = globalSearchQuery ? globalSearchQuery.trim().toLowerCase() : '';
            const filteredAssessments = assessments.filter(asm => {
              const matchesRound = !globalRoundFilter || globalRoundFilter === 'ALL' || asm.roundType === globalRoundFilter;
              const matchesSearch = !query ||
                (asm.jobTitle && asm.jobTitle.toLowerCase().includes(query)) ||
                (asm.jobId && asm.jobId.toLowerCase().includes(query)) ||
                (asm.jobDescription && asm.jobDescription.toLowerCase().includes(query));
              return matchesRound && matchesSearch;
            });

            if (assessmentsLoading && assessments.length === 0) {
              return (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4" aria-label="Loading assessments">
                  {[0, 1, 2].map(i => (
                    <div key={i} className="bg-card rounded-2xl border border-border/70 p-5 shadow-[var(--shadow-card)] animate-pulse">
                      <div className="h-4 w-2/3 rounded bg-muted" />
                      <div className="h-3 w-1/3 rounded bg-muted mt-2" />
                      <div className="flex gap-2 mt-4">
                        <div className="h-5 w-16 rounded bg-muted" />
                        <div className="h-5 w-20 rounded bg-muted" />
                      </div>
                      <div className="h-9 rounded bg-muted mt-4" />
                    </div>
                  ))}
                </div>
              );
            }

            if (assessmentsError && assessments.length === 0) {
              return (
                <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-8 text-center space-y-3">
                  <p className="text-sm font-semibold text-foreground">Couldn&apos;t load assessments.</p>
                  <p className="text-xs text-muted-foreground">Your data is safe on the server — this is a connection problem.</p>
                  <button
                    onClick={onRefreshAssessments}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold transition cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> Retry
                  </button>
                </div>
              );
            }

            if (filteredAssessments.length === 0) {
              return (
                <div className="rounded-2xl border border-border/70 bg-card p-12 text-center space-y-2">
                  <p className="text-sm font-semibold text-foreground">
                    {query || (globalRoundFilter && globalRoundFilter !== 'ALL')
                      ? 'No assessment profiles match your filter criteria.'
                      : 'No assessment profiles yet.'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {query
                      ? `No profiles match "${globalSearchQuery}". Try a different keyword or reset filters.`
                      : 'Click "+ New Assessment" above — it saves to the server and appears on every device.'}
                  </p>
                </div>
              );
            }

            return (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {filteredAssessments.map((asm) => {
              const assessmentCandidates = candidates.filter(c => c.assessmentId === asm.id);
              const activeCandCount = assessmentCandidates.filter(c => c.status === 'ACTIVE').length;
              return (
                <div
                  key={asm.id}
                  className={`bg-card rounded-2xl border border-border/70 p-5 shadow-[var(--shadow-card)] transition-all duration-200 hover:-translate-y-0.5 flex flex-col justify-between min-h-[255px] relative ${
                    asm.isActive
                      ? ''
                      : 'opacity-75'
                  }`}
                >
                  <div>
                    {/* Header: Title and edit options */}
                    <div className="flex items-start justify-between">
                      <div className="space-y-1 pr-12 min-w-0">
                        <h3 className="text-sm font-bold text-foreground truncate" title={asm.jobTitle}>
                          {asm.jobTitle}
                        </h3>
                        <span className="text-[10px] text-gray-400 font-mono font-bold uppercase">
                          {asm.jobId}
                        </span>
                      </div>
                      
                      {/* Actions: Edit icon & Three dots menu */}
                      <div className="flex items-center gap-1 shrink-0">
                        {/* Quick Edit icon */}
                        <button
                          onClick={() => handleStartEditAssessment(asm)}
                          className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition cursor-pointer"
                          title="Edit Assessment"
                        >
                          <Edit className="w-3.5 h-3.5" />
                        </button>

                        {/* Three Dots Menu */}
                        <div className="relative inline-block text-left">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveDropdownAsmId(activeDropdownAsmId === asm.id ? null : asm.id);
                            }}
                            className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition cursor-pointer"
                            title="Actions"
                          >
                            <MoreVertical className="w-3.5 h-3.5" />
                          </button>
                          
                          {activeDropdownAsmId === asm.id && (
                            <>
                              <div 
                                className="fixed inset-0 z-10" 
                                onClick={() => setActiveDropdownAsmId(null)} 
                              />
                              <div className="absolute right-0 mt-1.5 w-36 rounded-lg bg-card border border-border/70 shadow-md z-20 py-1 text-left">
                                <button
                                  onClick={() => {
                                    handleToggleAssessmentActiveState(asm.id);
                                    setActiveDropdownAsmId(null);
                                  }}
                                  disabled={togglingAsmId === asm.id}
                                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted/40 text-foreground flex items-center gap-2 font-medium disabled:opacity-50"
                                >
                                  <span className={`w-1.5 h-1.5 rounded-full ${asm.isActive ? 'bg-destructive' : 'bg-success'}`} />
                                  {togglingAsmId === asm.id ? 'Saving…' : (asm.isActive ? 'Deactivate' : 'Activate')}
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Metadata tags */}
                    <div className="flex flex-wrap gap-2 mt-4">
                      <span className={`text-[9px] font-bold tracking-wider px-2 py-0.5 rounded border ${
                        asm.roundType === 'TECHNICAL' ? 'bg-gray-100 border-gray-300 text-gray-800' :
                        asm.roundType === 'BASIC' ? 'bg-muted/40 border-gray-200 text-foreground' :
                        'bg-muted/40 border-gray-150 text-gray-600'
                      }`}>
                        {asm.roundType}
                      </span>
                      <span className="text-[9px] font-semibold text-muted-foreground bg-muted/40 border border-border/70 px-2 py-0.5 rounded">
                        {asm.questions.length} Questions
                      </span>
                      <span className="text-[9px] font-semibold text-muted-foreground bg-muted/40 border border-border/70 px-2 py-0.5 rounded">
                        {assessmentCandidates.length} Registered
                      </span>
                      {asm.syncState?.state === 'pending' && (
                        <span className="text-[9px] font-bold text-amber-700 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded inline-flex items-center gap-1">
                          <Loader2 className="w-2.5 h-2.5 animate-spin" /> Syncing…
                        </span>
                      )}
                      {asm.syncState?.state === 'failed' && (
                        <span className="inline-flex items-center gap-1">
                          <span className="text-[9px] font-bold text-rose-700 bg-rose-500/10 border border-rose-500/30 px-2 py-0.5 rounded" title={asm.syncState?.error || 'PrimeHire sync failed'}>
                            Sync failed
                          </span>
                          <button
                            onClick={() => handleRetryAssessmentSync(asm)}
                            disabled={retryingAsmId === asm.id}
                            className="text-[9px] font-bold text-rose-700 hover:text-rose-500 underline underline-offset-2 disabled:opacity-50 cursor-pointer"
                          >
                            {retryingAsmId === asm.id ? 'Retrying…' : 'Retry'}
                          </button>
                        </span>
                      )}
                    </div>

                    {/* Dates detail */}
                    <div className="text-[10px] text-gray-400 mt-4 space-y-0.5">
                      <div>Created: {new Date(asm.createdAt).toLocaleDateString()}</div>
                      {asm.startDate && asm.endDate && (
                        <div className="text-muted-foreground font-medium">
                          Active Window: {new Date(asm.startDate).toLocaleDateString()} - {new Date(asm.endDate).toLocaleDateString()}
                        </div>
                      )}
                      {!asm.isActive && asm.deactivatedAt && (
                        <div className="text-destructive font-semibold">
                          Deactivated: {new Date(asm.deactivatedAt).toLocaleDateString()}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Footer buttons */}
                  <div className="flex gap-2.5 mt-4 pt-4 border-t border-gray-100">
                    <button
                      onClick={() => {
                        setSelectedAssessmentId(asm.id);
                        setCurrentView('DETAIL');
                      }}
                      className="flex-1 text-center border border-border/70 hover:bg-muted/40 text-foreground text-xs font-semibold py-2 rounded-md transition flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5" /> View Detail
                    </button>
                    <button
                      onClick={() => {
                        setSelectedAssessmentId(asm.id);
                        setCurrentView('UPLOAD');
                      }}
                      disabled={!asm.isActive}
                      className={`flex-1 text-center text-xs font-bold py-2 rounded-xl transition flex items-center justify-center gap-1 cursor-pointer ${
                        asm.isActive
                          ? 'bg-gradient-primary hover:shadow-[var(--shadow-glow)] hover:-translate-y-0.5 text-white shadow-xs'
                          : 'bg-gray-100 text-gray-400 border border-border/70 cursor-not-allowed'
                      }`}
                    >
                      <UserPlus className="w-3.5 h-3.5" /> Assignments
                    </button>
                  </div>
                </div>
                );
              })}
            </div>
          );
        })()}
        </div>
      )}

      {/* =========================================================================
          VIEW 2: CREATION / EDIT MODULE
          ========================================================================= */}
      {(currentView === 'CREATE' || currentView === 'EDIT') && (
        <div className="space-y-6 text-foreground">
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                setCurrentView('LIST');
                setEditingAssessmentId(null);
                setFormJobId('JOB-' + generate32BitId());
                setFormJobTitle('');
                setFormJobDescription('');
                setFormQuestions([{ id: 'q-1', text: '', type: 'SPEAK_TO_ANSWER', maxDuration: 120, maxScore: 50, weightage: 100 }]);
                setFormStartDate('');
                setFormEndDate('');
              }}
              className="p-1.5 rounded-md border border-border/70 bg-card hover:bg-muted/40 text-foreground transition cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
            </button>
            <div>
              <h2 className="text-lg font-bold text-foreground">
                {currentView === 'EDIT' ? 'Edit Assessment Profile' : 'Create Assessment Profile'}
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {currentView === 'EDIT' 
                  ? 'Modify the structure, questions, and parameters for candidate evaluative screens.' 
                  : 'Design the structure, questions, and parameters for candidate evaluative screens.'}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Columns: Parameters Form */}
            <div className="lg:col-span-2 bg-card p-6 rounded-xl border border-border/70 shadow-sm space-y-6">
              {/* Header block */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-foreground">
                    Job ID <span className="text-destructive">*</span> <span className="text-[10px] text-gray-400 font-normal">(32-bit System Generated)</span>
                  </label>
                  <div className="flex gap-2">
                    <Input
                      readOnly
                      placeholder="e.g. JOB-705"
                      value={formJobId}
                      className="text-xs bg-muted/40 text-muted-foreground select-all flex-1"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        navigator.clipboard.writeText(formJobId);
                        toast.success('Job ID copied to clipboard');
                      }}
                      className="px-2.5 cursor-pointer shrink-0"
                      title="Copy Job ID"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-foreground">
                    Job Title <span className="text-destructive">*</span>
                  </label>
                  <Input
                    placeholder="e.g. Technical Project Lead"
                    value={formJobTitle}
                    onChange={(e) => setFormJobTitle(e.target.value)}
                    className="text-xs font-bold"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-foreground">
                  Job Description <span className="text-destructive">*</span>
                </label>
                <Textarea
                  placeholder="Outline responsibilities, daily operations, and technical stack parameters..."
                  rows={3}
                  value={formJobDescription}
                  onChange={(e) => setFormJobDescription(e.target.value)}
                  className="text-xs"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-foreground">
                    Language Selection
                  </label>
                  <select
                    value={formLanguage}
                    onChange={(e) => setFormLanguage(e.target.value)}
                    className="w-full text-xs rounded-md border border-border/70 bg-card p-2.5 text-foreground focus:outline-hidden"
                  >
                    <option value="ENGLISH">English</option>
                    <option value="DUTCH">Dutch</option>
                  </select>
                  <p className="text-[10px] text-gray-400 italic">Supported by PrimeHire API: English, Dutch</p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-foreground">
                    Round Type <span className="text-destructive">*</span>
                  </label>
                  <select
                    disabled={currentView === 'EDIT'}
                    value={formRoundType}
                    onChange={(e) => {
                      const selectedType = e.target.value as RoundType;
                      setFormRoundType(selectedType);
                      // Set default questions appropriate for the round type to keep weightage correct
                      if (selectedType === 'HR') {
                        setFormQuestions([
                          { id: 'q-1', text: '', type: 'SPEAK_TO_ANSWER', maxDuration: 120 }
                        ]);
                      } else {
                        setFormQuestions([
                          { id: 'q-1', text: '', type: 'SPEAK_TO_ANSWER', maxDuration: 120, maxScore: 50, weightage: 100 }
                        ]);
                      }
                    }}
                    className={`w-full text-xs rounded-md border border-border/70 bg-card p-2.5 text-foreground focus:outline-hidden font-bold ${
                      currentView === 'EDIT' ? 'bg-gray-100 text-muted-foreground cursor-not-allowed' : ''
                    }`}
                  >
                    <option value="TECHNICAL">TECHNICAL (Coding & Technical Speech)</option>
                    <option value="BASIC">BASIC (Behavioral & Criteria Speech)</option>
                    <option value="HR">HR (General Screening - No Scoring)</option>
                  </select>
                </div>
              </div>

              {/* Start Date & End Date Inputs */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-gray-150 pt-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-foreground">
                    Start Date <span className="text-[10px] text-gray-400 font-normal">(Optional)</span>
                  </label>
                  <Input
                    type="datetime-local"
                    value={formStartDate}
                    onChange={(e) => setFormStartDate(e.target.value)}
                    className="text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-foreground">
                    End Date <span className="text-[10px] text-gray-400 font-normal">(Optional)</span>
                  </label>
                  <Input
                    type="datetime-local"
                    value={formEndDate}
                    onChange={(e) => setFormEndDate(e.target.value)}
                    className="text-xs"
                  />
                </div>
              </div>

              {/* Dynamic Questions Panel */}
              <div className="space-y-4 border-t border-gray-100 pt-4">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold uppercase tracking-wider text-gray-400">
                    Dynamic Question Formulation
                  </span>
                  <button
                    onClick={handleAddQuestion}
                    className="text-xs font-semibold text-gray-600 hover:text-foreground hover:underline flex items-center gap-1 transition cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Question Card
                  </button>
                </div>

                <div className="space-y-4">
                  {formQuestions.map((q, idx) => (
                    <div key={q.id} className="p-4 rounded-xl border border-border/70 bg-muted/40/30 space-y-4 relative">
                      {/* Close button */}
                      <button
                        onClick={() => handleRemoveQuestion(idx)}
                        className="absolute right-3 top-3 p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-destructive transition"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>

                      {/* Header block within card */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-muted-foreground uppercase">Question Type <span className="text-destructive">*</span></label>
                          <select
                            value={q.type}
                            onChange={(e) => handleUpdateQuestion(idx, { type: e.target.value as QuestionType })}
                            className="w-full text-xs rounded-lg border border-border/70 bg-card p-2 focus:outline-hidden"
                          >
                            <option value="SPEAK_TO_ANSWER">SPEAK_TO_ANSWER</option>
                            <option value="MCQ">MCQ</option>
                          </select>
                        </div>

                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <label className="text-[10px] font-bold text-muted-foreground uppercase">Max Duration (Seconds) <span className="text-destructive">*</span></label>
                            <span className="text-[9px] text-muted-foreground font-mono">1–120s</span>
                          </div>
                          <Input
                            type="number"
                            min={1}
                            max={120}
                            value={q.maxDuration ?? ''}
                            placeholder="120"
                            onChange={(e) => {
                              const raw = e.target.value.trim();
                              if (raw === '') {
                                handleUpdateQuestion(idx, { maxDuration: '' as any });
                                return;
                              }
                              const cleaned = raw.replace(/^0+(?=\d)/, '');
                              const num = Number(cleaned);
                              if (!isNaN(num)) {
                                e.target.value = cleaned;
                                handleUpdateQuestion(idx, { maxDuration: num });
                              }
                            }}
                            className={`text-xs bg-card ${
                              (typeof q.maxDuration === 'number' && (q.maxDuration > 120 || q.maxDuration < 1))
                                ? 'border-destructive focus-visible:ring-destructive/30'
                                : ''
                            }`}
                          />
                          {typeof q.maxDuration === 'number' && q.maxDuration > 120 && (
                            <p className="text-[10px] text-destructive font-medium">
                              Max duration must be between 1 and 120 seconds.
                            </p>
                          )}
                          {typeof q.maxDuration === 'number' && q.maxDuration < 1 && (
                            <p className="text-[10px] text-destructive font-medium">
                              Max duration must be at least 1 second.
                            </p>
                          )}
                        </div>

                        {formRoundType !== 'HR' && (
                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                              <label className="text-[10px] font-bold text-muted-foreground uppercase">Max Score <span className="text-destructive">*</span></label>
                              <Input
                                type="number"
                                min={1}
                                value={q.maxScore === undefined ? '' : q.maxScore}
                                placeholder="0"
                                onChange={(e) => {
                                  const raw = e.target.value.trim();
                                  if (raw === '') {
                                    handleUpdateQuestion(idx, { maxScore: undefined });
                                    return;
                                  }
                                  const cleaned = raw.replace(/^0+(?=\d)/, '');
                                  const num = Number(cleaned);
                                  if (!isNaN(num)) {
                                    e.target.value = cleaned;
                                    handleUpdateQuestion(idx, { maxScore: Math.max(1, num) });
                                  }
                                }}
                                className="text-xs bg-card"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[10px] font-bold text-muted-foreground uppercase">Weightage % <span className="text-destructive">*</span></label>
                              <Input
                                type="number"
                                min={0}
                                max={100}
                                value={q.weightage === undefined ? '' : q.weightage}
                                placeholder="0"
                                onChange={(e) => {
                                  const raw = e.target.value.trim();
                                  if (raw === '') {
                                    handleUpdateQuestion(idx, { weightage: undefined });
                                    return;
                                  }
                                  // Strip unwanted leading zero (e.g. '05' -> '5', '050' -> '50', while preserving '0')
                                  const cleaned = raw.replace(/^0+(?=\d)/, '');
                                  const num = Number(cleaned);
                                  if (!isNaN(num)) {
                                    e.target.value = cleaned;
                                    handleUpdateQuestion(idx, { weightage: Math.min(100, Math.max(0, num)) });
                                  }
                                }}
                                className="text-xs bg-card"
                              />
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Question Content Input */}
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-muted-foreground uppercase">Question Prompt / Text <span className="text-destructive">*</span></label>
                        <Textarea
                          placeholder="e.g. Write a React hook to manage debounce input schedules..."
                          rows={2}
                          value={q.text}
                          onChange={(e) => handleUpdateQuestion(idx, { text: e.target.value })}
                          className="text-xs bg-card"
                        />
                      </div>

                      {/* CONDITIONAL EXTRA FIELDS */}
                      {/* 1. TECHNICAL + SPEAK_TO_ANSWER -> Reference Answer */}
                      {formRoundType === 'TECHNICAL' && q.type === 'SPEAK_TO_ANSWER' && (
                        <div className="space-y-1.5 border-t border-slate-100 pt-3.5">
                          <label className="text-[10px] font-bold text-blue-600 uppercase flex items-center gap-1">
                            <Sparkles className="w-3 h-3" /> Expected Reference Answer <span className="text-destructive">*</span>
                          </label>
                          <Textarea
                            placeholder="Provide details on correct concepts, structures, or terminology the candidate speech must address..."
                            rows={2}
                            value={q.referenceAnswer || ''}
                            onChange={(e) => handleUpdateQuestion(idx, { referenceAnswer: e.target.value })}
                            className="text-xs bg-card"
                          />
                        </div>
                      )}

                      {/* 2. BASIC + SPEAK_TO_ANSWER -> Rubric Criteria */}
                      {formRoundType === 'BASIC' && q.type === 'SPEAK_TO_ANSWER' && (
                        <div className="space-y-1.5 border-t border-slate-100 pt-3.5">
                          <label className="text-[10px] font-bold text-emerald-600 uppercase">
                            Grading Rubric Criteria <span className="text-destructive">*</span>
                          </label>
                          <Textarea
                            placeholder="Detail parameters such as Empathy, Problem Identification, Tone control, and Resolution cadence..."
                            rows={2}
                            value={q.criteria || ''}
                            onChange={(e) => handleUpdateQuestion(idx, { criteria: e.target.value })}
                            className="text-xs bg-card"
                          />
                        </div>
                      )}

                      {/* 3. MCQ Options list (Universal MCQ DISPLAY) */}
                      {q.type === 'MCQ' && (
                        <div className="space-y-3.5 border-t border-slate-100 pt-3.5">
                          <div className="flex justify-between items-center">
                            <label className="text-[10px] font-bold text-muted-foreground uppercase">MCQ Options Configuration</label>
                            <button
                              onClick={() => {
                                const currentOpts = q.options || [];
                                const letter = String.fromCharCode(65 + currentOpts.length);
                                handleUpdateQuestion(idx, {
                                  options: [...currentOpts, `Option ${letter}`]
                                });
                              }}
                              className="text-[10px] font-semibold text-blue-600 hover:underline flex items-center gap-0.5"
                            >
                              + Add MCQ Row
                            </button>
                          </div>

                          <div className="space-y-2">
                            {(q.options || []).map((opt, optIdx) => (
                              <div key={optIdx} className="flex gap-2 items-center">
                                <span className="text-xs font-mono font-bold text-muted-foreground">
                                  {String.fromCharCode(65 + optIdx)}.
                                </span>
                                <Input
                                  value={opt}
                                  onChange={(e) => {
                                    const nextOpts = [...(q.options || [])];
                                    nextOpts[optIdx] = e.target.value;
                                    handleUpdateQuestion(idx, { options: nextOpts });
                                  }}
                                  className="text-xs bg-card flex-1"
                                />
                                <button
                                  onClick={() => {
                                    const nextOpts = (q.options || []).filter((_, o) => o !== optIdx);
                                    handleUpdateQuestion(idx, { options: nextOpts });
                                  }}
                                  className="p-1 rounded hover:bg-slate-150 text-muted-foreground"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ))}
                          </div>

                          <div className="space-y-1.5 mt-2">
                            <label className="text-[10px] font-bold text-muted-foreground uppercase">Correct MCQ Option</label>
                            <select
                              value={q.correctOption || ''}
                              onChange={(e) => handleUpdateQuestion(idx, { correctOption: e.target.value })}
                              className="w-full text-xs rounded-lg border border-border/70 bg-card p-2 focus:outline-hidden"
                            >
                              {(q.options || []).map((opt, o) => (
                                <option key={o} value={opt}>{opt}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right Column: Submission Summary & Weightage validation */}
            <div className="space-y-6 text-foreground">
              <div className="bg-card border border-border/70 p-5 rounded-xl space-y-4 shadow-sm">
                <span className="text-xs font-bold uppercase tracking-wider text-gray-400">
                  Profile Summary
                </span>
                
                <div className="space-y-3.5 text-xs">
                  <div className="flex justify-between font-bold">
                    <span className="text-gray-400">Round Type:</span>
                    <span className="font-bold text-foreground">{formRoundType}</span>
                  </div>
                  <div className="flex justify-between font-bold font-semibold">
                    <span className="text-gray-400">Total Questions:</span>
                    <span className="font-bold text-foreground">{formQuestions.length}</span>
                  </div>

                  {formRoundType !== 'HR' && (
                    <div className="border-t border-gray-100 pt-3 space-y-2">
                      <div className="flex justify-between items-baseline font-bold">
                        <span className="text-gray-400">Cumulative Weightage:</span>
                        <span className={`text-sm font-bold ${totalWeightageSum === 100 ? 'text-gray-800' : 'text-amber-500'}`}>
                          {totalWeightageSum} / 100%
                        </span>
                      </div>
                      
                      {/* Progress bar */}
                      <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${totalWeightageSum === 100 ? 'bg-info' : 'bg-warning'}`}
                          style={{ width: `${Math.min(totalWeightageSum, 100)}%` }}
                        />
                      </div>
                      
                      {totalWeightageSum !== 100 ? (
                        <div className="text-[10px] text-amber-500 font-semibold leading-snug flex items-start gap-1">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          Sum of weightages must equal exactly 100% before submission can proceed.
                        </div>
                      ) : (
                        <div className="text-[10px] text-foreground font-semibold flex items-center gap-1">
                          <CheckCircle className="w-3.5 h-3.5" /> Weightage criteria balanced.
                        </div>
                      )}
                    </div>
                  )}
                </div>
 
                <div className="flex items-center gap-2 pt-3 border-t border-gray-100">
                  <input
                    type="checkbox"
                    id="sim-fail"
                    checked={simulateCreateFailure}
                    onChange={(e) => setSimulateCreateFailure(e.target.checked)}
                    className="rounded border-gray-300 text-info focus:ring-ring"
                  />
                  <label htmlFor="sim-fail" className="text-[10px] font-semibold text-gray-400 cursor-pointer select-none">
                    Simulate API POST Failure
                  </label>
                </div>
 
                <div className="space-y-2">
                  <button
                    onClick={handleCreateAssessmentSubmit}
                    disabled={isSavingAssessment || (formRoundType !== 'HR' && totalWeightageSum !== 100)}
                    className={`w-full py-2.5 rounded text-xs font-semibold text-center text-white transition flex items-center justify-center gap-2 ${
                      isSavingAssessment
                        ? 'bg-gradient-primary opacity-70 cursor-wait'
                        : formRoundType === 'HR' || totalWeightageSum === 100
                          ? 'bg-gradient-primary hover:shadow-[var(--shadow-glow)] hover:-translate-y-0.5 cursor-pointer shadow-xs'
                          : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    }`}
                  >
                    {isSavingAssessment ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        {currentView === 'EDIT' ? 'Saving Changes...' : 'Creating Assessment...'}
                      </>
                    ) : (
                      currentView === 'EDIT' ? 'Save Changes' : 'Create Assessment Profile'
                    )}
                  </button>
                  <button
                    onClick={() => {
                      setCurrentView('LIST');
                      setEditingAssessmentId(null);
                      setFormJobId('JOB-' + generate32BitId());
                      setFormJobTitle('');
                      setFormJobDescription('');
                      setFormQuestions([{ id: 'q-1', text: '', type: 'SPEAK_TO_ANSWER', maxDuration: 120, maxScore: 50, weightage: 100 }]);
                      setFormStartDate('');
                      setFormEndDate('');
                    }}
                    className="w-full py-2 bg-card border border-border/70 hover:bg-muted/40 text-foreground rounded text-xs font-semibold text-center transition cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          VIEW 3: ASSESSMENT DETAIL VIEW (WITH CANDIDATE MANAGEMENT SECTORS)
          ========================================================================= */}
      {currentView === 'DETAIL' && activeAssessment && (
        <div className="space-y-6">
          {/* Header row */}
          <div className="flex items-center gap-3 text-foreground">
            <button
              onClick={() => setCurrentView('LIST')}
              className="p-1.5 rounded-md border border-border/70 bg-card hover:bg-muted/40 text-foreground transition cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
            </button>
            <div>
              <h2 className="text-lg font-bold text-foreground">
                {activeAssessment.jobTitle}
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">
                Assessment ID: <span className="font-mono font-bold text-gray-600">{activeAssessment.jobId}</span> • Profile Language: {activeAssessment.language}
              </p>
            </div>
          </div>

          {/* Expanded Assessment details */}
          <div className="border border-border/70 rounded-xl overflow-hidden bg-card">
            {/* 1. Assessment General Details Accordion */}
            <div className="border-b border-border/70">
              <button
                onClick={() => setExpandedDetails(!expandedDetails)}
                className="w-full flex items-center justify-between p-4 font-bold text-xs text-muted-foreground uppercase tracking-wider bg-muted/40/50"
              >
                <span>Assessment Profile Details</span>
                {expandedDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>

              {expandedDetails && (
                <div className="p-5 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 text-xs">
                  <div className="p-3 bg-muted/40/60 border border-border/70 rounded-lg space-y-1 shadow-2xs">
                    <span className="text-gray-400 font-bold block uppercase tracking-wider text-[9px]">Title of Assessment</span>
                    <span className="font-bold text-foreground text-xs truncate block" title={activeAssessment.jobTitle}>{activeAssessment.jobTitle}</span>
                  </div>
                  <div className="p-3 bg-muted/40/60 border border-border/70 rounded-lg space-y-1 shadow-2xs">
                    <span className="text-gray-400 font-bold block uppercase tracking-wider text-[9px]">Round Type</span>
                    <span className="font-bold text-foreground text-xs block">{activeAssessment.roundType}</span>
                  </div>
                  <div className="p-3 bg-muted/40/60 border border-border/70 rounded-lg space-y-1 shadow-2xs">
                    <span className="text-gray-400 font-bold block uppercase tracking-wider text-[9px]">Date of Creation</span>
                    <span className="font-bold text-foreground text-xs block">
                      {new Date(activeAssessment.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="p-3 bg-muted/40/60 border border-border/70 rounded-lg space-y-1 shadow-2xs">
                    <span className="text-gray-400 font-bold block uppercase tracking-wider text-[9px]">Number of Candidates</span>
                    <span className="font-bold text-foreground text-xs block">
                      {activeAssessmentCandidates.length} Registered
                    </span>
                  </div>
                  <div className="p-3 bg-muted/40/60 border border-border/70 rounded-lg space-y-1 shadow-2xs">
                    <span className="text-gray-400 font-bold block uppercase tracking-wider text-[9px]">Reports Generated</span>
                    <span className="font-bold text-emerald-700 text-xs block">
                      {activeAssessmentCandidates.filter(c => c.reportStatus === 'GENERATED').length} Generated
                    </span>
                  </div>
                  <div className="p-3 bg-muted/40/60 border border-border/70 rounded-lg space-y-1 shadow-2xs">
                    <span className="text-gray-400 font-bold block uppercase tracking-wider text-[9px]">Number of Questions</span>
                    <span className="font-bold text-foreground text-xs block">
                      {activeAssessment.questions.length} Questions
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* 2. Questions & Answer Key Accordion */}
            <div className="border-b border-border/70">
              <button
                onClick={() => setExpandedQuestions(!expandedQuestions)}
                className="w-full flex items-center justify-between p-4 font-bold text-xs text-muted-foreground uppercase tracking-wider bg-muted/40/50"
              >
                <span>Questions Formulation ({activeAssessment.questions.length})</span>
                {expandedQuestions ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>

              {expandedQuestions && (
                <div className="p-5 space-y-4">
                  {activeAssessment.questions.map((q, i) => (
                    <div key={q.id} className="p-4 rounded-lg border border-slate-150/80 space-y-2 bg-muted/40/25">
                      <div className="flex items-center justify-between text-[10px] font-mono font-semibold text-muted-foreground">
                        <span>QUESTION #{i+1} • {q.type}</span>
                        <span>Max Duration: {q.maxDuration}s {activeAssessment.roundType !== 'HR' && `• Max Score: ${q.maxScore} (Weightage: ${q.weightage}%)`}</span>
                      </div>
                      <p className="text-xs font-semibold text-foreground">{q.text}</p>
                      
                      {q.type === 'MCQ' && q.options && (
                        <div className="grid grid-cols-2 gap-2 mt-2">
                          {q.options.map(opt => (
                            <div key={opt} className={`p-2 rounded text-[11px] border ${opt === q.correctOption ? 'bg-emerald-50 border-emerald-300 text-emerald-800' : 'bg-card border-slate-100 text-muted-foreground'}`}>
                              {opt} {opt === q.correctOption && '✓ (Correct)'}
                            </div>
                          ))}
                        </div>
                      )}

                      {q.type === 'SPEAK_TO_ANSWER' && q.referenceAnswer && (
                        <div className="text-[10px] bg-card p-2.5 rounded border border-slate-100 text-muted-foreground mt-1">
                          <strong className="text-muted-foreground block">AI Baseline Expected Reference Answer:</strong>
                          {q.referenceAnswer}
                        </div>
                      )}

                      {q.type === 'SPEAK_TO_ANSWER' && q.criteria && (
                        <div className="text-[10px] bg-card p-2.5 rounded border border-slate-100 text-muted-foreground mt-1">
                          <strong className="text-muted-foreground block">Evaluation Criteria / Rubric:</strong>
                          {q.criteria}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Scoped Candidate Table Workspace */}
          <div className="space-y-4">
            {/* Cascading pipeline filters container */}
            <div className="bg-muted/40 border border-border/70/80 rounded-xl p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <SlidersHorizontal className="w-4 h-4 text-foreground" />
                  <span className="text-xs font-bold uppercase tracking-wider text-foreground">
                    Pipeline Filters
                  </span>
                  {filterRound !== 'ALL' && (
                    <span className="text-[10px] bg-sky-50 text-sky-700 px-2 py-0.5 rounded-full font-semibold border border-sky-100">
                      Active Filter Cascade
                    </span>
                  )}
                </div>
 
                {/* Reset button */}
                {(filterRound !== 'ALL' || filterLayer2 !== null || filterLayer3 !== null || filterLayer4 !== null || filterScoreValue !== null) && (
                  <button
                    onClick={handleResetAllFilters}
                    className="flex items-center gap-1 text-[11px] font-bold text-red-600 hover:text-red-700 hover:underline transition cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Reset Filters
                  </button>
                )}
              </div>
 
              {/* Responsive Cascading Select Bars */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
                {/* 1. Round Selection (L1) */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                    Assessment Round
                  </label>
                  <select
                    value={filterRound}
                    onChange={(e) => handleSetFilterRound(e.target.value as any)}
                    className="w-full text-xs rounded-lg border border-border/70 bg-card p-2.5 text-foreground focus:outline-hidden focus:ring-1 focus:ring-ring font-medium"
                  >
                    <option value="ALL">All Rounds (No Filter)</option>
                    <option value="TECHNICAL">TECHNICAL Round</option>
                    <option value="BASIC">BASIC Round</option>
                    <option value="HR">HR Round</option>
                  </select>
                </div>
 
                {/* 2. Evaluation Metric (L2) */}
                <div className={`space-y-1.5 transition-all duration-200 ${filterRound === 'ALL' ? 'opacity-40 pointer-events-none' : ''}`}>
                  <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                    Evaluation Metric
                  </label>
                  <select
                    disabled={filterRound === 'ALL'}
                    value={filterLayer2 || ''}
                    onChange={(e) => handleSetFilterLayer2(e.target.value || null)}
                    className="w-full text-xs rounded-lg border border-border/70 bg-card p-2.5 text-foreground focus:outline-hidden focus:ring-1 focus:ring-ring font-medium"
                  >
                    <option value="">-- All Metrics (No Filter) --</option>
                    {filterRound !== 'ALL' && LAYER2_OPTIONS[filterRound]?.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>
 
                {/* 3. Sub-Metric (L3) */}
                <div className={`space-y-1.5 transition-all duration-200 ${!shouldShowLayer3 ? 'opacity-40 pointer-events-none' : ''}`}>
                  <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                    Sub-Metric / Dimension
                  </label>
                  <select
                    disabled={!shouldShowLayer3}
                    value={filterLayer3 || ''}
                    onChange={(e) => handleSetFilterLayer3(e.target.value || null)}
                    className="w-full text-xs rounded-lg border border-border/70 bg-card p-2.5 text-foreground focus:outline-hidden focus:ring-1 focus:ring-ring font-medium"
                  >
                    <option value="">-- All Dimensions --</option>
                    {shouldShowLayer3 && layer3Options.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>
 
                {/* 4. Competency / Personality (L4) */}
                <div className={`space-y-1.5 transition-all duration-200 ${!shouldShowLayer4 ? 'opacity-40 pointer-events-none' : ''}`}>
                  <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                    Specific Trait / Aspect
                  </label>
                  <select
                    disabled={!shouldShowLayer4}
                    value={filterLayer4 || ''}
                    onChange={(e) => handleSetFilterLayer4(e.target.value || null)}
                    className="w-full text-xs rounded-lg border border-border/70 bg-card p-2.5 text-foreground focus:outline-hidden focus:ring-1 focus:ring-ring font-medium"
                  >
                    <option value="">-- All Aspects --</option>
                    {shouldShowLayer4 && layer4Options.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>
 
                {/* 5. Score Filter (L5) */}
                <div className={`space-y-1.5 transition-all duration-200 ${!activeScale ? 'opacity-40 pointer-events-none' : ''}`}>
                  <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                    Mathematical Score Check
                    {activeScale && (
                      <span className="font-mono text-[8px] bg-muted px-1 rounded">
                        {activeScale === 'scale5' ? '1-5 Scale' : '0-100 Scale'}
                      </span>
                    )}
                  </label>
                  <select
                    disabled={!activeScale}
                    value={filterScoreValue || ''}
                    onChange={(e) => handleSetFilterScoreValue(e.target.value || null)}
                    className="w-full text-xs rounded-lg border border-border/70 bg-card p-2.5 text-foreground focus:outline-hidden focus:ring-1 focus:ring-ring font-medium"
                  >
                    <option value="">-- All Scores (No Filter) --</option>
                    {activeScale === 'scale5' && (
                      <>
                        <option value="A+">Grade A+: Outstanding (90 - 100)</option>
                        <option value="A">Grade A: Elite Performance (80 - 100)</option>
                        <option value="B+">Grade B+: Strong (70 - 89)</option>
                        <option value="B">Grade B: Accomplished (60 - 79)</option>
                        <option value="C+">Grade C+: Above Average (50 - 59)</option>
                        <option value="C">Grade C: Competent (40 - 59, incl. C+)</option>
                        <option value="D">Grade D: Emerging (30 - 39)</option>
                        <option value="E">Grade E: Developing (20 - 29)</option>
                        <option value="F">Grade F: Fail (0 - 19)</option>
                      </>
                    )}
                    {activeScale === 'scale3' && (
                      <>
                        <option value="60 - 100">Strong / Low Risk (61 - 100)</option>
                        <option value="30 - 60">Moderate (31 - 60)</option>
                        <option value="0 - 30">Needs Focus / High Risk (0 - 30)</option>
                      </>
                    )}
                  </select>
                </div>
              </div>
 
              {/* Informational Guidance bar */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 pt-1.5 border-t border-border/70/60 text-[11px] text-muted-foreground font-medium">
                <div className="flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                  <span>
                    Current Assessment Type: <strong className="text-foreground uppercase">{activeAssessment.roundType}</strong>.
                    {filterRound !== 'ALL' && filterRound !== activeAssessment.roundType && (
                      <span className="text-amber-600 font-semibold ml-1">
                        ⚠️ Note: Filtering for "{filterRound}" on a "{activeAssessment.roundType}" profile will return 0 rows.
                      </span>
                    )}
                  </span>
                </div>
                <div>
                  Showing <strong className="text-foreground">{filteredCandidates.length}</strong> of <strong className="text-foreground">{activeAssessmentCandidates.length}</strong> assigned candidates.
                </div>
              </div>
            </div>

            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
                  Assigned Candidates & Access Control
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Links are never generated automatically — click Generate Link to activate.
                </p>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setCurrentView('UPLOAD')}
                  className="flex items-center gap-1.5 bg-muted/40 hover:bg-muted border border-border/70 text-foreground text-xs font-semibold px-3 py-2 rounded-lg transition"
                >
                  <UserPlus className="w-4 h-4 text-blue-500" /> Create Assignment (CSV Upload)
                </button>
              </div>
            </div>

            {/* Permanent Assignment Controls & Bulk Actions — Light Glass Panel */}
            <div
              className="relative overflow-hidden rounded-2xl p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4"
              style={{
                background: 'linear-gradient(135deg, rgba(255,255,255,0.95) 0%, rgba(240,242,255,0.9) 100%)',
                backdropFilter: 'blur(16px)',
                border: '1px solid rgba(2,132,199,0.15)',
                boxShadow: '0 4px 20px rgba(2,132,199,0.08)',
              }}
            >
              <div className="space-y-1">
                <div className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-2" style={{ color: '#0284c7' }}>
                  <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#0284c7' }}></span>
                  Mail &amp; Assessment Actions
                </div>
                <div className="text-xs font-medium" style={{ color: '#64748b' }}>
                  {selectedCandidateIds.length > 0 ? (
                    <span className="font-bold" style={{ color: '#0369a1' }}>{selectedCandidateIds.length} candidate(s) selected</span>
                  ) : (
                    <span>Tick the row checkboxes below to activate bulk actions.</span>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {/* Select All / Deselect All toggle */}
                <button
                  onClick={() => {
                    if (filteredCandidates.length === 0) {
                      toast.error('No students in this view to select.');
                      return;
                    }
                    if (selectedCandidateIds.length === filteredCandidates.length && filteredCandidates.length > 0) {
                      setSelectedCandidateIds([]);
                      toast.success('Cleared all selected students.');
                    } else {
                      setSelectedCandidateIds(filteredCandidates.map(c => c.id));
                      toast.success(`Selected all ${filteredCandidates.length} students.`);
                    }
                  }}
                  disabled={filteredCandidates.length === 0}
                  className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg border transition cursor-pointer disabled:opacity-50"
                  style={{ background: 'rgba(2,132,199,0.06)', border: '1px solid rgba(2,132,199,0.2)', color: '#0369a1' }}
                  title="Select or clear all students registered under this profile"
                >
                  <Check className="w-3.5 h-3.5" />
                  {selectedCandidateIds.length === filteredCandidates.length && filteredCandidates.length > 0 ? 'Deselect All' : 'Select All'}
                </button>

                {/* Deactivate Students */}
                <button
                  onClick={() => {
                    if (selectedCandidateIds.length === 0) { toast.error('Please select at least one student first.'); return; }
                    onSetCandidates(prev => prev.map(c => selectedCandidateIds.includes(c.id) ? { ...c, status: 'INACTIVE', candidateStatus: 'INACTIVE' } : c));
                    toast.success(`Successfully deactivated ${selectedCandidateIds.length} selected student(s).`);
                    void pushStatusToServer(selectedCandidateIds, 'INACTIVE');
                    setSelectedCandidateIds([]);
                  }}
                  disabled={selectedCandidateIds.length === 0}
                  className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg border transition cursor-pointer"
                  style={selectedCandidateIds.length > 0 ? {
                    background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', color: '#b45309', cursor: 'pointer'
                  } : {
                    background: 'rgba(100,116,139,0.06)', border: '1px solid rgba(100,116,139,0.15)', color: '#94a3b8', cursor: 'not-allowed', opacity: 0.5
                  }}
                  title="Deactivate all currently selected students"
                >
                  <X className="w-3.5 h-3.5" /> Deactivate
                </button>

                {/* Activate Students */}
                <button
                  onClick={() => {
                    if (selectedCandidateIds.length === 0) { toast.error('Please select at least one student first.'); return; }
                    onSetCandidates(prev => prev.map(c => selectedCandidateIds.includes(c.id) ? { ...c, status: 'ACTIVE', candidateStatus: 'ACTIVE' } : c));
                    toast.success(`Successfully activated ${selectedCandidateIds.length} selected student(s).`);
                    void pushStatusToServer(selectedCandidateIds, 'ACTIVE');
                    setSelectedCandidateIds([]);
                  }}
                  disabled={selectedCandidateIds.length === 0}
                  className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg border transition cursor-pointer"
                  style={selectedCandidateIds.length > 0 ? {
                    background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', color: '#059669', cursor: 'pointer'
                  } : {
                    background: 'rgba(100,116,139,0.06)', border: '1px solid rgba(100,116,139,0.15)', color: '#94a3b8', cursor: 'not-allowed', opacity: 0.5
                  }}
                  title="Activate all currently selected students"
                >
                  <Check className="w-3.5 h-3.5" /> Activate
                </button>

                {/* Clear Selection */}
                {selectedCandidateIds.length > 0 && (
                  <button
                    onClick={() => { setSelectedCandidateIds([]); toast.success('Cleared selection.'); }}
                    className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg border transition cursor-pointer"
                    style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', color: '#dc2626' }}
                    title="Clear current candidate selections"
                  >
                    Clear Selection
                  </button>
                )}

                {/* Separator */}
                <div className="w-px mx-0.5 self-stretch" style={{ background: 'rgba(2,132,199,0.15)' }} />

                {/* Generate Link */}
                <button
                  onClick={handleBulkGenerateLinks}
                  disabled={selectedCandidateIds.length === 0}
                  className={`flex items-center gap-1.5 text-xs font-bold px-3.5 py-1.5 rounded-lg border transition cursor-pointer text-white ${
                    selectedCandidateIds.length > 0
                      ? 'bg-gradient-primary hover:shadow-[var(--shadow-glow)] hover:-translate-y-0.5 border-transparent shadow-xs'
                      : 'bg-muted text-muted-foreground border-border/70 cursor-not-allowed opacity-50'
                  }`}
                  title={selectedCandidateIds.length === 0 ? 'Disabled: Select candidates first.' : 'Generate unique evaluation links for selected candidates'}
                >
                  <Sparkles className="w-3.5 h-3.5" /> Generate Link
                </button>

                {/* Bulk Send Invite */}
                {(() => {
                  const selectedCands = filteredCandidates.filter(c => selectedCandidateIds.includes(c.id));
                  const selectedWithLinks = selectedCands.filter(c => c.link !== null && c.link !== '' && c.status === 'ACTIVE' && !c.submittedDate);
                  const isSendEnabled = selectedCandidateIds.length > 0 && selectedWithLinks.length > 0;
                  return (
                    <button
                      onClick={handleBulkSendInvites}
                      disabled={!isSendEnabled}
                      className="flex items-center gap-1.5 text-xs font-bold px-3.5 py-1.5 rounded-lg border transition cursor-pointer"
                      style={isSendEnabled ? {
                        background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', color: '#059669',
                        boxShadow: '0 2px 6px rgba(16,185,129,0.15)',
                      } : {
                        background: 'rgba(100,116,139,0.06)', border: '1px solid rgba(100,116,139,0.15)', color: '#94a3b8', cursor: 'not-allowed', opacity: 0.5,
                      }}
                      title={!isSendEnabled ? 'Disabled: Select candidates with generated links.' : `Send invitations to ${selectedWithLinks.length} candidate(s)`}
                    >
                      <Send className="w-3.5 h-3.5" /> Bulk Send Invite
                    </button>
                  );
                })()}

                {/* Bulk Send Reminder */}
                {(() => {
                  const selectedCands = filteredCandidates.filter(c => selectedCandidateIds.includes(c.id));
                  const selectedWithInvites = selectedCands.filter(c =>
                    (c.inviteSent || !!c.lastInviteSentAt) && !c.submittedDate && c.status === 'ACTIVE' && !(new Date() > new Date(c.endTime) || c.interviewExpired)
                  );
                  const isReminderEnabled = selectedCandidateIds.length > 0 && selectedWithInvites.length > 0;
                  return (
                    <button
                      onClick={handleBulkSendReminders}
                      disabled={!isReminderEnabled}
                      className="flex items-center gap-1.5 text-xs font-bold px-3.5 py-1.5 rounded-lg border transition cursor-pointer"
                      style={isReminderEnabled ? {
                        background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.3)', color: '#7c3aed',
                        boxShadow: '0 2px 6px rgba(139,92,246,0.15)',
                      } : {
                        background: 'rgba(100,116,139,0.06)', border: '1px solid rgba(100,116,139,0.15)', color: '#94a3b8', cursor: 'not-allowed', opacity: 0.5,
                      }}
                      title={!isReminderEnabled ? 'Disabled: Candidates must have invites and be active.' : `Send reminders to ${selectedWithInvites.length} candidate(s)`}
                    >
                      <Bell className="w-3.5 h-3.5" /> Bulk Send Reminder
                    </button>
                  );
                })()}

                {/* Delete Selected */}
                <button
                  onClick={handleBulkDeleteCandidates}
                  disabled={selectedCandidateIds.length === 0}
                  className="flex items-center gap-1.5 text-xs font-bold px-3.5 py-1.5 rounded-lg border transition cursor-pointer"
                  style={selectedCandidateIds.length > 0 ? {
                    background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#dc2626',
                  } : {
                    background: 'rgba(100,116,139,0.06)', border: '1px solid rgba(100,116,139,0.15)', color: '#94a3b8', cursor: 'not-allowed', opacity: 0.5,
                  }}
                  title={selectedCandidateIds.length === 0 ? 'Select candidates to delete.' : 'Remove all selected candidates'}
                >
                  <Trash className="w-3.5 h-3.5" /> Delete Selected
                </button>
              </div>
            </div>

            {/* Candidate Table Grid */}
            <div className={`overflow-x-auto bg-card border border-border/70 rounded-xl shadow-2xs transition-all duration-200 ${openMenuCandId ? 'pb-40' : ''}`}>
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40 border-b border-border/70">
                    <TableHead className="w-[45px] text-center px-3 py-3">
                      <input
                        type="checkbox"
                        checked={selectedCandidateIds.length === filteredCandidates.length && filteredCandidates.length > 0}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedCandidateIds(filteredCandidates.map(c => c.id));
                          } else {
                            setSelectedCandidateIds([]);
                          }
                        }}
                        className="rounded border-border text-foreground focus:ring-slate-900 cursor-pointer"
                        title="Select All option"
                      />
                    </TableHead>
                    <TableHead className="font-bold text-foreground text-[10px] uppercase tracking-wider px-3 py-3 w-[100px]">Candidate ID</TableHead>
                    <TableHead className="font-bold text-foreground text-[10px] uppercase tracking-wider px-3 py-3">Candidate Info</TableHead>
                    <TableHead className="font-bold text-foreground text-[10px] uppercase tracking-wider px-3 py-3 text-center w-[90px]">Status</TableHead>
                    <TableHead className="font-bold text-foreground text-[10px] uppercase tracking-wider px-3 py-3 min-w-[180px]">Credentials & Links</TableHead>
                    <TableHead className="font-bold text-foreground text-[10px] uppercase tracking-wider px-3 py-3 text-center">Mailing Controls</TableHead>
                    <TableHead className="font-bold text-foreground text-[10px] uppercase tracking-wider px-3 py-3 text-center">Simulation Sandbox</TableHead>
                    <TableHead className="font-bold text-foreground text-[10px] uppercase tracking-wider px-3 py-3 text-center">Mail Status</TableHead>
                    <TableHead className="font-bold text-foreground text-[10px] uppercase tracking-wider px-3 py-3">Mailing Stats & Timestamps</TableHead>
                    <TableHead className="font-bold text-foreground text-[10px] uppercase tracking-wider px-3 py-3 text-center">AI Scorecard</TableHead>
                    <TableHead className="font-bold text-foreground text-[10px] uppercase tracking-wider px-3 py-3 text-center">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCandidates.map((c, idx) => {
                    const hasLink = c.link !== null && c.link !== '';
                    const isCompleted = !!c.submittedDate;
                    const isActive = c.status === 'ACTIVE';
                    const isExpired = new Date() > new Date(c.endTime) || c.interviewExpired;
                    const isLast = idx >= Math.max(0, filteredCandidates.length - 2);
                    const hasInvite = c.inviteSent || !!c.lastInviteSentAt;

                    // Compute individual button states based on strict business rules
                    const inviteEnabled = hasLink && isActive && !isCompleted && !isExpired;
                    const reminderEnabled = hasInvite && !isCompleted && isActive && !isExpired;

                    const isReportReady = c.reportStatus === 'GENERATED';

                    // Mail Status display parameters
                    const mailStatusValue = c.rowLoading 
                      ? 'Sending' 
                      : (c.mailStatus || (hasInvite ? (c.reminderCount ? 'Reminder Sent' : 'Invite Sent') : 'Not Sent'));

                    return (
                      <TableRow key={c.id} className={`hover:bg-muted/40/40 border-b border-slate-100 ${!isActive ? 'opacity-70 bg-muted/40/20' : ''}`}>
                        {/* 0. Row Selector */}
                        <TableCell className="text-center px-3 py-3.5">
                          <input
                            type="checkbox"
                            checked={selectedCandidateIds.includes(c.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedCandidateIds(prev => [...prev, c.id]);
                              } else {
                                setSelectedCandidateIds(prev => prev.filter(id => id !== c.id));
                              }
                            }}
                            className="rounded border-border text-foreground focus:ring-slate-900 cursor-pointer"
                          />
                        </TableCell>

                        {/* 1. Candidate ID */}
                        <TableCell className="px-3 py-3.5">
                          <span className="font-mono text-[10px] font-bold bg-muted border border-border/70 text-foreground rounded px-1.5 py-0.5">
                            #{c.id}
                          </span>
                        </TableCell>

                        {/* 2. Candidate Info + Interview Window */}
                        <TableCell className="px-3 py-3.5">
                          <div className="font-bold text-foreground text-xs">{c.name}</div>
                          <div className="text-[10px] text-muted-foreground font-mono mt-0.5">{c.email}</div>
                          {c.phone && <div className="text-[10px] text-muted-foreground font-mono">{c.phone}</div>}
                          {/* Interview Window display */}
                          {(() => {
                            const s = parseServerDate(c.startTime);
                            const e = parseServerDate(c.endTime);
                            if (!s || !e) return null;
                            const nowMs = Date.now();
                            const startPast = s.getTime() < nowMs;
                            const endPast = e.getTime() < nowMs;
                            return (
                              <div className={`mt-1.5 text-[10px] font-semibold flex items-start gap-1 rounded px-1.5 py-1 border ${
                                startPast
                                  ? 'bg-amber-50 border-amber-200 text-amber-700'
                                  : 'bg-sky-50 border-sky-200 text-sky-700'
                              }`}>
                                <Clock className="w-3 h-3 mt-0.5 shrink-0" />
                                <div>
                                  <div className="text-[9px] font-bold uppercase tracking-wider opacity-70">Interview Window</div>
                                  <div className="font-mono text-[10px]">
                                    {formatInterviewWindow(s, e)}
                                  </div>
                                  {startPast && !endPast && (
                                    <div className="text-[9px] text-amber-600 font-bold mt-0.5 flex items-center gap-0.5">
                                      <AlertTriangle className="w-2.5 h-2.5" /> Start time has passed — reschedule required
                                    </div>
                                  )}
                                  {endPast && (
                                    <div className="text-[9px] text-red-600 font-bold mt-0.5 flex items-center gap-0.5">
                                      <AlertTriangle className="w-2.5 h-2.5" /> Window expired
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })()}
                        </TableCell>

                        {/* 3. Candidate Status (Static Status Badge) */}
                        <TableCell className="text-center px-3 py-3.5">
                          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                            isActive 
                              ? 'bg-emerald-50 border-emerald-100 text-emerald-700' 
                              : 'bg-red-50 border-red-100 text-red-700'
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-success' : 'bg-destructive animate-pulse'}`}></span>
                            {isActive ? 'Active' : 'Inactive'}
                          </span>
                        </TableCell>

                        {/* 4. Credentials & Link */}
                        <TableCell className="px-3 py-3.5">
                          {hasLink ? (
                            <div className="space-y-1">
                              <div className="flex items-center gap-1.5 max-w-[200px]">
                                <span className="text-[10px] text-muted-foreground bg-muted/40 border border-border/70 px-1.5 py-0.5 rounded truncate font-mono select-all" title={c.link || ''}>
                                  {c.link}
                                </span>
                                <button
                                  onClick={() => {
                                    navigator.clipboard.writeText(c.link || '');
                                    toast.success('Link copied to clipboard.');
                                  }}
                                  className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer shrink-0"
                                  title="Copy Link"
                                >
                                  <Copy className="w-3 h-3" />
                                </button>
                              </div>
                              {c.password && (
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[10px] text-muted-foreground font-semibold uppercase">Pwd:</span>
                                  <span className="text-[10px] font-mono text-muted-foreground bg-muted/40 px-1 py-0.2 rounded border border-slate-150">
                                    {c.password}
                                  </span>
                                  <button
                                    onClick={() => {
                                      navigator.clipboard.writeText(c.password || '');
                                      toast.success('Password copied.');
                                    }}
                                    className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer shrink-0"
                                    title="Copy Password"
                                  >
                                    <Copy className="w-2.5 h-2.5" />
                                  </button>
                                </div>
                              )}
                              <div className="pt-0.5">
                                <button
                                  disabled={!isActive}
                                  onClick={() => handleRegenerateCandidateLink(c.id)}
                                  className={`text-[9px] font-bold px-1.5 py-0.5 rounded transition border ${
                                    isActive
                                      ? 'text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border-indigo-200 cursor-pointer'
                                      : 'text-muted-foreground bg-muted/40 border-border/70 cursor-not-allowed opacity-60'
                                  }`}
                                  title={isActive ? "Previous link will be invalidated and fresh credentials issued." : "Disabled: Candidate must be Active to regenerate link."}
                                >
                                  Regenerate Link
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              disabled={!isActive}
                              onClick={() => handleGenerateCandidateLink(c.id)}
                              className={`flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded transition shadow-2xs ${
                                isActive
                                  ? 'bg-slate-900 hover:bg-slate-800 text-white cursor-pointer'
                                  : 'bg-muted text-muted-foreground border border-border/70 cursor-not-allowed opacity-60'
                              }`}
                              title={isActive ? "Links are never generated automatically — click to generate unique credentials" : "Disabled: Candidate must be Active to generate evaluation link."}
                            >
                              <Sparkles className={`w-2.5 h-2.5 ${isActive ? 'text-amber-300' : 'text-muted-foreground'}`} />
                              Generate Link
                            </button>
                          )}
                        </TableCell>

                        {/* 5. Mailing Controls — Light buttons */}
                        <TableCell className="px-3 py-3.5 text-center">
                          {c.rowLoading ? (
                            <div className="flex flex-col items-center justify-center gap-1">
                              <Loader2 className="w-4 h-4 animate-spin" style={{ color: '#6366f1' }} />
                              <span className="text-[9px] font-bold" style={{ color: '#6366f1' }}>Sending...</span>
                            </div>
                          ) : (
                            <div className="flex flex-col gap-1.5 max-w-[120px] mx-auto">
                              {/* Send Invite */}
                              <button
                                onClick={() => openInviteDialog([c.id])}
                                disabled={!inviteEnabled}
                                className="text-[10px] font-bold px-2 py-1.5 rounded-lg border inline-flex items-center justify-center gap-1 transition cursor-pointer"
                                style={inviteEnabled ? {
                                  background: 'rgba(16,185,129,0.08)',
                                  border: '1px solid rgba(16,185,129,0.25)',
                                  color: '#059669',
                                } : {
                                  background: 'rgba(100,116,139,0.05)',
                                  border: '1px solid rgba(100,116,139,0.12)',
                                  color: '#cbd5e1',
                                  cursor: 'not-allowed',
                                }}
                                title={
                                  !hasLink ? 'Invite disabled: credentials link must be generated first.'
                                    : !isActive ? 'Invite disabled: candidate is inactive.'
                                    : isCompleted ? 'Invite disabled: candidate completed assessment.'
                                    : 'Transmit or resend assessment invitation'
                                }
                              >
                                <Send className="w-2.5 h-2.5" />
                                {hasInvite ? 'Resend Invite' : 'Send Invite'}
                              </button>

                              {/* Send Reminder */}
                              <button
                                onClick={() => handleSendReminder(c.id)}
                                disabled={!reminderEnabled}
                                className="text-[10px] font-bold px-2 py-1.5 rounded-lg border inline-flex items-center justify-center gap-1 transition cursor-pointer"
                                style={reminderEnabled ? {
                                  background: 'rgba(139,92,246,0.08)',
                                  border: '1px solid rgba(139,92,246,0.25)',
                                  color: '#7c3aed',
                                } : {
                                  background: 'rgba(100,116,139,0.05)',
                                  border: '1px solid rgba(100,116,139,0.12)',
                                  color: '#cbd5e1',
                                  cursor: 'not-allowed',
                                }}
                                title={
                                  !hasInvite ? 'Reminder disabled: invitation must be sent first.'
                                    : isCompleted ? 'Reminder disabled: candidate completed assessment.'
                                    : !isActive ? 'Reminder disabled: candidate is inactive.'
                                    : isExpired ? 'Reminder disabled: interview schedule has expired.'
                                    : 'Transmit reminder to outstanding candidate'
                                }
                              >
                                <Bell className="w-2.5 h-2.5" />
                                {c.reminderCount ? `Remind (${c.reminderCount})` : 'Send Reminder'}
                              </button>
                            </div>
                          )}
                        </TableCell>

                        {/* 6. Simulation Sandbox (Helps Admin test active/completed/expired rules dynamically) */}
                        <TableCell className="px-3 py-3.5 text-center">
                          <div className="flex flex-col gap-1.5 max-w-[120px] mx-auto">
                            {/* Simulate Completion Action */}
                            <button
                              onClick={() => handleSimulateCompletion(c.id)}
                              disabled={isCompleted}
                              className={`text-[9px] font-bold px-2 py-1 rounded border transition select-none ${
                                isCompleted
                                  ? 'bg-slate-150 border-border/70 text-muted-foreground cursor-not-allowed'
                                  : 'bg-indigo-50 hover:bg-indigo-100 border-indigo-200 text-indigo-700 cursor-pointer'
                              }`}
                              title={isCompleted ? 'Assessment completed' : 'Simulate candidate completing assessment instantly'}
                            >
                              {isCompleted ? '✓ Completed' : '⚡ Simulate Submit'}
                            </button>

                            {/* Toggle Expiry Action */}
                            <button
                              onClick={() => handleToggleExpiry(c.id)}
                              className={`text-[9px] font-bold px-2 py-1 rounded border transition cursor-pointer select-none ${
                                isExpired
                                  ? 'bg-amber-100 border-amber-300 text-amber-800 hover:bg-amber-150'
                                  : 'bg-muted border-border/70 text-muted-foreground hover:bg-muted'
                              }`}
                              title="Toggle expired status to test reminder disable rules"
                            >
                              {isExpired ? 'Un-expire' : 'Expire'}
                            </button>
                          </div>
                        </TableCell>

                        {/* 7. Mail Status Badge — Light pills */}
                        <TableCell className="text-center px-3 py-3.5">
                          {(() => {
                            switch (mailStatusValue) {
                              case 'Sending':
                                return (
                                  <span className="text-[10px] font-bold px-2.5 py-1 rounded-full inline-flex items-center gap-1 animate-pulse bg-indigo-50 border border-indigo-200 text-indigo-600">
                                    <Loader2 className="w-3 h-3 animate-spin" /> Sending
                                  </span>
                                );
                              case 'Invite Sent':
                                return (
                                  <span className="text-[10px] font-bold px-2.5 py-1 rounded-full inline-flex items-center gap-1 bg-emerald-50 border border-emerald-200 text-emerald-700">
                                    <MailCheck className="w-3 h-3" /> Invited
                                  </span>
                                );
                              case 'Reminder Sent':
                                return (
                                  <span className="text-[10px] font-bold px-2.5 py-1 rounded-full inline-flex items-center gap-1 bg-violet-50 border border-violet-200 text-violet-700">
                                    <Bell className="w-3 h-3" /> Reminded ({c.reminderCount || 1})
                                  </span>
                                );
                              case 'Failed':
                                return (
                                  <span className="text-[10px] font-bold px-2.5 py-1 rounded-full inline-flex items-center gap-1 bg-red-50 border border-red-200 text-red-600">
                                    <MailQuestion className="w-3 h-3" /> Failed
                                  </span>
                                );
                              default:
                                return (
                                  <span className="text-[10px] font-bold px-2.5 py-1 rounded-full inline-flex items-center gap-1 bg-muted/40 border border-border/70 text-muted-foreground">
                                    Not Sent
                                  </span>
                                );
                            }
                          })()}
                        </TableCell>

                        {/* 8. Mailing Stats & Timestamps */}
                        <TableCell className="px-3 py-3.5 text-xs">
                          <div
                            className="space-y-1.5 font-sans p-2 rounded-lg"
                            style={{ background: 'rgba(99,102,241,0.03)', border: '1px solid rgba(99,102,241,0.1)' }}
                          >
                            <div className="flex items-center gap-1 text-[10px]">
                              <span className="text-muted-foreground font-semibold">Schedule:</span>
                              <span className={`font-bold ${isExpired ? 'text-amber-600' : 'text-emerald-600'}`}>
                                {isExpired ? 'Expired' : 'Active'}
                              </span>
                            </div>
                            {c.inviteSentAt && (
                              <div className="text-[9px] leading-tight">
                                <span className="text-muted-foreground block">Invited At:</span>
                                <span className="text-muted-foreground">{new Date(c.inviteSentAt).toLocaleString()}</span>
                              </div>
                            )}
                            {c.lastReminderSentAt && (
                              <div className="text-[9px] leading-tight">
                                <span className="text-muted-foreground block">Last Remind:</span>
                                <span className="text-muted-foreground">{new Date(c.lastReminderSentAt).toLocaleString()}</span>
                              </div>
                            )}
                            <div className="text-[9px] text-muted-foreground font-mono">
                              Ends: {new Date(c.endTime).toLocaleDateString()}
                            </div>
                          </div>
                        </TableCell>

                        {/* 9. AI Scorecard */}
                        <TableCell className="text-center px-3 py-3.5">
                          <div className="flex items-center justify-center gap-1.5">
                            {c.linkGenerated && c.interviewId && (
                              <button
                                onClick={() => handleCheckCandidateStatus(c.id)}
                                disabled={syncingCandidateId === c.id}
                                className="p-1.5 rounded border border-border/70 text-foreground hover:bg-muted/40 transition cursor-pointer"
                                title="Check status from PrimeHire API"
                              >
                                <RefreshCw className={`w-3.5 h-3.5 ${syncingCandidateId === c.id ? 'animate-spin' : ''}`} />
                              </button>
                            )}
                            <button
                              onClick={() => onOpenReport(c, activeAssessment)}
                              disabled={!isReportReady}
                              className={`text-[10px] font-bold px-2.5 py-1 rounded transition ${
                                isReportReady
                                  ? 'bg-card hover:bg-muted/40 border border-border/70 text-foreground hover:text-slate-950 cursor-pointer shadow-2xs'
                                  : 'bg-muted/40 border border-border/70 text-slate-300 cursor-not-allowed opacity-50'
                              }`}
                              title={isReportReady ? 'View candidate AI scorecard' : 'Report is not available yet'}
                            >
                              View Report
                            </button>
                          </div>
                        </TableCell>

                        {/* 10. Actions (Three-dots dropdown menu or Confirmation states) */}
                        <TableCell className="text-center px-3 py-3.5 relative">
                          {deleteConfirmCandId === c.id ? (
                            <div className="flex items-center justify-center gap-1.5 min-w-[140px] mx-auto">
                              {doubleConfirmCandId === c.id ? (
                                <button
                                  onClick={() => {
                                    handleFinalDeleteCandidate(c.id);
                                    setDeleteConfirmCandId(null);
                                    setDoubleConfirmCandId(null);
                                  }}
                                  className="bg-red-600 hover:bg-red-700 text-white text-[9px] font-bold px-2 py-1 rounded transition animate-pulse cursor-pointer shadow-3xs"
                                  title="Final delete"
                                >
                                  Confirm Delete
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleDoubleConfirmDeleteCandidate(c.id)}
                                  className="bg-amber-500 hover:bg-amber-600 text-white text-[9px] font-bold px-2 py-1 rounded transition cursor-pointer shadow-3xs"
                                  title="Click again to confirm"
                                >
                                  Sure?
                                </button>
                              )}
                              <button
                                onClick={() => {
                                  setDeleteConfirmCandId(null);
                                  setDoubleConfirmCandId(null);
                                }}
                                className="px-2 py-1 border border-border/70 bg-card hover:bg-muted/40 text-muted-foreground hover:text-foreground rounded transition cursor-pointer text-[9px] font-bold"
                                title="Cancel Delete"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <div className="inline-block text-left" ref={openMenuCandId === c.id ? menuContainerRef : undefined}>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOpenMenuCandId(openMenuCandId === c.id ? null : c.id);
                                }}
                                className="p-1.5 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground transition cursor-pointer"
                                title="More Actions"
                              >
                                <MoreVertical className="w-4 h-4" />
                              </button>

                              {openMenuCandId === c.id && (
                                  <div className={cn("absolute right-0 w-44 bg-card border border-border/70 rounded-lg shadow-lg py-1.5 z-40 text-left font-sans max-h-64 overflow-y-auto", isLast ? "bottom-full mb-1" : "top-full mt-1")}>
                                    {/* Option: Activate */}
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setOpenMenuCandId(null);
                                        onSetCandidates(prev => prev.map(cand => cand.id === c.id ? { ...cand, status: 'ACTIVE', candidateStatus: 'ACTIVE' } : cand));
                                        toast.success(`Candidate ${c.name} is now Activated`);
                                        void pushStatusToServer([c.id], 'ACTIVE');
                                      }}
                                      disabled={isActive}
                                      className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold transition ${
                                        isActive 
                                          ? 'text-slate-300 bg-muted/40 cursor-not-allowed' 
                                          : 'text-foreground hover:bg-emerald-50 hover:text-emerald-700 cursor-pointer'
                                      }`}
                                    >
                                      <Check className="w-3.5 h-3.5 text-emerald-500" />
                                      Activate
                                    </button>

                                    {/* Option: Deactivate */}
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setOpenMenuCandId(null);
                                        onSetCandidates(prev => prev.map(cand => cand.id === c.id ? { ...cand, status: 'INACTIVE', candidateStatus: 'INACTIVE' } : cand));
                                        toast.success(`Candidate ${c.name} is now Deactivated`);
                                        void pushStatusToServer([c.id], 'INACTIVE');
                                      }}
                                      disabled={!isActive}
                                      className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold transition ${
                                        !isActive 
                                          ? 'text-slate-300 bg-muted/40 cursor-not-allowed' 
                                          : 'text-foreground hover:bg-amber-50 hover:text-amber-700 cursor-pointer'
                                      }`}
                                    >
                                      <X className="w-3.5 h-3.5 text-amber-500" />
                                      Deactivate
                                    </button>

                                    <div className="border-t border-slate-100 my-1"></div>

                                    {/* Option: Delete */}
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setOpenMenuCandId(null);
                                        handleTriggerDeleteCandidate(c.id);
                                      }}
                                      className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 transition cursor-pointer"
                                    >
                                      <Trash2 className="w-3.5 h-3.5 text-destructive" />
                                      Delete
                                    </button>

                                    <div className="border-t border-slate-100 my-1 font-sans"></div>

                                    {/* Option: Update Password */}
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setOpenMenuCandId(null);
                                        setPasswordEditCandId(c.id);
                                        setNewCandPassword(c.password || '');
                                      }}
                                      className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted/40 transition cursor-pointer"
                                    >
                                      <Lock className="w-3.5 h-3.5 text-muted-foreground" />
                                      Update Password
                                    </button>

                                    {/* Option: Reschedule */}
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setOpenMenuCandId(null);
                                        handleOpenRescheduleModal(c.id);
                                      }}
                                      disabled={!isActive}
                                      title={
                                        !isActive
                                          ? 'Disabled: Candidate must be Active to reschedule.'
                                          : 'Reschedule interview to a new time window'
                                      }
                                      className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold transition ${
                                        !isActive
                                          ? 'text-slate-300 bg-muted/40 cursor-not-allowed'
                                          : 'text-foreground hover:bg-muted/40 cursor-pointer'
                                      }`}
                                    >
                                      <Calendar className={`w-3.5 h-3.5 ${isActive ? 'text-amber-500' : 'text-slate-300'}`} />
                                      Reschedule
                                    </button>

                                    {/* Option: Regenerate Report */}
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setOpenMenuCandId(null);
                                        handleRegenerateReport(c.id);
                                      }}
                                      disabled={!c.submittedDate}
                                      title={c.submittedDate ? 'Request report regeneration' : 'Disabled: Candidate must complete the assessment first.'}
                                      className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold transition ${
                                        c.submittedDate
                                          ? 'text-foreground hover:bg-muted/40 cursor-pointer'
                                          : 'text-slate-300 bg-muted/40 cursor-not-allowed'
                                      }`}
                                    >
                                      <RefreshCw className={`w-3.5 h-3.5 ${c.submittedDate ? 'text-blue-500' : 'text-slate-300'}`} />
                                      Regenerate Report
                                    </button>
                                  </div>
                              )}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}

                  {activeAssessmentCandidates.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={11} className="py-12 text-center text-muted-foreground text-xs">
                        No candidates are registered for this assessment. Click "Create Assignment (CSV Upload)" to populate candidates.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          VIEW 4: CANDIDATE UPLOAD / IMPORT FLOW (CSV PARSER WORKSPACE)
          ========================================================================= */}
      {currentView === 'UPLOAD' && activeAssessment && (
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setCurrentView('DETAIL')}
              className="p-1.5 rounded-lg border border-border/70 hover:bg-muted/40 text-muted-foreground transition"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div>
              <h2 className="text-lg font-bold text-foreground">
                CSV Candidate Importer
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Bulk register assignment schedules for: <span className="font-semibold text-foreground">{activeAssessment.jobTitle}</span>
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left side upload interface */}
            <div className="lg:col-span-1 space-y-4">
              {/* Manual Student Registration Form Space */}
              <form onSubmit={handleAddManualCandidate} className="bg-card border border-border/70 rounded-xl p-5 space-y-3.5 shadow-xs">
                <div className="border-b border-slate-100 pb-2 flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center gap-1.5">
                    <UserPlus className="w-3.5 h-3.5 text-blue-500" /> Manual Student Registration
                  </h3>
                  <span className="text-[9px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded-sm font-bold">
                    Quick Add
                  </span>
                </div>

                <div className="space-y-2.5">
                  <div>
                    <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">
                      Full Name *
                    </label>
                    <Input
                      type="text"
                      placeholder="e.g. Dr. Jane Doe"
                      value={manualName}
                      onChange={(e) => setManualName(e.target.value)}
                      className="text-xs h-8.5 bg-muted/40/20"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">
                      Email Address *
                    </label>
                    <Input
                      type="text"
                      placeholder="e.g. jane.doe@university.edu"
                      value={manualEmail}
                      onChange={(e) => setManualEmail(e.target.value)}
                      className="text-xs h-8.5 bg-muted/40/20"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">
                      Phone Number (Optional)
                    </label>
                    <Input
                      type="tel"
                      placeholder="10-digit number, e.g. 1234567890"
                      value={manualPhone}
                      onChange={(e) => setManualPhone(e.target.value)}
                      className="text-xs h-8.5 bg-muted/40/20"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">
                        Start Time (Optional)
                      </label>
                      <Input
                        type="datetime-local"
                        value={manualStartTime}
                        onChange={(e) => setManualStartTime(e.target.value)}
                        className="text-xs h-8.5 font-mono bg-muted/40/20"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">
                        End Time (Optional)
                      </label>
                      <Input
                        type="datetime-local"
                        value={manualEndTime}
                        onChange={(e) => setManualEndTime(e.target.value)}
                        className="text-xs h-8.5 font-mono bg-muted/40/20"
                      />
                    </div>
                  </div>

                  {/* Warning and consent check for empty Start/End times */}
                  {(!manualStartTime.trim() || !manualEndTime.trim()) && (
                    <div className="p-2.5 bg-amber-50/50 border border-amber-100 rounded-lg space-y-1.5">
                      <p className="text-[10px] text-amber-700 font-semibold leading-normal">
                        ⚠️ Start Time and End Time are empty. They will default to <strong>current time</strong> and <strong>3 days from now</strong> respectively.
                      </p>
                      <label className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={timeConsent}
                          onChange={(e) => setTimeConsent(e.target.checked)}
                          className="mt-0.5 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                        />
                        <span className="text-[10px] text-amber-600 font-bold select-none">
                          I consent to proceed with empty times.
                        </span>
                      </label>
                    </div>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={(!manualStartTime.trim() || !manualEndTime.trim()) && !timeConsent}
                  title={(!manualStartTime.trim() || !manualEndTime.trim()) && !timeConsent ? 'Tick the consent box to enable when Start/End time is empty' : 'Add student to list'}
                  className="w-full flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold py-2 rounded-lg transition shadow-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-blue-600"
                >
                  <UserPlus className="w-3.5 h-3.5" /> Add Student to List
                </button>
              </form>

              {/* Bulk upload option */}
              <div className="border-t border-slate-100 my-4 pt-4">
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block mb-2">Or Bulk Upload Candidate List</span>
              </div>

              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file) {
                    setUploadedFileName(file.name);
                    const reader = new FileReader();
                    reader.onload = (evt) => parseCSVContent(evt.target?.result as string);
                    reader.readAsText(file);
                  }
                }}
                className={`border-2 border-dashed rounded-xl p-8 text-center transition flex flex-col items-center justify-center min-h-[220px] ${
                  isDragging 
                    ? 'border-blue-500 bg-blue-50/10' 
                    : 'border-border/70 bg-card hover:bg-muted/40/50'
                }`}
              >
                <div className="p-3.5 bg-blue-50 text-blue-600 rounded-full mb-3">
                  <Upload className="w-6 h-6" />
                </div>
                <span className="text-xs font-semibold text-foreground">Drag and drop candidate list here</span>
                <span className="text-[10px] text-muted-foreground mt-1 block">Supports .csv file types (10MB max)</span>
                <span className="text-[10px] text-muted-foreground mt-1 block font-mono">Columns: Name, Email, Phone, Start Time, End Time — dates must be ISO 8601 (e.g. 2026-07-05T09:00:00Z)</span>
                
                <div className="mt-4">
                  <label className="bg-muted hover:bg-muted text-foreground text-xs font-bold px-3 py-1.5 rounded-lg transition cursor-pointer">
                    Choose File
                    <input
                      type="file"
                      accept=".csv"
                      onChange={handleCSVUpload}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>

              {/* Sample loader card */}
              <div className="bg-gradient-to-br from-indigo-50/30 to-blue-50/30 p-5 rounded-xl border border-indigo-100/40 space-y-3">
                <span className="text-xs font-bold text-indigo-700 flex items-center gap-1">
                  <Sparkles className="w-4 h-4 animate-pulse" /> Sandbox Template Generator
                </span>
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  Generate mock rows (including red-blocking and yellow-warning scenarios) to test validation features:
                </p>
                <button
                  onClick={triggerSampleTemplateCSV}
                  className="w-full text-center bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-bold py-2 rounded-lg transition"
                >
                  Load Sample Candidate CSV
                </button>
              </div>
            </div>

            {/* Right side parsing preview */}
            <div className="lg:col-span-2 space-y-4">
              {parsedRows.length > 0 ? (
                <div className="space-y-4">
                  {/* Validation Panel */}
                  <div className="p-4 bg-muted/40 border border-border/70 rounded-xl space-y-3">
                    <div className="flex items-center justify-between border-b border-border/70 pb-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        Validation Log ({validationErrors.length} Checks flagged)
                      </span>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                        validationErrors.some(e => e.type === 'red') 
                          ? 'bg-red-100 text-red-700' 
                          : validationErrors.length > 0 
                            ? 'bg-amber-100 text-amber-700' 
                            : 'bg-emerald-100 text-emerald-700'
                      }`}>
                        {validationErrors.some(e => e.type === 'red') 
                          ? 'BLOCKING ERRORS DETECTED' 
                          : validationErrors.length > 0 
                            ? 'WARNINGS ONLY - CAN PROCEED' 
                            : 'ALL CLEAR'}
                      </span>
                    </div>

                    <div className="max-h-[120px] overflow-y-auto space-y-1.5 pr-2">
                      {validationErrors.map((err, i) => (
                        <div key={i} className="flex gap-2 text-[11px] items-start">
                          <span className={`px-1.5 py-0.5 rounded-sm font-bold text-[9px] ${err.type === 'red' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                            {err.type.toUpperCase()}
                          </span>
                          <span className="text-muted-foreground font-semibold">Row {err.row}:</span>
                          <span className="text-muted-foreground">{err.message} ({err.col})</span>
                        </div>
                      ))}
                      {validationErrors.length === 0 && (
                        <div className="text-emerald-600 text-xs font-semibold flex items-center gap-1.5 py-2">
                          <CheckCircle className="w-4 h-4" /> All rows meet expected format parameters perfectly!
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Editable grid Table before confirmation */}
                  <div className="bg-card border border-border/70 rounded-xl overflow-hidden shadow-xs">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/40/50">
                          <TableHead className="font-semibold text-foreground">Name</TableHead>
                          <TableHead className="font-semibold text-foreground">Email</TableHead>
                          <TableHead className="font-semibold text-foreground">Phone</TableHead>
                          <TableHead className="font-semibold text-foreground">Start Time</TableHead>
                          <TableHead className="font-semibold text-foreground">End Time</TableHead>
                          <TableHead className="w-[50px] text-right"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {parsedRows.map((row) => (
                          <TableRow key={row.rowId}>
                            <TableCell>
                              <Input
                                value={row.name}
                                onChange={(e) => handleUpdateImportRow(row.rowId, 'name', e.target.value)}
                                className="text-xs h-8 bg-muted/40/30 font-semibold"
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                value={row.email}
                                onChange={(e) => handleUpdateImportRow(row.rowId, 'email', e.target.value)}
                                className="text-xs h-8 bg-muted/40/30"
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                value={row.phone}
                                onChange={(e) => handleUpdateImportRow(row.rowId, 'phone', e.target.value)}
                                className="text-xs h-8 bg-muted/40/30"
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                value={row.startTime}
                                onChange={(e) => handleUpdateImportRow(row.rowId, 'startTime', e.target.value)}
                                className="text-xs h-8 bg-muted/40/30 font-mono"
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                value={row.endTime}
                                onChange={(e) => handleUpdateImportRow(row.rowId, 'endTime', e.target.value)}
                                className="text-xs h-8 bg-muted/40/30 font-mono"
                              />
                            </TableCell>
                            <TableCell className="text-right">
                              <button
                                onClick={() => handleRemoveImportRow(row.rowId)}
                                className="p-1 hover:text-destructive rounded"
                              >
                                <Trash className="w-3.5 h-3.5" />
                              </button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  {/* Submission and Confirmation actions */}
                  <div className="flex justify-end gap-3.5">
                    <button
                      onClick={() => {
                        setParsedRows([]);
                        setValidationErrors([]);
                        setUploadedFileName('');
                      }}
                      className="px-4 py-2 border border-border/70 hover:bg-muted/40 text-foreground rounded-lg text-xs font-semibold transition"
                    >
                      Clear Data
                    </button>
                    <button
                      onClick={handleConfirmCandidateImport}
                      disabled={validationErrors.some(e => e.type === 'red')}
                      className={`px-5 py-2 rounded-lg text-xs font-semibold text-white transition ${
                        validationErrors.some(e => e.type === 'red')
                          ? 'bg-slate-300 cursor-not-allowed'
                          : 'bg-blue-600 hover:bg-blue-700 shadow-xs cursor-pointer'
                      }`}
                    >
                      Confirm and Load Candidates
                    </button>
                  </div>
                </div>
              ) : (
                <div className="bg-card border border-border/70 p-20 rounded-xl text-center text-muted-foreground">
                  Please upload a candidate .csv or load the sandbox template on the left to begin candidate validation checks.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    {/* =========================================================================
        RESCHEDULE INTERVIEW MODAL
        ========================================================================= */}
      {rescheduleCandId && (
        <>
          {/* Backdrop */}
          <div 
            className="fixed inset-0 bg-black/40 z-40"
            onClick={() => {
              if (!isRescheduling) {
                setRescheduleCandId(null);
                setRescheduleStartTime('');
                setRescheduleEndTime('');
              }
            }}
          />
          {/* Modal */}
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-card rounded-xl border border-border/70 shadow-xl w-full max-w-md p-6 space-y-5">
              <div>
                <h3 className="text-sm font-bold text-foreground">Reschedule Interview</h3>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Set a new scheduling window for this candidate.
                  {(() => {
                    const c = candidates.find(c => c.id === rescheduleCandId);
                    return c?.interviewId
                      ? <> This calls <span className="font-mono text-[10px] bg-gray-100 px-1 py-0.5 rounded border border-border/70">PUT /interview/{'{id}'}/reschedule</span>.</>
                      : <> Updates the stored times so Generate Link can proceed.</>;
                  })()}
                </p>
              </div>

              {/* Candidate Info + Current Window */}
              {(() => {
                const cand = candidates.find(c => c.id === rescheduleCandId);
                if (!cand) return null;
                const s = parseServerDate(cand.startTime);
                const e = parseServerDate(cand.endTime);
                const startPast = s ? s.getTime() < Date.now() : false;
                const endPast = e ? e.getTime() < Date.now() : false;
                return (
                  <div className="bg-muted/40 border border-border/70 rounded-lg p-3 text-xs space-y-2">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground font-semibold">Candidate:</span>
                      <span className="font-bold text-foreground">{cand.name}</span>
                    </div>
                    {cand.interviewId && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground font-semibold">Interview ID:</span>
                        <span className="font-mono text-[10px] text-muted-foreground">{cand.interviewId}</span>
                      </div>
                    )}
                    {s && e && (
                      <div className={`mt-1 p-2 rounded border text-[10px] ${
                        startPast
                          ? 'bg-amber-50 border-amber-200 text-amber-800'
                          : 'bg-sky-50 border-sky-200 text-sky-700'
                      }`}>
                        <div className="font-bold uppercase tracking-wider text-[9px] opacity-70 mb-0.5">Current Window</div>
                        <div className="flex justify-between font-semibold">
                          <span>Start:</span>
                          <span className={startPast ? 'text-red-600 line-through' : ''}>{formatLocalInstant(s)}</span>
                        </div>
                        <div className="flex justify-between font-semibold">
                          <span>End:</span>
                          <span className={endPast ? 'text-red-600 line-through' : ''}>{formatLocalInstant(e)}</span>
                        </div>
                        {startPast && !endPast && (
                          <div className="mt-1 text-[9px] text-amber-700 font-bold flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" /> Start time is in the past — select a future start below
                          </div>
                        )}
                        {endPast && (
                          <div className="mt-1 text-[9px] text-red-600 font-bold flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" /> Entire window has expired — set new times below
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Time Inputs */}
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-foreground">
                    New Start Time <span className="text-destructive">*</span>
                  </label>
                  <Input
                    type="datetime-local"
                    value={rescheduleStartTime}
                    onChange={(e) => setRescheduleStartTime(e.target.value)}
                    className="text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-foreground">
                    New End Time <span className="text-destructive">*</span>
                  </label>
                  <Input
                    type="datetime-local"
                    value={rescheduleEndTime}
                    onChange={(e) => setRescheduleEndTime(e.target.value)}
                    className="text-xs"
                  />
                </div>

                {/* Validation hints */}
                {rescheduleStartTime && rescheduleEndTime && new Date(rescheduleEndTime) <= new Date(rescheduleStartTime) && (
                  <div className="text-[10px] text-destructive font-semibold flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> End Time must be after Start Time.
                  </div>
                )}
                {rescheduleStartTime && new Date(rescheduleStartTime).getTime() < Date.now() + MIN_RESCHEDULE_BUFFER_MS && (
                  <div className="text-[10px] text-amber-600 font-semibold flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> Start Time must be at least {Math.ceil(MIN_RESCHEDULE_BUFFER_MS / 60_000)} minutes in the future.
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-2 border-t border-gray-100">
                <button
                  onClick={() => {
                    setRescheduleCandId(null);
                    setRescheduleStartTime('');
                    setRescheduleEndTime('');
                  }}
                  disabled={isRescheduling}
                  className="flex-1 py-2 bg-card border border-border/70 hover:bg-muted/40 text-foreground rounded-md text-xs font-semibold text-center transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRescheduleSubmit}
                  disabled={isRescheduling || !rescheduleStartTime || !rescheduleEndTime}
                  className={`flex-1 py-2 rounded-md text-xs font-semibold text-center text-white transition flex items-center justify-center gap-2 ${
                    isRescheduling
                      ? 'bg-[#111827]/70 cursor-wait'
                      : 'bg-[#111827] hover:bg-[#111827]/90 cursor-pointer'
                  }`}
                >
                  {isRescheduling ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Rescheduling...
                    </>
                  ) : (
                    'Reschedule Interview'
                  )}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
      {/* =========================================================================
          UPDATE PASSWORD DIALOG
          ========================================================================= */}
      {passwordEditCandId && (
        <>
          {/* Backdrop */}
          <div 
            className="fixed inset-0 bg-black/40 z-40"
            onClick={() => {
              if (!isSavingPassword) {
                setPasswordEditCandId(null);
                setNewCandPassword('');
              }
            }}
          />
          {/* Dialog Container */}
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-card rounded-xl border border-border/70 shadow-xl w-full max-w-md p-6 space-y-4 text-left">
              <div>
                <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                  <Lock className="w-4 h-4 text-muted-foreground" /> Update Candidate Password
                </h3>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Assign a new evaluation access credential key for this candidate.
                </p>
              </div>

              {/* Candidate Metadata Summary */}
              {(() => {
                const target = candidates.find(c => c.id === passwordEditCandId);
                return target ? (
                  <div className="bg-muted/40 border border-border/70 rounded-lg p-3 text-xs space-y-1">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground font-semibold">Candidate:</span>
                      <span className="font-bold text-foreground">{target.name}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground font-semibold">Email:</span>
                      <span className="font-semibold text-muted-foreground">{target.email}</span>
                    </div>
                  </div>
                ) : null;
              })()}

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-foreground">New Password Key <span className="text-destructive">*</span></label>
                <Input
                  value={newCandPassword}
                  onChange={(e) => setNewCandPassword(e.target.value)}
                  placeholder="Enter custom login password key..."
                  className="text-xs font-bold"
                />
              </div>

              <div className="flex gap-2 pt-2 border-t border-gray-150">
                <button
                  onClick={() => {
                    setPasswordEditCandId(null);
                    setNewCandPassword('');
                  }}
                  disabled={isSavingPassword}
                  className="flex-1 py-2 bg-card border border-border/70 hover:bg-muted/40 text-foreground rounded-md text-xs font-semibold text-center transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleUpdatePasswordSubmit}
                  disabled={isSavingPassword || !newCandPassword.trim()}
                  className={`flex-1 py-2 rounded-md text-xs font-semibold text-center text-white transition flex items-center justify-center gap-2 ${
                    isSavingPassword
                      ? 'bg-[#111827]/70 cursor-wait'
                      : 'bg-[#111827] hover:bg-[#111827]/90 cursor-pointer'
                  }`}
                >
                  Save Password
                </button>
              </div>
            </div>
          </div>
        </>
      )}
      {/* =========================================================================
          SEND INVITE — TEMPLATE PICKER DIALOG
          ========================================================================= */}
      {inviteDialogCandIds.length > 0 && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/40 z-40"
            onClick={() => {
              if (!isSendingInvite) setInviteDialogCandIds([]);
            }}
          />
          {/* Dialog Container */}
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-card rounded-xl border border-border/70 shadow-xl w-full max-w-lg p-6 space-y-4 text-left max-h-[90vh] overflow-y-auto">
              <div>
                <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                  <Send className="w-4 h-4 text-muted-foreground" /> Send Invitation
                </h3>
                <p className="text-[11px] text-muted-foreground mt-1">
                  {(() => {
                    const names = candidates
                      .filter(c => inviteDialogCandIds.includes(c.id))
                      .map(c => c.name);
                    return names.length === 1
                      ? <>Choose the mail template for <strong className="text-foreground">{names[0]}</strong>. The mail is sent only with the selected template.</>
                      : <>Choose one mail template for <strong className="text-foreground">{names.length} candidates</strong>. The same template is used for every mail.</>;
                  })()}
                </p>
              </div>

              {/* Template options */}
              <div className="space-y-2" role="radiogroup" aria-label="Mail template">
                {templates.map(t => {
                  const selected = t.id === inviteTemplateId;
                  return (
                    <button
                      key={t.id}
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setInviteTemplateId(t.id)}
                      disabled={isSendingInvite}
                      className={`w-full text-left p-3 rounded-xl border transition flex items-start gap-3 cursor-pointer ${
                        selected
                          ? 'border-primary bg-primary-soft shadow-[var(--shadow-card)]'
                          : 'border-border/70 bg-card hover:border-primary/40'
                      }`}
                    >
                      <span className={`mt-1 w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                        selected ? 'border-primary' : 'border-border'
                      }`}>
                        {selected && <span className="w-2 h-2 rounded-full bg-primary" />}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="flex items-center gap-2">
                          <span className="font-semibold text-sm text-foreground truncate">{t.name}</span>
                          <Pill tone={t.type === 'STANDARD_INVITATION' ? 'info' : t.type === 'REMINDER' ? 'warning' : 'success'}>
                            <span className="uppercase tracking-wide text-[10px]">{t.type}</span>
                          </Pill>
                        </span>
                        <span className="block text-[11px] text-muted-foreground truncate mt-0.5">{t.subject}</span>
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Rendered preview for the first recipient */}
              {(() => {
                const template = templates.find(t => t.id === inviteTemplateId);
                const previewCand = candidates.find(c => c.id === inviteDialogCandIds[0]);
                if (!template || !previewCand || !activeAssessment) return null;
                const rendered = renderTemplate(template, previewCand, activeAssessment);
                return (
                  <div className="rounded-xl border border-border/60 bg-muted/40 overflow-hidden">
                    <div className="px-4 py-2.5 border-b border-border/60 text-xs">
                      <span className="font-semibold text-accent">Subject: </span>
                      <span className="font-semibold text-foreground">{rendered.subject}</span>
                      <span className="block text-[10px] text-muted-foreground mt-0.5">
                        To: {previewCand.name} &lt;{previewCand.email}&gt;
                        {inviteDialogCandIds.length > 1 && ` (+${inviteDialogCandIds.length - 1} more)`}
                      </span>
                    </div>
                    <div className="px-4 py-3 text-xs leading-relaxed text-foreground whitespace-pre-wrap max-h-40 overflow-y-auto">
                      {rendered.body}
                    </div>
                  </div>
                );
              })()}

              <div className="flex gap-2 pt-2 border-t border-gray-150">
                <button
                  onClick={() => setInviteDialogCandIds([])}
                  disabled={isSendingInvite}
                  className="flex-1 py-2 bg-card border border-border/70 hover:bg-muted/40 text-foreground rounded-md text-xs font-semibold text-center transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={executeSendInvites}
                  disabled={isSendingInvite || !inviteTemplateId}
                  className={`flex-1 py-2 rounded-md text-xs font-semibold text-center text-white transition flex items-center justify-center gap-2 ${
                    isSendingInvite || !inviteTemplateId
                      ? 'bg-[#111827]/70 cursor-wait'
                      : 'bg-[#111827] hover:bg-[#111827]/90 cursor-pointer'
                  }`}
                >
                  {isSendingInvite ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    <>
                      <Send className="w-3.5 h-3.5" />
                      Send Invite{inviteDialogCandIds.length > 1 ? ` (${inviteDialogCandIds.length})` : ''}
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
