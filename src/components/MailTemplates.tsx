/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { MailTemplate } from '../types';
import { Mail, Plus, Edit2, Save, X, Eye, Sparkles, Copy, CheckCheck } from 'lucide-react';
import { toast } from 'sonner';

interface MailTemplatesProps {
  templates: MailTemplate[];
  onSaveTemplate: (template: MailTemplate) => void;
}

const TYPE_META: Record<string, { label: string; pill: string; icon: string }> = {
  STANDARD_INVITATION: { label: 'Invitation',  pill: 'chip-purple', icon: '✉️' },
  REMINDER:            { label: 'Reminder',    pill: 'chip-warning', icon: '⏰' },
  CUSTOM:              { label: 'Custom',      pill: 'chip-positive', icon: '✏️' },
};

export default function MailTemplates({ templates, onSaveTemplate }: MailTemplatesProps) {
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(templates[0]?.id || '');
  const [isEditing, setIsEditing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
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

  const startEdit = () => {
    if (!selectedTemplate) return;
    setEditName(selectedTemplate.name);
    setEditSubject(selectedTemplate.subject);
    setEditBody(selectedTemplate.body);
    setIsEditing(true);
    setIsCreating(false);
  };

  const startCreate = () => {
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

  const handleSave = () => {
    if (!editName.trim() || !editSubject.trim() || !editBody.trim()) {
      toast.error('All fields (Name, Subject, Body) are mandatory.');
      return;
    }
    const updated: MailTemplate = {
      id: isCreating ? 'tpl-custom-' + Math.random().toString(36).substring(2, 7) : selectedTemplateId,
      name: editName,
      type: isCreating ? 'CUSTOM' : (selectedTemplate?.type || 'CUSTOM'),
      subject: editSubject,
      body: editBody,
    };
    onSaveTemplate(updated);
    setIsEditing(false);
    setIsCreating(false);
    setSelectedTemplateId(updated.id);
    toast.success('Template saved successfully!');
  };

  const getPreview = (subj: string, bdy: string) => {
    let s = subj; let b = bdy;
    Object.entries(sampleData).forEach(([k, v]) => { s = s.replaceAll(k, v); b = b.replaceAll(k, v); });
    return { subject: s, body: b };
  };

  const preview = selectedTemplate
    ? getPreview(isEditing ? editSubject : selectedTemplate.subject, isEditing ? editBody : selectedTemplate.body)
    : { subject: '', body: '' };

  return (
    <div className="space-y-6 text-[var(--ink)] font-sans">
      
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex justify-between items-start gap-4">
        <div className="flex items-start gap-3">
          <div className="icon-badge">
            <Mail className="w-5 h-5" />
          </div>
          <div>
            <span className="eyebrow block">COMMUNICATION TEMPLATES</span>
            <h2 className="text-xl sm:text-2xl font-extrabold text-[var(--ink)] tracking-tight">
              Mail Templates & Customizer
            </h2>
            <p className="text-xs text-[var(--muted-ink)] mt-0.5">
              Standardize candidate outreach, construct reminder sequences, and preview live simulations.
            </p>
          </div>
        </div>

        {!isEditing && (
          <button
            onClick={startCreate}
            className="flex items-center gap-1.5 text-xs font-bold px-4 py-2.5 rounded-xl transition cursor-pointer text-white shadow-xs shrink-0 bg-[var(--purple-700)] hover:bg-[var(--purple-600)]"
          >
            <Plus className="w-4 h-4" /> Custom Template
          </button>
        )}
      </div>

      {/* ── Main Grid ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* ── Template List ─────────────────────────────────── */}
        <div className="lg:col-span-1 space-y-2.5">
          <span className="eyebrow block text-[10px]">
            Available Templates
          </span>
          <div className="space-y-2">
            {templates.map((tpl) => {
              const isSelected = tpl.id === selectedTemplateId;
              const meta = TYPE_META[tpl.type] || TYPE_META.CUSTOM;
              return (
                <button
                  key={tpl.id}
                  onClick={() => { setSelectedTemplateId(tpl.id); setIsEditing(false); setIsCreating(false); }}
                  className={`w-full text-left p-3.5 rounded-xl border transition-all flex items-start gap-3 cursor-pointer ${
                    isSelected
                      ? 'bg-[var(--purple-50)] border-[var(--purple-500)] shadow-2xs'
                      : 'bg-white border-[var(--line)] hover:border-slate-300'
                  }`}
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-sm ${
                    isSelected ? 'bg-[var(--purple-700)] text-white' : 'bg-slate-100 text-slate-600'
                  }`}>
                    {isSelected ? <Mail className="w-4 h-4" /> : <span>{meta.icon}</span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-xs truncate text-[var(--ink)]">
                      {tpl.name}
                    </div>
                    <div className="mt-1.5">
                      <span className={`chip ${meta.pill} text-[9px] uppercase tracking-wider`}>
                        {meta.label}
                      </span>
                    </div>
                  </div>
                  {isSelected && <div className="w-2 h-2 rounded-full bg-[var(--purple-600)] mt-2 shrink-0 animate-pulse" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Editor + Preview ──────────────────────────────── */}
        <div className="lg:col-span-2 space-y-5">
          {selectedTemplate ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

              {/* Left: Editor */}
              <div className="ds-card space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-[var(--line)]">
                  <span className="eyebrow text-[10px]">
                    {isEditing ? 'Editing Template' : 'Template Details'}
                  </span>
                  {!isEditing ? (
                    <button
                      onClick={startEdit}
                      className="text-xs font-bold flex items-center gap-1 text-[var(--purple-700)] hover:underline cursor-pointer"
                    >
                      <Edit2 className="w-3.5 h-3.5" /> Edit
                    </button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleSave}
                        className="flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-lg bg-[var(--purple-700)] text-white hover:bg-[var(--purple-600)] transition cursor-pointer shadow-xs"
                      >
                        <Save className="w-3.5 h-3.5" /> Save
                      </button>
                      <button
                        onClick={() => { setIsEditing(false); setIsCreating(false); }}
                        className="text-xs font-bold px-2.5 py-1.5 rounded-lg border border-[var(--line)] text-[var(--muted-ink)] hover:bg-slate-100 cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>

                {isEditing ? (
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <label className="eyebrow block text-[10px]">Template Name</label>
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        placeholder="e.g. Follow-up Invitation"
                        className="w-full text-xs font-bold px-3 py-2 rounded-lg border border-[var(--line)] bg-slate-50 text-[var(--ink)] focus:bg-white focus:outline-hidden"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="eyebrow block text-[10px]">Email Subject</label>
                      <input
                        value={editSubject}
                        onChange={(e) => setEditSubject(e.target.value)}
                        placeholder="Subject Line"
                        className="w-full text-xs font-bold px-3 py-2 rounded-lg border border-[var(--line)] bg-slate-50 text-[var(--ink)] focus:bg-white focus:outline-hidden"
                      />
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between items-center">
                        <label className="eyebrow block text-[10px]">Email Body</label>
                        <span className="text-[9px] text-[var(--muted-ink)]">Plain text</span>
                      </div>
                      <textarea
                        value={editBody}
                        onChange={(e) => setEditBody(e.target.value)}
                        rows={10}
                        className="w-full text-xs font-mono px-3 py-2.5 rounded-lg border border-[var(--line)] bg-slate-50 text-[var(--ink)] focus:bg-white focus:outline-hidden resize-none leading-relaxed"
                      />
                    </div>

                    {/* Variable Tokens */}
                    <div className="space-y-2 pt-3 border-t border-[var(--line)]">
                      <span className="eyebrow-purple flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-[var(--purple-600)]" /> Variable Tokens
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {variables.map((v) => (
                          <button
                            key={v}
                            onClick={() => insertVariable(v)}
                            className="chip chip-purple cursor-pointer text-[9px] hover:opacity-90"
                          >
                            {copiedVar === v ? <span className="inline-flex items-center gap-0.5"><CheckCheck className="w-2.5 h-2.5 inline" /> {v}</span> : v}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <span className="eyebrow block text-[10px]">Template Name</span>
                      <div className="text-sm font-bold text-[var(--ink)]">{selectedTemplate.name}</div>
                    </div>
                    <div className="space-y-1">
                      <span className="eyebrow block text-[10px]">Email Subject</span>
                      <div className="text-xs font-semibold px-3 py-2 rounded-lg bg-slate-50 border border-[var(--line)] text-[var(--ink)]">
                        {selectedTemplate.subject}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <span className="eyebrow block text-[10px]">Raw Body Structure</span>
                      <pre className="text-xs font-mono px-3 py-3 rounded-lg bg-slate-50 border border-[var(--line)] text-slate-700 overflow-x-auto whitespace-pre-wrap leading-relaxed">
                        {selectedTemplate.body}
                      </pre>
                    </div>
                  </div>
                )}
              </div>

              {/* Right: Live Preview */}
              <div className="ds-card flex flex-col space-y-4">
                <div className="flex items-center gap-2 pb-3 border-b border-[var(--line)]">
                  <Eye className="w-4 h-4 text-[var(--purple-600)]" />
                  <span className="eyebrow text-[10px]">
                    Simulated Mail Client
                  </span>
                  <span className="ml-auto chip chip-positive text-[9px]">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live Preview
                  </span>
                </div>

                <div className="flex-1 rounded-xl border border-[var(--line)] bg-slate-50/50 flex flex-col min-h-[280px]">
                  <div className="px-4 py-3 space-y-1.5 border-b border-[var(--line)] bg-white">
                    <div className="text-xs flex gap-2">
                      <span className="font-bold w-14 text-[var(--purple-700)] shrink-0">From:</span>
                      <span className="text-slate-600">PrimeHire Careers &lt;recruitment@primehire.com&gt;</span>
                    </div>
                    <div className="text-xs flex gap-2">
                      <span className="font-bold w-14 text-[var(--purple-700)] shrink-0">To:</span>
                      <span className="text-slate-600">{sampleData['{{candidate_name}}']} &lt;l.hofstadter@caltech.edu&gt;</span>
                    </div>
                    <div className="text-xs flex gap-2 mt-1">
                      <span className="font-bold w-14 text-[var(--purple-700)] shrink-0">Subject:</span>
                      <span className="font-bold text-[var(--ink)]">{preview.subject || '(Empty Subject)'}</span>
                    </div>
                  </div>

                  <div className="flex-1 p-4 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-slate-800 font-sans">
                    {preview.body || '(Empty Body)'}
                  </div>
                </div>

                <p className="text-[10px] text-[var(--muted-ink)] italic">
                  * Dynamic variables like <strong className="text-[var(--purple-700)]">{'{{candidate_name}}'}</strong> and <strong className="text-[var(--purple-700)]">{'{{link}}'}</strong> parse automatically.
                </p>
              </div>
            </div>
          ) : (
            <div className="ds-card p-16 text-center text-xs text-[var(--muted-ink)] italic">
              No template selected. Click a template from the list on the left.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
