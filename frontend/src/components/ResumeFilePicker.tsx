import {Button} from '@/components/ui/button';
import React, {useId, useRef, useState} from 'react';
import {Check, FileText, FolderOpen, UploadCloud, X} from 'lucide-react';
import {PAButton} from './ui/primitives';

const MAX_FILES = 10;
const ACCEPT = '.pdf,.docx,.doc';

export function fileSize(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
}

export function ResumeFilePicker({files, onChange, disabled = false, uploading = false, maxFiles = MAX_FILES, maxMb = 5, accept = ACCEPT, formatLabel = 'PDF, DOCX or DOC', noun = 'resumes', inputLabel = 'Resume files'}: {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
  uploading?: boolean;
  maxFiles?: number;
  maxMb?: number;
  accept?: string;
  formatLabel?: string;
  noun?: string;
  inputLabel?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const depth = useRef(0);
  const titleId = useId();
  const hintId = useId();
  const [dragging, setDragging] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const locked = disabled || uploading;

  function addFiles(incoming: File[]) {
    if (locked) return;
    if (maxFiles === 1 && incoming.length > 1) {
      setErrors(['This mode accepts one file at a time. Choose one file or switch upload mode.']);
      return;
    }
    const next = [...files];
    const rejected: string[] = [];
    for (const file of incoming) {
      if (!accept.split(',').some(ext => file.name.toLowerCase().endsWith(ext.trim().toLowerCase()))) {
        rejected.push(`${file.name}: choose a ${formatLabel} file.`);
      } else if (!file.size) {
        rejected.push(`${file.name}: this file is empty.`);
      } else if (file.size > maxMb * 1024 * 1024) {
        rejected.push(`${file.name}: exceeds the ${maxMb} MB file limit.`);
      } else if (next.some(f => f.name === file.name && f.size === file.size && f.lastModified === file.lastModified)) {
        // Selecting a file twice keeps one copy in the upload list.
        continue;
      } else if (maxFiles === 1) {
        next.splice(0, next.length, file);
      } else if (next.length >= maxFiles) {
        rejected.push(`You can upload up to ${maxFiles} ${noun} at a time. Remove a file to add another.`);
      } else {
        next.push(file);
      }
    }
    setErrors([...new Set(rejected)]);
    onChange(next);
  }

  return <div className="space-y-4">
    <div role="group" aria-labelledby={titleId} aria-describedby={hintId}
      onDragEnter={e => {
        e.preventDefault();
        if (!locked && Array.from(e.dataTransfer.types).includes('Files')) {
          depth.current += 1;
          setDragging(true);
        }
      }}
      onDragOver={e => {e.preventDefault(); e.dataTransfer.dropEffect = locked ? 'none' : 'copy';}}
      onDragLeave={e => {e.preventDefault(); depth.current = Math.max(0, depth.current - 1); if (!depth.current) setDragging(false);}}
      onDrop={e => {e.preventDefault(); depth.current = 0; setDragging(false); addFiles(Array.from(e.dataTransfer.files));}}
      className={`relative flex min-h-64 flex-col items-center justify-center rounded-2xl border-2 border-dashed px-5 py-8 text-center transition-colors sm:min-h-72 ${
        locked ? 'border-border bg-muted/30' : dragging ? 'border-primary bg-primary/15' : 'border-primary/40 bg-primary/5 hover:border-primary/70 hover:bg-primary/10'
      }`}>
      <div className={`mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-primary/20 bg-card shadow-sm ${locked ? 'text-muted-foreground' : 'text-primary'}`}>
        <UploadCloud size={30} strokeWidth={1.5}/>
      </div>
      <h3 id={titleId} className="text-lg font-bold tracking-tight sm:text-xl">
        {uploading ? `Uploading your ${noun}…` : dragging ? `Drop your ${noun} here` : `Drag & drop ${noun} here`}
      </h3>
      <p id={hintId} className="mt-2 max-w-sm text-xs leading-relaxed text-muted-foreground">
        {disabled ? 'Choose an open job with upload access to add resumes.' : `${formatLabel} · ${maxMb} MB per file · up to ${maxFiles} file${maxFiles === 1 ? '' : 's'}.`}
      </p>
      <input ref={input} type="file" multiple={maxFiles > 1} accept={accept} disabled={locked}
        tabIndex={-1} className="sr-only" aria-label={inputLabel}
        onChange={e => {addFiles(Array.from(e.target.files || [])); e.target.value = '';}}/>
      {!uploading && <PAButton type="button" variant="secondary" disabled={locked}
        onClick={() => input.current?.click()} className="mt-5">
        <FolderOpen size={16}/> {files.length && maxFiles === 1 ? 'Replace file' : files.length ? 'Add more files' : 'Browse files'}
      </PAButton>}
      {uploading && <div role="progressbar" aria-label="Uploading resumes" className="mt-5 h-1.5 w-40 overflow-hidden rounded-full bg-primary/15">
        <div className="h-full w-full animate-pulse rounded-full bg-primary motion-reduce:animate-none"/>
      </div>}
    </div>

    {errors.length > 0 && <div role="alert" className="rounded-xl border border-destructive/25 bg-destructive/5 p-3 text-xs text-destructive">
      <ul className="space-y-1">{errors.map(message => <li key={message} className="break-words">{message}</li>)}</ul>
    </div>}

    <div aria-live="polite" className="sr-only">{files.length} resume{files.length === 1 ? '' : 's'} selected.</div>
    {files.length > 0 && <div className="space-y-3" aria-label="Selected resumes">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-bold">Selected files <span className="ml-1 font-medium text-muted-foreground">{files.length} / {maxFiles}</span></p>
        <Button variant="ghost" type="button" disabled={locked} onClick={() => {onChange([]); setErrors([]);}}
          className="text-xs font-semibold text-muted-foreground hover:text-foreground disabled:opacity-50">Clear all</Button>
      </div>
      <ul className="max-h-64 space-y-2 overflow-y-auto overscroll-contain">
        {files.map((file, index) => <li key={`${file.name}-${file.size}-${file.lastModified}`}
          className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><FileText size={19}/></span>
          <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold" title={file.name}>{file.name}</p>
            <p className="mt-1 text-[0.6875rem] text-muted-foreground">{file.name.split('.').pop()?.toUpperCase()} · {fileSize(file.size)}</p></div>
          <Check size={15} className="shrink-0 text-success" aria-hidden/>
          <Button variant="ghost" type="button" aria-label={`Remove ${file.name}`} disabled={locked}
            onClick={() => {onChange(files.filter((_, i) => i !== index)); setErrors([]);}}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"><X size={15}/></Button>
        </li>)}
      </ul>
    </div>}
  </div>;
}
