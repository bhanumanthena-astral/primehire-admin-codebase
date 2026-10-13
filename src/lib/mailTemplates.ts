import type { AssessmentProfile, Candidate, MailTemplate } from '../types';
import { formatUtcAsIst } from '../utils/istSchedule';

// Standard templates used when no templates have been loaded yet.
export const INITIAL_TEMPLATES: MailTemplate[] = [
  {
    id: 'tpl-invite',
    name: 'Standard Invitation Template',
    type: 'STANDARD_INVITATION',
    subject: 'Interview Invitation: {{job_title}} with {{company}}',
    body: `Hi {{candidate_name}},

You have been invited to complete a {{round_type}} assessment for the {{job_title}} position.

Please use the following credentials to access your interview:
Interview Link: {{link}}
Password: {{password}}

This assessment must be completed between {{start_time}} and {{end_time}}.

Best regards,
The {{company}} Recruitment Team`
  },
  {
    id: 'tpl-reminder',
    name: 'Reminder Template',
    type: 'REMINDER',
    subject: 'Urgent Reminder: Complete your {{job_title}} Assessment',
    body: `Dear {{candidate_name}},

This is a reminder to complete your {{round_type}} assessment for {{job_title}} before it expires.

Access credentials:
Interview Link: {{link}}
Password: {{password}}

Deadline: {{end_time}}

Best of luck,
The {{company}} Recruitment Team`
  }
];

// Helper to substitute variables in mail templates
export function renderTemplate(template: MailTemplate, candidate: Candidate, assessment: AssessmentProfile, company = 'PrimeHire'): { subject: string; body: string } {
  const vars: Record<string, string> = {
    '{{candidate_name}}': candidate.name,
    '{{link}}': candidate.link || 'NO_LINK_GENERATED',
    '{{password}}': candidate.password || 'NO_PASSWORD',
    '{{start_time}}': candidate.startTime ? formatUtcAsIst(candidate.startTime) || 'N/A' : 'N/A',
    '{{end_time}}': candidate.endTime ? formatUtcAsIst(candidate.endTime) || 'N/A' : 'N/A',
    '{{round_type}}': assessment.roundType,
    '{{job_title}}': assessment.jobTitle,
    '{{company}}': company,
  };

  let subject = template.subject;
  let body = template.body;

  Object.entries(vars).forEach(([key, val]) => {
    subject = subject.replaceAll(key, val);
    body = body.replaceAll(key, val);
  });

  return { subject, body };
}

