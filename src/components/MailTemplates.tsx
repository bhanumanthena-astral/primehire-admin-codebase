/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { MailTemplate } from '../types';
import { Mail, Plus, Edit2, Save, Eye, Sparkles, CheckCheck, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { SectionHeader, Panel, PanelTitle, Pill, PAButton, IconSquare, EmptyNote } from './ui/primitives';
import { cn } from '@/lib/utils';

interface MailTemplatesProps {
  templates: MailTemplate[];
  searchQuery?: string;
  onSaveTemplate: (template: MailTemplate, isNew: boolean) => Promise<void>;
  onDeleteTemplate: (id: string) => Promise<void>;
}

const TYPE_META: Record<string, { label: string; tone: 'info' | 'warning' | 'success'; icon: string }> = {
  STANDARD_INVITATION: { label: 'Invitation', tone: 'info', icon: '✉️' },
  REMINDER: { label: 'Reminder', tone: 'warning', icon: '⏰' },
  CUSTOM: { label: 'Custom', tone: 'success', icon: '✏️' },
};

export default function MailTemplates({ templates, searchQuery = '', onSaveTemplate, onDeleteTemplate }: MailTemplatesProps) {
  const filteredTemplates = templates.filter(tpl => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return tpl.name.toLowerCase().includes(q) || tpl.subject.toLowerCase().includes(q) || tpl.body.toLowerCase().includes(q);
  });
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(templates[0]?.id || '');
  const [isEditing, setIsEditing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [draftId, setDraftId] = useState('');
  const [copiedVar, setCopiedVar] = useState<string | null>(null);

  const [editSubject, setEditSubject] = useState('');
  const [editBody, setEditBody] = useState('');
  const [editName, setEditName] = useState('');

  const sampleData: Record<string, string> = {
    '{{candidate_name}}': 'Leonard Hofstadter',
    '{{link}}': 'https://primehire-test.com/interview/tech-leonard-9a8b1',
    '{{password}}': 'PRIME-A9F8E7',
    '{{start_time}}': '7/1/2026, 9:00:00 AM',
    '{{end_time}}': '7/1/2026, 12:00:00 PM',
    '{{round_type}}': 'TECHNICAL',
    '{{job_title}}': 'Principal Software Engineer',
    '{{company}}': 'PrimeHire Solutions',
  };

  const variables = Object.keys(sampleData);
  const selectedTemplate = templates.find(t => t.id === selectedTemplateId);

  useEffect(() => {
    if (!isCreating && !templates.some(t => t.id === selectedTemplateId)) {
      setSelectedTemplateId(templates[0]?.id || '');
      setIsEditing(false);
      setConfirmingDelete(false);
    }
  }, [templates, selectedTemplateId, isCreating]);

  const startEdit = () => {
    if (!selectedTemplate) return;
    setEditName(selectedTemplate.name);
    setEditSubject(selectedTemplate.subject);
    setEditBody(selectedTemplate.body);
    setIsEditing(true);
    setIsCreating(false);
  };

  const startCreate = () => {
    setDraftId('tpl-custom-' + crypto.randomUUID());
    setEditName('New Custom Template');
    setEditSubject('Subject: Assessment Invitation');
    setEditBody(`Hi {{candidate_name}},\n\nWrite your custom message here.\n\nAccess parameters:\nLink: {{link}}\nPassword: {{password}}`);
    setIsEditing(true);
    setIsCreating(true);
  };

  const insertVariable = (v: string) => {
    setEditBody(prev => prev + ' ' + v);
    setCopiedVar(v);
    setTimeout(() => setCopiedVar(null), 1500);
    toast.info(`Inserted: ${v}`);
  };

  const handleSave = async () => {
    if (isSaving) return;
    if (!editName.trim() || !editSubject.trim() || !editBody.trim()) {
      toast.error('All fields (Name, Subject, Body) are mandatory.');
      return;
    }
    const updated: MailTemplate = {
      id: isCreating ? draftId : selectedTemplateId,
      name: editName,
      type: isCreating ? 'CUSTOM' : (selectedTemplate?.type || 'CUSTOM'),
      subject: editSubject,
      body: editBody,
    };
    setIsSaving(true);
    try {
      await onSaveTemplate(updated, isCreating);
      setSelectedTemplateId(updated.id);
      setIsEditing(false);
      setIsCreating(false);
    } catch { /* The parent displays the server error; keep the draft open. */ }
    finally { setIsSaving(false); }
  };

  const getPreview = (subj: string, bdy: string) => {
    let s = subj; let b = bdy;
    Object.entries(sampleData).forEach(([k, v]) => { s = s.replaceAll(k, v); b = b.replaceAll(k, v); });
    return { subject: s, body: b };
  };

  const preview = isEditing
    ? getPreview(editSubject, editBody)
    : selectedTemplate ? getPreview(selectedTemplate.subject, selectedTemplate.body) : { subject: '', body: '' };

  return (
    <div className="space-y-6 text-foreground font-sans">
      <SectionHeader
        eyebrow="Communication templates"
        title="Mail Templates & Customizer"
        subtitle="Standardize candidate outreach, construct reminder sequences, and preview live simulations."
        icon={<Mail className="w-5 h-5" />}
        action={
          !isEditing ? (
            <PAButton onClick={startCreate} disabled={isDeleting} className="shrink-0">
              <Plus className="w-4 h-4" /> Custom Template
            </PAButton>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Template list — selectable cards */}
        <div className="lg:col-span-1 space-y-2.5">
          <span className="eyebrow block">Available Templates</span>
          <div className="space-y-2" role="listbox" aria-label="Templates">
            {filteredTemplates.length === 0 ? (
              <div className="rounded-xl border border-border/70 bg-card p-6 text-center space-y-1">
                <p className="text-xs font-semibold text-foreground">No templates found</p>
                <p className="text-[11px] text-muted-foreground">{searchQuery ? `No templates match "${searchQuery}".` : 'Create a custom template to get started.'}</p>
              </div>
            ) : (
              filteredTemplates.map((tpl) => {
                const isSelected = tpl.id === selectedTemplateId;
                const meta = TYPE_META[tpl.type] || TYPE_META.CUSTOM;
                return (
                  <button
                    key={tpl.id}
                    disabled={isSaving || isDeleting}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => { setSelectedTemplateId(tpl.id); setIsEditing(false); setIsCreating(false); setConfirmingDelete(false); }}
                    className={cn(
                      'w-full text-left p-4 rounded-2xl border transition-all duration-200 flex items-start gap-3 cursor-pointer focus-visible:ring-2 focus-visible:ring-ring/40',
                      isSelected
                        ? 'bg-primary-soft border-primary shadow-[var(--shadow-card)] -translate-y-0.5'
                        : 'bg-card border-border/70 shadow-[var(--shadow-card)] hover:-translate-y-0.5 hover:border-primary/40'
                    )}
                  >
                    <div className={cn(
                      'w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-sm border',
                      isSelected ? 'bg-gradient-primary text-primary-foreground border-transparent' : 'bg-accent/10 text-accent border-accent/15'
                    )}>
                      {isSelected ? <Mail className="w-4 h-4" /> : <span>{meta.icon}</span>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm truncate text-foreground">
                        {tpl.name}
                      </div>
                      <div className="mt-1.5">
                        <Pill tone={meta.tone}><span className="uppercase tracking-wide text-[10px]">{meta.label}</span></Pill>
                      </div>
                    </div>
                    {isSelected && <div className="w-2 h-2 rounded-full bg-primary mt-2 shrink-0 animate-pulse" />}
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Editor + Preview */}
        <div className="lg:col-span-2">
          {selectedTemplate || isCreating ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Editor */}
              <Panel className="space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-border/60">
                  <span className="eyebrow">
                    {isEditing ? 'Editing Template' : 'Template Details'}
                  </span>
                  {!isEditing ? (
                    <div className="flex items-center gap-3">
                      <button
                        onClick={startEdit}
                        disabled={isDeleting}
                        className="text-xs font-semibold inline-flex items-center gap-1 text-accent hover:opacity-80 cursor-pointer transition"
                      >
                        <Edit2 className="w-3.5 h-3.5" /> Edit
                      </button>
                      <button
                        onClick={async () => {
                          if (!selectedTemplate || isDeleting) return;
                          if (!confirmingDelete) {
                            setConfirmingDelete(true);
                            return;
                          }
                          setConfirmingDelete(false);
                          setIsDeleting(true);
                          try { await onDeleteTemplate(selectedTemplate.id); }
                          catch { /* The parent displays the server error. */ }
                          finally { setIsDeleting(false); }
                        }}
                        disabled={isDeleting}
                        onBlur={() => setConfirmingDelete(false)}
                        className="text-xs font-semibold inline-flex items-center gap-1 text-destructive hover:opacity-80 cursor-pointer transition"
                        title={confirmingDelete ? 'Click again to confirm deletion' : 'Delete this template'}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        {isDeleting ? 'Deleting...' : confirmingDelete ? 'Confirm delete?' : 'Delete'}
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <PAButton onClick={handleSave} disabled={isSaving} className="!px-3 !py-1.5">
                        <Save className="w-3.5 h-3.5" /> {isSaving ? 'Saving...' : 'Save'}
                      </PAButton>
                      <PAButton variant="secondary" disabled={isSaving} onClick={() => { setIsEditing(false); setIsCreating(false); }} className="!px-3 !py-1.5">
                        Cancel
                      </PAButton>
                    </div>
                  )}
                </div>

                {isEditing ? (
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <label className="eyebrow block">Template Name</label>
                      <input
                        value={editName}
                        disabled={isSaving}
                        onChange={(e) => setEditName(e.target.value)}
                        placeholder="e.g. Follow-up Invitation"
                        className="w-full text-sm font-semibold px-4 py-2 rounded-full border border-border/70 bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40 shadow-[var(--shadow-card)]"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="eyebrow block">Email Subject</label>
                      <input
                        value={editSubject}
                        disabled={isSaving}
                        onChange={(e) => setEditSubject(e.target.value)}
                        placeholder="Subject Line"
                        className="w-full text-sm font-semibold px-4 py-2 rounded-full border border-border/70 bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40 shadow-[var(--shadow-card)]"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex justify-between items-center">
                        <label className="eyebrow block">Email Body</label>
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Plain text</span>
                      </div>
                      <textarea
                        value={editBody}
                        disabled={isSaving}
                        onChange={(e) => setEditBody(e.target.value)}
                        rows={10}
                        className="w-full text-xs font-mono px-4 py-3 rounded-2xl border border-border/70 bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40 resize-none leading-relaxed shadow-[var(--shadow-card)]"
                      />
                    </div>
                    <div className="space-y-2 pt-3 border-t border-border/60">
                      <span className="eyebrow inline-flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5" /> Variable Tokens
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {variables.map((v) => (
                          <button key={v} disabled={isSaving} onClick={() => insertVariable(v)} className="cursor-pointer transition-opacity hover:opacity-80">
                            <Pill tone="info"><span className="font-mono text-[10px]">{copiedVar === v ? `✓ ${v}` : v}</span></Pill>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <span className="eyebrow block">Template Name</span>
                      <div className="text-sm font-semibold text-foreground">{selectedTemplate?.name}</div>
                    </div>
                    <div className="space-y-1">
                      <span className="eyebrow block">Email Subject</span>
                      <div className="text-sm font-medium px-4 py-2.5 rounded-2xl bg-muted/40 border border-border/60 text-foreground">
                        {selectedTemplate?.subject}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <span className="eyebrow block">Raw Body Structure</span>
                      <pre className="text-xs font-mono px-4 py-3 rounded-2xl bg-muted/40 border border-border/60 text-foreground overflow-auto whitespace-pre-wrap leading-relaxed">
                        {selectedTemplate?.body}
                      </pre>
                    </div>
                  </div>
                )}
              </Panel>

              {/* Live preview — solid inner card (never nested glass) */}
              <Panel className="flex flex-col gap-4">
                <div className="flex items-center gap-2 pb-3 border-b border-border/60">
                  <Eye className="w-4 h-4 text-accent" />
                  <span className="eyebrow">Simulated Mail Client</span>
                  <span className="ml-auto"><Pill tone="success"><span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" /> Live Preview</Pill></span>
                </div>
                <div className="flex-1 rounded-2xl border border-border/60 bg-card flex flex-col min-h-[280px] overflow-hidden">
                  <div className="px-4 py-3 space-y-1.5 border-b border-border/60 bg-muted/40">
                    <div className="text-xs flex gap-2">
                      <span className="font-semibold w-14 text-accent shrink-0">From:</span>
                      <span className="text-muted-foreground">PrimeHire Careers &lt;recruitment@primehire.com&gt;</span>
                    </div>
                    <div className="text-xs flex gap-2">
                      <span className="font-semibold w-14 text-accent shrink-0">To:</span>
                      <span className="text-muted-foreground">{sampleData['{{candidate_name}}']} &lt;l.hofstadter@caltech.edu&gt;</span>
                    </div>
                    <div className="text-xs flex gap-2 mt-1">
                      <span className="font-semibold w-14 text-accent shrink-0">Subject:</span>
                      <span className="font-semibold text-foreground">{preview.subject || '(Empty Subject)'}</span>
                    </div>
                  </div>
                  <div className="flex-1 p-4 overflow-auto whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                    {preview.body || '(Empty Body)'}
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground italic">
                  * Dynamic variables like <strong className="text-accent">{'{{candidate_name}}'}</strong> and <strong className="text-accent">{'{{link}}'}</strong> parse automatically.
                </p>
              </Panel>
            </div>
          ) : (
            <Panel><EmptyNote>No template selected. Click a template from the list on the left.</EmptyNote></Panel>
          )}
        </div>
      </div>
    </div>
  );
}
