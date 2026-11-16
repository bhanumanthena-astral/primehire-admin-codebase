import React from 'react';
import type { MailTemplate } from '../types';

export function AssessmentMailPicker({templates, value, onChange, fields}: {
  fields?:Record<string,string>; templates: MailTemplate[]; value: string; onChange: (id: string) => void;
}) {
  const chosen = templates.find(item => item.id === value);
  const preview=(text:string)=>text.replace(/{{(\w+)}}/g,(token,key)=>fields?.[key]??token);
  return <><label className="my-3 block text-sm">Invitation template
    <select className="mt-1 block w-full rounded border bg-background p-2" value={value}
      onChange={event => onChange(event.target.value)}>
      <option value="">Choose a template</option>
      {templates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}
    </select>
  </label>{chosen && <section aria-label="Template preview" className="mb-3 rounded border p-3 text-sm"><strong>{preview(chosen.subject)}</strong><p className="mt-2 whitespace-pre-line">{preview(chosen.body)}</p></section>}</>;
}
