import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  checkDuplicate,
  createJob,
  downloadJdTemplate,
  fetchUserDirectory,
  parseJd,
  DirectoryUser,
  Job,
  JdParseError,
  ParsedJd,
} from '../lib/hiringApi';
import { JdEditor, jdPlainText, JD_MIN_CHARS, JD_MAX_CHARS } from './JdEditor';
import { fetchRules, type JobRules } from '../lib/hiringApi';
import { PAButton } from './ui/primitives';

type JdMode = 'template' | 'document';

interface AiReviewState {
  values: Record<string, unknown>;
  missingFields: string[];
  needsReview: { field: string; reason: string }[];
  fieldErrors: { field: string; message: string }[];
  warnings: string[];
  resolvedAssignee: { userId: string; email: string; name: string } | null;
  evidence: Record<string, string>;
  assigneeText: string | null;
}

const FIELD_LABELS: Record<string, string> = {
  companyName: 'Company Name',
  jobRole: 'Job Role',
  title: 'Job Title',
  minExperienceYears: 'Minimum Experience',
  maxExperienceYears: 'Maximum Experience',
  positionsTotal: 'Number of Positions',
  keywords: 'Keywords',
  department: 'Department',
  openedAt: 'Opened At',
  closesAt: 'Closes At',
  assigneeUserId: 'Assignee',
  workMode: 'Work Mode',
  location: 'Location',
  jdHtml: 'Job Description',
  document: 'Document',
};

// Backend review field → Draft key for per-field badges/notes.
const BACKEND_TO_DRAFT: Record<string, keyof Draft> = {
  companyName: 'companyName',
  jobRole: 'jobRole',
  title: 'title',
  minExperienceYears: 'minExperience',
  maxExperienceYears: 'maxExperience',
  positionsTotal: 'positions',
  keywords: 'keywords',
  department: 'department',
  openedAt: 'openedAt',
  closesAt: 'closesAt',
  assigneeUserId: 'assigneeUserId',
  workMode: 'workMode',
  location: 'location',
  jdHtml: 'jdHtml',
};

const aiFieldLabel = (field: string) => FIELD_LABELS[field] || field;

function AiBadge() {
  return (
    <span className="ml-1.5 inline-flex items-center rounded-full bg-[var(--warning-soft)] px-2 py-0.5 align-middle text-[10px] font-bold text-[var(--warning)]">
      AI extracted
    </span>
  );
}

const MAX_KEYWORDS = 20;

interface Draft {
  jobKey: string;
  companyName: string;
  jobRole: string;
  title: string;
  minExperience: string;
  maxExperience: string;
  positions: string;
  keywords: string[];
  department: string;
  openedAt: string;
  closesAt: string;
  assigneeUserId: string;
  workMode: string;
  location: string;
  jdHtml: string;
}

const EMPTY_DRAFT: Draft = {
  jobKey: '', companyName: '', jobRole: '', title: '',
  minExperience: '', maxExperience: '', positions: '',
  keywords: [], department: '', openedAt: '', closesAt: '',
  assigneeUserId: '', workMode: '', location: '', jdHtml: '<p></p>',
};

function nowLocalInput(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function normalizeTag(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

function validate(draft: Draft, rules?: JobRules | null): Record<string, string> {
  const errors: Record<string, string> = {};
  const JD_MIN = rules?.jdMinChars ?? JD_MIN_CHARS;
  const JD_MAX = rules?.jdMaxChars ?? JD_MAX_CHARS;
  const POS_MAX = rules?.positionsMax ?? 1000;
  const EXP_MAX = rules?.maxExperienceYears ?? 50;
  const depts = rules?.departments ?? [];
  // Title/role/company charset (mirror of the server matrix, so the demo
  // shows the same rule client-side before the server ever sees it).
  const badChar = /[(),:<>{}[\]"'`;\\/]|<script/i;
  if (!draft.jobKey.trim() || draft.jobKey.trim().length < 2) {
    errors.jobKey = 'Job key is required (min 2 characters).';
  }
  if (!draft.companyName.trim()) errors.companyName = 'Company Name is required.';
  else if (badChar.test(draft.companyName)) errors.companyName = 'Company Name has disallowed characters (allowed: letters, digits, & . -).';
  if (!draft.jobRole.trim()) errors.jobRole = 'Job Role is required.';
  else if (badChar.test(draft.jobRole)) errors.jobRole = 'Job Role has disallowed characters (allowed: letters, digits, spaces, - / & .).';
  if (!draft.title.trim()) errors.title = 'Job Title is required.';
  else if (badChar.test(draft.title)) errors.title = 'Job Title has disallowed characters (allowed: letters, digits, spaces, - / & .).';
  if (!draft.department.trim()) errors.department = 'Department is required.';
  else if (depts.length > 0 && !depts.some((d) => d.toLowerCase() === draft.department.trim().toLowerCase())) {
    errors.department = 'Department must be from the predefined list.';
  }
  const min = draft.minExperience.trim() === '' ? NaN : Number(draft.minExperience);
  const max = draft.maxExperience.trim() === '' ? NaN : Number(draft.maxExperience);
  if (draft.minExperience.trim() === '' || Number.isNaN(min) || min < 0) {
    errors.minExperience = 'Minimum Experience is required and must be 0 or more.';
  } else if (min > EXP_MAX || Math.abs(min * 12 - Math.round(min * 12)) > 1e-6) {
    errors.minExperience = `Experience must be whole months up to ${EXP_MAX} (e.g. 2.5 = 2 yr 6 mo; 2.55 is not valid).`;
  }
  if (draft.maxExperience.trim() === '' || Number.isNaN(max) || max < 0) {
    errors.maxExperience = 'Maximum Experience is required and must be 0 or more.';
  } else if (max > EXP_MAX || Math.abs(max * 12 - Math.round(max * 12)) > 1e-6) {
    errors.maxExperience = `Experience must be whole months up to ${EXP_MAX} (e.g. 2.5 = 2 yr 6 mo; 2.55 is not valid).`;
  }
  if (!errors.minExperience && !errors.maxExperience && max < min) {
    errors.maxExperience = 'Maximum Experience must be greater than or equal to Minimum Experience.';
  }
  if (!/^\d+$/.test(draft.positions.trim()) || Number(draft.positions) < 1) {
    errors.positions = `Number of Positions must be an integer between 1 and ${POS_MAX}.`;
  } else if (Number(draft.positions) > POS_MAX) {
    errors.positions = `Number of Positions must be between 1 and ${POS_MAX}.`;
  }
  if (!draft.closesAt) {
    errors.closesAt = 'Closes At is required.';
  } else if (draft.openedAt) {
    const opened = new Date(draft.openedAt).getTime();
    const closes = new Date(draft.closesAt).getTime();
    if (Number.isNaN(closes)) errors.closesAt = 'Closes At must be a valid date.';
    else if (!Number.isNaN(opened) && closes <= opened) {
      errors.closesAt = 'Closes At must be greater than Opened At.';
    }
  }
  if (!draft.assigneeUserId) errors.assigneeUserId = 'Assignee is required.';
  const jdLen = jdPlainText(draft.jdHtml).length;
  if (jdLen < JD_MIN) {
    errors.jdHtml = `Job Description must be at least ${JD_MIN} characters (currently ${jdLen}).`;
  } else if (jdLen > JD_MAX) {
    errors.jdHtml = `Job Description must be at most ${JD_MAX} characters (currently ${jdLen}).`;
  }
  return errors;
}

function Field({
  label, required, error, children, hint, badge, aiNote,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
  hint?: string;
  badge?: React.ReactNode;
  aiNote?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-[12px] font-bold">
      <span>
        {label} {required && <span className="text-red-500" aria-hidden>*</span>}
        {badge}
      </span>
      {children}
      {aiNote && <span className="font-medium text-[var(--warning)]">⚠ {aiNote}</span>}
      {hint && <span className="font-normal text-muted-foreground">{hint}</span>}
      {error && <span role="alert" className="font-medium text-red-600">{error}</span>}
    </label>
  );
}

export default function CreateJobForm({
  onCreated, onExit,
}: {
  onCreated: (job: Job) => void;
  onExit: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => ({ ...EMPTY_DRAFT, openedAt: nowLocalInput() }));
  const [initial] = useState(() => JSON.stringify({ ...EMPTY_DRAFT, openedAt: draft.openedAt }));
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitErrors, setSubmitErrors] = useState<Record<string, string>>({});
  const [directory, setDirectory] = useState<DirectoryUser[]>([]);
  const [dirError, setDirError] = useState<string | null>(null);
  const [keywordInput, setKeywordInput] = useState('');
  const [keywordHint, setKeywordHint] = useState<string | null>(null);

  const [jdFile, setJdFile] = useState<File | null>(null);
  const [jdMode, setJdMode] = useState<JdMode>('template');
  const [jdParsing, setJdParsing] = useState(false);
  const [jdResult, setJdResult] = useState<string | null>(null);
  const [jdWarnings, setJdWarnings] = useState<string[]>([]);
  const [rules, setRules] = useState<JobRules | null>(null);
  const [jdTemplateVersion, setJdTemplateVersion] = useState<string | null>(null);
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);
  // AI document-ingestion review state (document mode only; never persisted).
  const [aiReview, setAiReview] = useState<AiReviewState | null>(null);
  const [aiFields, setAiFields] = useState<string[]>([]);

  const [dupList, setDupList] = useState<Job[] | null>(null);
  const [dupConfirmedFor, setDupConfirmedFor] = useState<string | null>(null);
  const [checkingDup, setCheckingDup] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [created, setCreated] = useState<Job | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);

  const dirty = useMemo(
    () => !created && JSON.stringify({ ...draft, jdHtml: draft.jdHtml }) !== initial,
    [draft, created, initial]
  );

  // Browser refresh / tab close guard.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const users = await fetchUserDirectory();
        if (!cancelled) setDirectory(users);
      } catch (e) {
        if (!cancelled) {
          setDirError(e instanceof Error ? e.message : 'Failed to load assignees.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchRules()
      .then((r) => { if (!cancelled) setRules(r); })
      .catch(() => { /* keep fallback constants when the rules call fails */ });
    return () => { cancelled = true; };
  }, []);

  const set = useCallback(
    <K extends keyof Draft>(key: K, value: Draft[K]) => {
      setDraft((d) => ({ ...d, [key]: value }));
      setTouched((t) => ({ ...t, [key]: true }));
    },
    []
  );

  const liveErrors = useMemo(() => {
    const all = validate(draft, rules);
    const shown: Record<string, string> = {};
    for (const [k, v] of Object.entries(all)) {
      if (touched[k]) shown[k] = v;
    }
    return shown;
  }, [draft, touched]);

  const assigneeEmail = useMemo(
    () => directory.find((u) => u.userId === draft.assigneeUserId)?.email || '',
    [directory, draft.assigneeUserId]
  );

  function addKeyword(raw: string) {
    const tag = normalizeTag(raw);
    setKeywordHint(null);
    if (!tag) return;
    const dup = draft.keywords.some((k) => k.toLowerCase() === tag.toLowerCase());
    if (dup) {
      setKeywordHint(`"${tag}" is already added — duplicates are not allowed.`);
      return;
    }
    if (draft.keywords.length >= MAX_KEYWORDS) {
      setKeywordHint(`At most ${MAX_KEYWORDS} keywords are allowed.`);
      return;
    }
    set('keywords', [...draft.keywords, tag]);
    setKeywordInput('');
  }

  function prefillFromTemplate(m: Record<string, string | number | string[] | null>) {
    const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
    const next: Draft = {
      ...draft,
      companyName: str(m.companyName) || draft.companyName,
      jobRole: str(m.jobRole) || draft.jobRole,
      title: str(m.title) || draft.title,
      minExperience: m.minExperienceYears != null ? String(m.minExperienceYears) : draft.minExperience,
      maxExperience: m.maxExperienceYears != null ? String(m.maxExperienceYears) : draft.maxExperience,
      positions: m.positionsTotal != null ? String(m.positionsTotal) : draft.positions,
      keywords: Array.isArray(m.keywords) && m.keywords.length > 0
        ? (m.keywords as string[])
        : draft.keywords,
      department: str(m.department) || draft.department,
      openedAt: toLocalInput(typeof m.openedAt === 'string' ? m.openedAt : null) || draft.openedAt,
      closesAt: toLocalInput(typeof m.closesAt === 'string' ? m.closesAt : null) || draft.closesAt,
      assigneeUserId: typeof m.assigneeUserId === 'string' ? m.assigneeUserId : draft.assigneeUserId,
      workMode: str(m.workMode) || draft.workMode,
      location: str(m.location) || draft.location,
      jdHtml: typeof m.jdHtml === 'string' && m.jdHtml ? m.jdHtml : draft.jdHtml,
    };
    setDraft(next);
  }

  function prefillFromReview(values: Record<string, unknown>) {
    const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
    const filled: string[] = [];
    const next: Draft = { ...draft };
    const put = (draftKey: keyof Draft, value: string, hasValue: boolean) => {
      if (!hasValue) return;
      (next[draftKey] as string) = value;
      filled.push(draftKey);
    };
    put('companyName', str(values.companyName), !!str(values.companyName));
    put('jobRole', str(values.jobRole), !!str(values.jobRole));
    put('title', str(values.title), !!str(values.title));
    put('department', str(values.department), !!str(values.department));
    put('location', str(values.location), !!str(values.location));
    put('workMode', str(values.workMode), !!str(values.workMode));
    if (values.minExperienceYears != null && values.minExperienceYears !== '') {
      next.minExperience = String(values.minExperienceYears);
      filled.push('minExperience');
    }
    if (values.maxExperienceYears != null && values.maxExperienceYears !== '') {
      next.maxExperience = String(values.maxExperienceYears);
      filled.push('maxExperience');
    }
    if (values.positionsTotal != null && values.positionsTotal !== '') {
      next.positions = String(values.positionsTotal);
      filled.push('positions');
    }
    if (Array.isArray(values.keywords) && values.keywords.length > 0) {
      next.keywords = (values.keywords as unknown[]).map((k) => String(k));
      filled.push('keywords');
    }
    const opened = toLocalInput(typeof values.openedAt === 'string' ? values.openedAt : null);
    if (opened) {
      next.openedAt = opened;
      filled.push('openedAt');
    }
    const closes = toLocalInput(typeof values.closesAt === 'string' ? values.closesAt : null);
    if (closes) {
      next.closesAt = closes;
      filled.push('closesAt');
    }
    if (typeof values.assigneeUserId === 'string' && values.assigneeUserId) {
      next.assigneeUserId = values.assigneeUserId;
      filled.push('assigneeUserId');
    }
    if (typeof values.jdHtml === 'string' && values.jdHtml) {
      next.jdHtml = values.jdHtml;
      filled.push('jdHtml');
    }
    setDraft(next);
    setAiFields(filled);
  }

  async function handleJdFile(file: File | null) {
    setJdFile(file);
    setJdResult(null);
    setJdWarnings([]);
    setAiReview(null);
    setAiFields([]);
    if (!file) return;
    const ext = file.name.toLowerCase();
    if (!ext.endsWith('.pdf') && !ext.endsWith('.docx') && !ext.endsWith('.doc')) {
      setJdResult('Only PDF, DOCX or DOC files are allowed.');
      return;
    }
    const mode = jdMode;
    setJdParsing(true);
    try {
      const parsed: ParsedJd = await parseJd(file, mode);
      if (mode === 'document') {
        handleDocumentResult(parsed, file);
      } else {
        const m = parsed.mapped as Record<string, string | number | string[] | null>;
        prefillFromTemplate(m);
        setJdTemplateVersion(typeof parsed.templateVersion === 'string' ? parsed.templateVersion : null);
        setJdWarnings(parsed.warnings || []);
        setJdResult(`Extracted ${Object.keys(m).length} fields from ${parsed.filename}. Review them below before saving — nothing has been saved yet.`);
      }
    } catch (e) {
      if (e instanceof JdParseError) {
        const details = e.fieldErrors.length > 0
          ? ` (${e.fieldErrors.map((f) => f.field).join(', ')})`
          : '';
        const manual = mode === 'document'
          ? ' You can continue filling the form manually — nothing was saved.'
          : '';
        setJdResult(`${e.message}${details}${manual}`);
      } else {
        setJdResult(e instanceof Error ? e.message : 'JD parsing failed.');
      }
    } finally {
      setJdParsing(false);
    }
  }

  function handleDocumentResult(parsed: ParsedJd, file: File) {
    setJdTemplateVersion(typeof parsed.templateVersion === 'string' ? parsed.templateVersion : null);
    setJdWarnings(parsed.warnings || []);
    const review = parsed.review;
    if (!review) {
      // LLM unavailable/failed: text was still extracted (see warnings).
      // HR continues manually; nothing was saved.
      setJdResult(
        `Could not run AI extraction on ${parsed.filename}. ` +
        'You can continue filling the form manually — nothing was saved.'
      );
      return;
    }
    prefillFromReview(review.values as Record<string, unknown>);
    const aiExtract = (parsed.aiExtract as Record<string, unknown> | null | undefined) || null;
    const reviewEvidence = (review.evidence as Record<string, string> | undefined)
      || (parsed.evidence as Record<string, string>) || {};
    setAiReview({
      values: review.values as Record<string, unknown>,
      missingFields: review.missingFields || [],
      needsReview: review.needsReview || [],
      fieldErrors: review.fieldErrors || [],
      warnings: review.warnings || [],
      resolvedAssignee: review.resolvedAssignee || null,
      evidence: reviewEvidence,
      assigneeText: aiExtract && typeof aiExtract.assigneeText === 'string'
        ? aiExtract.assigneeText
        : null,
    });
    const extracted = Object.keys(review.values || {}).length;
    const needs = (review.needsReview || []).length;
    const missing = (review.missingFields || []).length;
    setJdResult(
      `AI extraction complete from ${file.name}: ${extracted} fields extracted` +
      (needs > 0 ? `, ${needs} need review` : '') +
      (missing > 0 ? `, ${missing} missing` : '') +
      '. Review them below before saving — nothing has been saved yet.'
    );
  }

  /** AI note (field error or needs-review reason) for a Draft field, if any. */
  function aiNoteFor(draftKey: keyof Draft): string | undefined {
    if (!aiReview) return undefined;
    const notes: string[] = [];
    for (const [backendField, mapped] of Object.entries(BACKEND_TO_DRAFT)) {
      if (mapped !== draftKey) continue;
      for (const fe of aiReview.fieldErrors) {
        if (fe.field === backendField) notes.push(fe.message);
      }
      for (const nr of aiReview.needsReview) {
        if (nr.field === backendField) notes.push(nr.reason);
      }
    }
    return notes.length > 0 ? notes.join(' ') : undefined;
  }

  const aiBadgeFor = (draftKey: keyof Draft) =>
    aiFields.includes(draftKey) ? <AiBadge /> : undefined;

  function fingerprint(): string {
    return JSON.stringify([
      draft.companyName.trim().toLowerCase(),
      draft.jobRole.trim().toLowerCase(),
      draft.department.trim().toLowerCase(),
      draft.location.trim().toLowerCase(),
    ]);
  }

  async function doCreate(): Promise<boolean> {
    setSubmitting(true);
    setApiError(null);
    try {
      const job = await createJob({
        jobKey: draft.jobKey.trim(),
        title: draft.title.trim(),
        companyName: draft.companyName.trim(),
        jobRole: draft.jobRole.trim(),
        department: draft.department.trim(),
        minExperienceYears: Number(draft.minExperience),
        maxExperienceYears: Number(draft.maxExperience),
        positionsTotal: Number(draft.positions),
        keywords: draft.keywords,
        openedAt: draft.openedAt ? new Date(draft.openedAt).toISOString() : null,
        closesAt: new Date(draft.closesAt).toISOString(),
        assigneeUserId: draft.assigneeUserId,
        workMode: draft.workMode || null,
        location: draft.location.trim() || null,
        jdHtml: draft.jdHtml,
        jdTemplateVersion: jdTemplateVersion,
      });
      setCreated(job);
      onCreated(job);
      return true;
    } catch (e) {
      // Data is preserved: nothing is cleared on failure.
      setApiError(e instanceof Error ? e.message : 'Job creation failed.');
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting || checkingDup || created) return;
    const errors = validate(draft, rules);
    setSubmitErrors(errors);
    setTouched(Object.fromEntries(Object.keys(draft).map((k) => [k, true])));
    if (Object.keys(errors).length > 0) return;
    const fp = fingerprint();
    if (dupConfirmedFor !== fp) {
      setCheckingDup(true);
      try {
        const dup = await checkDuplicate({
          companyName: draft.companyName.trim() || undefined,
          jobRole: draft.jobRole.trim() || undefined,
          department: draft.department.trim() || undefined,
          location: draft.location.trim() || undefined,
        });
        if (dup.count > 0) {
          setDupList(dup.similarJobs);
          return;
        }
      } catch {
        // Duplicate check is advisory: a failed check must not block creation.
      } finally {
        setCheckingDup(false);
      }
    }
    await doCreate();
  }

  async function onDownloadTemplate() {
    setDownloadingTemplate(true);
    try {
      const blob = await downloadJdTemplate();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'elite-hr-jd-template.docx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setJdResult(e instanceof Error ? e.message : 'Template download failed.');
    } finally {
      setDownloadingTemplate(false);
    }
  }

  function onBack() {
    if (dirty) {
      setConfirmLeave(true);
      return;
    }
    onExit();
  }

  function toLocalInput(iso: string | null): string {
    if (!iso || typeof iso !== 'string') return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  if (created) {
    return (
      <div className="mx-auto max-w-xl rounded-[1.25rem] border border-border bg-card p-8 text-center shadow-[var(--shadow-card)]">
        <div aria-hidden className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--success-soft)] text-[var(--success)]">
          ✓
        </div>
        <h2 className="text-[20px] font-extrabold tracking-tight">Job created successfully.</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {created.jobKey} · {created.title} · {created.lifecycleStatus}
        </p>
        <PAButton className="mt-5" onClick={onExit}>Back to Jobs</PAButton>
      </div>
    );
  }

  const err = (k: keyof Draft) => submitErrors[k] || liveErrors[k];

  return (
    <div className="space-y-5" aria-label="Create job">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="eyebrow">Hiring pipeline</div>
          <h1 className="text-[24px] font-extrabold tracking-tight">Create Job</h1>
          <p className="text-[13px] text-muted-foreground">A new requisition starts as a draft and never accepts applications until opened.</p>
        </div>
        <PAButton variant="secondary" onClick={onBack} type="button">← Back to Jobs</PAButton>
      </div>

      {/* ── JD upload ── */}
      <section aria-label="Upload JD" className="rounded-[1.25rem] border border-border bg-card p-5 shadow-[var(--shadow-card)]">
        <h2 className="text-[14px] font-extrabold">Upload JD <span className="font-semibold text-muted-foreground">(optional)</span></h2>
        <p className="mt-1 text-[12.5px] text-muted-foreground">
          Upload a JD to extract its fields into this form for review. Nothing is saved on upload.
        </p>
        <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="JD upload type">
          <button
            type="button"
            role="radio"
            aria-checked={jdMode === 'template'}
            onClick={() => setJdMode('template')}
            disabled={jdParsing}
            className={`rounded-[10px] border px-3.5 py-2 text-xs font-bold shadow-[var(--shadow-card)] transition-all disabled:opacity-50 ${jdMode === 'template' ? 'border-[var(--ring)] bg-[var(--primary-soft)]' : 'border-border bg-card hover:border-[var(--ring)]'}`}
          >
            JD Template
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={jdMode === 'document'}
            onClick={() => setJdMode('document')}
            disabled={jdParsing}
            className={`rounded-[10px] border px-3.5 py-2 text-xs font-bold shadow-[var(--shadow-card)] transition-all disabled:opacity-50 ${jdMode === 'document' ? 'border-[var(--ring)] bg-[var(--primary-soft)]' : 'border-border bg-card hover:border-[var(--ring)]'}`}
          >
            JD Document
            <span className="ml-1.5 inline-flex items-center rounded-full bg-[var(--warning-soft)] px-2 py-0.5 align-middle text-[10px] font-bold text-[var(--warning)]">
              AI-assisted
            </span>
          </button>
        </div>
        <p className="mt-2 text-[12px] text-muted-foreground">
          {jdMode === 'template'
            ? 'Upload the completed prescribed template for deterministic extraction.'
            : 'Upload a normal JD PDF/DOCX. AI extracts the fields; you review everything before saving.'}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-[10px] bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground shadow-[var(--shadow-card)] transition-all hover:-translate-y-0.5">
            {jdParsing ? 'Extracting…' : jdMode === 'document' ? 'Upload JD Document' : 'Upload JD'}
            <input
              type="file"
              accept=".pdf,.docx,.doc"
              className="sr-only"
              disabled={jdParsing}
              onChange={(e) => void handleJdFile(e.target.files?.[0] ?? null)}
              aria-label="Upload JD file"
            />
          </label>
          <button
            type="button"
            onClick={() => void onDownloadTemplate()}
            disabled={downloadingTemplate}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-[10px] border border-border bg-card px-4 py-2.5 text-xs font-bold shadow-[var(--shadow-card)] transition-all hover:-translate-y-0.5 hover:border-[var(--ring)] disabled:opacity-50"
          >
            {downloadingTemplate ? 'Preparing…' : 'Download JD template'}
          </button>
          {jdFile && <span className="text-[12px] text-muted-foreground">{jdFile.name}</span>}
        </div>
        {jdParsing && (
          <div className="mt-3" role="status" aria-label="JD processing stages">
            <p className="text-[12px] font-bold">Processing JD — validating, extracting text and analyzing…</p>
            <ol className="mt-1.5 space-y-1 text-[12px] text-muted-foreground">
              {['Uploading JD', 'Validating document', 'Extracting text', 'Analyzing JD', 'Preparing review'].map((stage) => (
                <li key={stage} className="flex items-center gap-2">
                  <span aria-hidden className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--warning)]" />
                  {stage}
                </li>
              ))}
            </ol>
          </div>
        )}
        {jdResult && (
          <p role={jdResult.startsWith('Extracted') || jdResult.startsWith('AI extraction complete') ? 'status' : 'alert'}
            className="mt-2 text-[12.5px] font-medium text-foreground">
            {jdResult}
          </p>
        )}
        {jdWarnings.length > 0 && (
          <ul className="mt-1 space-y-0.5 text-[12px] text-muted-foreground">
            {jdWarnings.map((w) => <li key={w}>• {w}</li>)}
          </ul>
        )}
      </section>

      {/* ── AI review ── */}
      {aiReview && (
        <section aria-label="AI review" className="rounded-[1.25rem] border border-border bg-card p-5 shadow-[var(--shadow-card)]">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[14px] font-extrabold">AI extraction review</h2>
            <span className="inline-flex items-center rounded-full bg-[var(--warning-soft)] px-2 py-0.5 text-[10px] font-bold text-[var(--warning)]">
              AI-assisted extraction
            </span>
          </div>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            AI proposed these values — HR reviews and corrects them below. Nothing is saved until you submit.
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4" aria-label="Extraction summary">
            {[
              { label: 'Fields extracted', value: aiFields.length },
              { label: 'Needs review', value: aiReview.needsReview.length },
              { label: 'Missing', value: aiReview.missingFields.length },
              { label: 'Warnings', value: aiReview.warnings.length },
            ].map((s) => (
              <div key={s.label} className="rounded-[10px] border border-border bg-[var(--primary-soft)]/50 px-3 py-2">
                <dt className="text-[11px] font-bold text-muted-foreground">{s.label}</dt>
                <dd className="text-[18px] font-extrabold">{s.value}</dd>
              </div>
            ))}
          </dl>
          {aiReview.missingFields.length > 0 && (
            <div className="mt-3">
              <h3 className="text-[12px] font-extrabold">Needs input</h3>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {aiReview.missingFields.map((f) => (
                  <li key={f} className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[12px] font-bold">
                    {aiFieldLabel(f)}
                    <span className="text-[10px] font-bold uppercase text-muted-foreground">missing</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {aiReview.needsReview.length > 0 && (
            <div className="mt-3">
              <h3 className="text-[12px] font-extrabold">Needs review</h3>
              <ul className="mt-1 space-y-1.5">
                {aiReview.needsReview.map((n, i) => (
                  <li key={`${n.field}-${i}`} className="rounded-[10px] border border-[var(--warning)]/30 bg-[var(--warning-soft)] px-3 py-2 text-[12px]">
                    <span className="font-bold">⚠ {aiFieldLabel(n.field)}: </span>
                    <span className="text-foreground/80">{n.reason}</span>
                    {n.field === 'assigneeUserId' && aiReview.assigneeText && (
                      <span className="block text-foreground/80">Extracted text: “{aiReview.assigneeText}” — please select the correct active user below.</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {aiReview.warnings.length > 0 && (
            <ul className="mt-3 space-y-0.5 text-[12px] text-muted-foreground" aria-label="AI warnings">
              {aiReview.warnings.map((w) => <li key={w}>• {w}</li>)}
            </ul>
          )}
          {aiReview.resolvedAssignee && (
            <p className="mt-3 rounded-[10px] border border-border bg-[var(--success-soft)]/60 px-3 py-2 text-[12px]">
              <span className="font-bold">Assignee resolved: </span>
              {aiReview.resolvedAssignee.name} · {aiReview.resolvedAssignee.email}
            </p>
          )}
          {Object.keys(aiReview.evidence).length > 0 && (
            <details className="mt-3 rounded-[10px] border border-border px-3 py-2 text-[12px]">
              <summary className="cursor-pointer font-bold">Source evidence ({Object.keys(aiReview.evidence).length})</summary>
              <dl className="mt-2 space-y-1.5">
                {Object.entries(aiReview.evidence).map(([field, snippet]) => (
                  <div key={field}>
                    <dt className="font-bold">{aiFieldLabel(field)}</dt>
                    <dd className="text-muted-foreground">“{snippet}”</dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
        </section>
      )}

      <form onSubmit={(e) => void onSubmit(e)} noValidate className="space-y-5">
        {/* ── Identity ── */}
        <section aria-label="Job identity" className="rounded-[1.25rem] border border-border bg-card p-5 shadow-[var(--shadow-card)]">
          <h2 className="mb-3 text-[14px] font-extrabold">Job information</h2>
          <div className="grid gap-3.5 md:grid-cols-2">
            <div className="rounded-[10px] border border-dashed border-border bg-[var(--primary-soft)]/50 px-3 py-2 text-[12.5px]">
              <span className="font-bold">Job ID:</span>{' '}
              <span className="text-muted-foreground">Auto-generated on save (read-only)</span>
            </div>
            <Field label="Job Key" required error={err('jobKey')} hint="Unique human reference, e.g. ACME-BE-2026-01">
              <input value={draft.jobKey} onChange={(e) => set('jobKey', e.target.value)}
                placeholder="ACME-BE-2026-01" className="ehr-input px-3 py-2 text-[13.5px]" aria-label="Job Key" />
            </Field>
            <Field label="Company Name" required error={err('companyName')} badge={aiBadgeFor('companyName')} aiNote={aiNoteFor('companyName')}>
              <input value={draft.companyName} onChange={(e) => set('companyName', e.target.value)}
                placeholder="Acme Pvt Ltd" className="ehr-input px-3 py-2 text-[13.5px]" aria-label="Company Name" />
            </Field>
            <Field label="Job Role" required error={err('jobRole')} badge={aiBadgeFor('jobRole')} aiNote={aiNoteFor('jobRole')}>
              <input value={draft.jobRole} onChange={(e) => set('jobRole', e.target.value)}
                placeholder="Backend Engineer" className="ehr-input px-3 py-2 text-[13.5px]" aria-label="Job Role" />
            </Field>
            <Field label="Job Title" required error={err('title')} badge={aiBadgeFor('title')} aiNote={aiNoteFor('title')}>
              <input value={draft.title} onChange={(e) => set('title', e.target.value)}
                placeholder="Senior Backend Engineer" className="ehr-input px-3 py-2 text-[13.5px]" aria-label="Job Title" />
            </Field>
            <Field label="Department" required error={err('department')} badge={aiBadgeFor('department')} aiNote={aiNoteFor('department')}>
              {rules && rules.departments.length > 0 ? (
                <select value={draft.department} onChange={(e) => set('department', e.target.value)}
                  className="ehr-input px-3 py-2 text-[13.5px]" aria-label="Department">
                  <option value="">Select department</option>
                  {rules.departments.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              ) : (
                <input value={draft.department} onChange={(e) => set('department', e.target.value)}
                  placeholder="Engineering" className="ehr-input px-3 py-2 text-[13.5px]" aria-label="Department" />
              )}
            </Field>
            <Field label="Minimum Experience (years)" required error={err('minExperience')} hint="Whole months only, e.g. 2.5 = 2y 6m (2.55 not allowed)" badge={aiBadgeFor('minExperience')} aiNote={aiNoteFor('minExperience')}>
              <input value={draft.minExperience} onChange={(e) => set('minExperience', e.target.value)}
                placeholder="2" inputMode="decimal" className="ehr-input px-3 py-2 text-[13.5px]" aria-label="Minimum Experience" />
            </Field>
            <Field label="Maximum Experience (years)" required error={err('maxExperience')} hint="Whole months only, e.g. 2.5 = 2y 6m (2.55 not allowed)" badge={aiBadgeFor('maxExperience')} aiNote={aiNoteFor('maxExperience')}>
              <input value={draft.maxExperience} onChange={(e) => set('maxExperience', e.target.value)}
                placeholder="5" inputMode="decimal" className="ehr-input px-3 py-2 text-[13.5px]" aria-label="Maximum Experience" />
            </Field>
            <Field label="Number of Positions" required error={err('positions')} hint="Positive whole number only" badge={aiBadgeFor('positions')} aiNote={aiNoteFor('positions')}>
              <input value={draft.positions} onChange={(e) => set('positions', e.target.value)}
                placeholder="3" inputMode="numeric" className="ehr-input px-3 py-2 text-[13.5px]" aria-label="Number of Positions" />
            </Field>
          </div>
          <div className="mt-3.5">
            <span className="text-[12px] font-bold">Keywords <span className="font-normal text-muted-foreground">(recommended, max {MAX_KEYWORDS})</span>
              {aiFields.includes('keywords') && <AiBadge />}
            </span>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {draft.keywords.map((k) => (
                <span key={k.toLowerCase()} className="inline-flex items-center gap-1 rounded-full bg-[var(--primary-soft)] px-2.5 py-1 text-[12px] font-bold">
                  {k}
                  <button type="button" onClick={() => set('keywords', draft.keywords.filter((x) => x !== k))}
                    aria-label={`Remove keyword ${k}`} className="cursor-pointer text-muted-foreground hover:text-foreground">×</button>
                </span>
              ))}
            </div>
            <div className="mt-1.5 flex gap-2">
              <input value={keywordInput} onChange={(e) => { setKeywordInput(e.target.value); setKeywordHint(null); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault();
                    addKeyword(keywordInput);
                  }
                }}
                placeholder="Type a keyword, press Enter"
                className="ehr-input flex-1 px-3 py-2 text-[13.5px]" aria-label="Add keyword" />
              <PAButton variant="secondary" type="button" onClick={() => addKeyword(keywordInput)}>Add</PAButton>
            </div>
            {keywordHint && <p className="mt-1 text-[12px] font-medium text-[var(--warning)]">{keywordHint}</p>}
            {aiNoteFor('keywords') && <p className="mt-1 text-[12px] font-medium text-[var(--warning)]">⚠ {aiNoteFor('keywords')}</p>}
          </div>
        </section>

        {/* ── Assignment + dates ── */}
        <section aria-label="Assignment and dates" className="rounded-[1.25rem] border border-border bg-card p-5 shadow-[var(--shadow-card)]">
          <h2 className="mb-3 text-[14px] font-extrabold">Assignment &amp; schedule</h2>
          <div className="grid gap-3.5 md:grid-cols-2">
            <Field label="Assignee" required error={err('assigneeUserId') || dirError || undefined} badge={aiBadgeFor('assigneeUserId')} aiNote={aiNoteFor('assigneeUserId')}>
              <select value={draft.assigneeUserId} onChange={(e) => set('assigneeUserId', e.target.value)}
                className="ehr-input cursor-pointer px-3 py-2 text-[13.5px]" aria-label="Assignee">
                <option value="">Select an active user…</option>
                {directory.map((u) => (
                  <option key={u.userId} value={u.userId}>{u.name} · {u.email}</option>
                ))}
              </select>
            </Field>
            <div className="flex flex-col gap-1 text-[12px] font-bold">
              <span>Assignee Email <span className="font-normal text-muted-foreground">(auto-populated)</span></span>
              <input value={assigneeEmail} readOnly aria-readonly aria-label="Assignee Email"
                placeholder="Select an assignee first"
                className="ehr-input cursor-not-allowed bg-muted px-3 py-2 text-[13.5px]" />
            </div>
            <Field label="Opened At" required error={err('openedAt')} badge={aiBadgeFor('openedAt')} aiNote={aiNoteFor('openedAt')}>
              <input type="datetime-local" value={draft.openedAt} onChange={(e) => set('openedAt', e.target.value)}
                className="ehr-input px-3 py-2 text-[13.5px]" aria-label="Opened At" />
            </Field>
            <Field label="Closes At" required error={err('closesAt')} badge={aiBadgeFor('closesAt')} aiNote={aiNoteFor('closesAt')}>
              <input type="datetime-local" value={draft.closesAt} onChange={(e) => set('closesAt', e.target.value)}
                className="ehr-input px-3 py-2 text-[13.5px]" aria-label="Closes At" />
            </Field>
            <Field label="Work Mode (optional)" badge={aiBadgeFor('workMode')} aiNote={aiNoteFor('workMode')}>
              <select value={draft.workMode} onChange={(e) => set('workMode', e.target.value)}
                className="ehr-input cursor-pointer px-3 py-2 text-[13.5px]" aria-label="Work Mode">
                <option value="">Not specified</option>
                <option value="ONSITE">On-site</option>
                <option value="REMOTE">Remote</option>
                <option value="HYBRID">Hybrid</option>
              </select>
            </Field>
            <Field label="Location (optional)" badge={aiBadgeFor('location')} aiNote={aiNoteFor('location')}>
              <input value={draft.location} onChange={(e) => set('location', e.target.value)}
                placeholder="Hyderabad" className="ehr-input px-3 py-2 text-[13.5px]" aria-label="Location" />
            </Field>
          </div>
        </section>

        {/* ── JD ── */}
        <section aria-label="Job description" className="rounded-[1.25rem] border border-border bg-card p-5 shadow-[var(--shadow-card)]">
          <h2 className="mb-3 text-[14px] font-extrabold">Job Description <span className="text-red-500" aria-hidden>*</span>
            {aiFields.includes('jdHtml') && <AiBadge />}
          </h2>
          <JdEditor value={draft.jdHtml} onChange={(html) => set('jdHtml', html)} describedBy="jd-limits" />
          <p id="jd-limits" className="mt-1 text-[11.5px] text-muted-foreground">
            Headings, bold/italic, bullets, quotes and links supported. Paste from anywhere — formatting is preserved.
          </p>
          {(submitErrors.jdHtml || liveErrors.jdHtml) && (
            <p role="alert" className="mt-1 text-[12px] font-medium text-red-600">
              {submitErrors.jdHtml || liveErrors.jdHtml}
            </p>
          )}
          {aiNoteFor('jdHtml') && (
            <p className="mt-1 text-[12px] font-medium text-[var(--warning)]">⚠ {aiNoteFor('jdHtml')}</p>
          )}
        </section>

        {apiError && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-[12.5px] font-medium text-red-700">
            {apiError} Your entered data is preserved.
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <PAButton variant="secondary" type="button" onClick={onBack}>Cancel</PAButton>
          <PAButton type="submit" disabled={submitting || checkingDup}>
            {submitting ? 'Creating…' : checkingDup ? 'Checking…' : 'Create job'}
          </PAButton>
        </div>
      </form>

      {/* ── Duplicate warning ── */}
      {dupList !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="alertdialog"
          aria-modal="true" aria-labelledby="dup-title" aria-describedby="dup-desc">
          <div className="absolute inset-0 bg-black/30" aria-hidden />
          <div className="relative w-full max-w-md rounded-[1.25rem] border border-border bg-card p-5 shadow-xl">
            <h3 id="dup-title" className="text-[16px] font-extrabold">A similar job already exists. Do you want to continue?</h3>
            <ul id="dup-desc" className="mt-3 max-h-48 space-y-1.5 overflow-y-auto">
              {dupList.map((j) => (
                <li key={j.jobId} className="rounded-lg border border-border px-3 py-2 text-[12.5px]">
                  <span className="font-bold">{j.title}</span>
                  <span className="text-muted-foreground"> · {j.companyName} · {j.jobKey} · {j.lifecycleStatus}</span>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex justify-end gap-2">
              <PAButton variant="secondary" type="button" onClick={() => setDupList(null)}>Back</PAButton>
              <PAButton
                type="button"
                disabled={submitting}
                onClick={() => {
                  setDupConfirmedFor(fingerprint());
                  setDupList(null);
                  void doCreate();
                }}
              >
                {submitting ? 'Creating…' : 'Continue anyway'}
              </PAButton>
            </div>
          </div>
        </div>
      )}

      {/* ── Unsaved changes ── */}
      {confirmLeave && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="alertdialog"
          aria-modal="true" aria-labelledby="leave-title">
          <div className="absolute inset-0 bg-black/30" aria-hidden />
          <div className="relative w-full max-w-sm rounded-[1.25rem] border border-border bg-card p-5 shadow-xl">
            <h3 id="leave-title" className="text-[16px] font-extrabold">You have unsaved changes. Are you sure you want to leave?</h3>
            <div className="mt-4 flex justify-end gap-2">
              <PAButton variant="secondary" type="button" onClick={() => setConfirmLeave(false)}>Stay</PAButton>
              <PAButton type="button" onClick={onExit}>Discard Changes</PAButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
