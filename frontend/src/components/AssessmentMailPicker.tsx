import React from 'react';
import type { MailTemplate } from '../types';

export function AssessmentMailPicker({templates, value, onChange}: {
  templates: MailTemplate[]; value: string; onChange: (id: string) => void;
}) {
  return <label className="my-3 block text-sm">Invitation template
    <select className="mt-1 block w-full rounded border bg-background p-2" value={value}
      onChange={event => onChange(event.target.value)}>
      <option value="">Choose a template</option>
      {templates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}
    </select>
  </label>;
}
