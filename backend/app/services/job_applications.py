"""Safe display labels for the job's applicant directory (never expose links)."""
import math


def assessment_result(application):
    assessment = application.get('assessment') or {}
    score = assessment.get('score')
    if isinstance(score, (int, float)) and not isinstance(score, bool) and math.isfinite(score):
        return {'score': score, 'label': str(score)}
    status = str(assessment.get('status') or assessment.get('state') or '').lower()
    if assessment.get('reportPending') or status in {'report_pending', 'report pending'}:
        label = 'Report pending'
    elif assessment.get('submittedAt') or assessment.get('completedAt') or status in {'submitted', 'completed', 'assessment_submitted'} or application.get('currentStage') == 'ASSESSMENT_COMPLETED':
        label = 'Assessment submitted'
    elif status in {'failed', 'error'}:
        label = 'Invitation failed'
    elif assessment.get('sentAt') or status in {'email_sent', 'sent', 'link_sent'} or application.get('currentStage') == 'ASSESSMENT_SENT':
        label = 'Assessment link sent'
    elif status in {'send_requested', 'upstream_pending', 'email_queued'}:
        label = 'Invitation queued'
    elif assessment.get('link') or status == 'link_created':
        label = 'Assessment link generated'
    else:
        label = 'Not invited'
    return {'score': None, 'label': label}


def interview_round(application):
    stage = str(application.get('currentStage') or '')
    if stage.startswith('ROUND1') or stage.startswith('TECHNICAL'):
        return 'Technical'
    if stage.startswith('ROUND2') or stage.startswith('MANAGERIAL'):
        return 'Managerial'
    if stage.startswith('HR'):
        return 'HR'
    if stage.startswith('ASSESSMENT'):
        return 'Assessment'
    return 'Not in an interview round'
