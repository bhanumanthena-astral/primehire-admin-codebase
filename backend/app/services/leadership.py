"""Operational hiring intelligence. Durations use actual events, never guessed dates."""
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from math import ceil, floor
from zoneinfo import ZoneInfo

from ..models.leadership import portfolio, RECORD_LIMIT
from .job_pipeline import application_conditions, nonempty, pipeline_counts

IST = ZoneInfo('Asia/Kolkata')
TERMINAL = {'HIRED', 'REJECTED', 'WITHDRAWN', 'TALENT_POOL'}
STAGES = [
    ('resume', 'Resume review', {'RESUME_UPLOADED', 'UPLOADED', 'PARSED', 'MATCHING', 'RESUME_REVIEWED', 'SHORTLISTED'}),
    ('assessment', 'Assessment', {'ASSESSMENT_SENT', 'ASSESSMENT_COMPLETED'}),
    ('technical', 'Technical', {'ROUND1_PENDING_ASSIGNMENT', 'ROUND1_SCHEDULED', 'ROUND1_REVIEW_PENDING'}),
    ('managerial', 'Managerial', {'ROUND2_PENDING_ASSIGNMENT', 'ROUND2_SCHEDULED', 'ROUND2_REVIEW_PENDING'}),
    ('hr', 'HR', {'HR_ROUND'}), ('offer', 'Offer', {'OFFER'}),
    ('hired', 'Hired', {'HIRED'}), ('hold', 'On hold', {'ON_HOLD'}),
    ('rejected', 'Rejected / withdrawn', {'REJECTED', 'WITHDRAWN'}),
    ('rejectionReview', 'Rejection review', {'REJECTION_PENDING_HR_REVIEW'}),
    ('talentPool', 'Talent pool', {'TALENT_POOL'}),
]


def utc(value):
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value.replace('Z', '+00:00'))
        except ValueError:
            return None
    if not isinstance(value, datetime):
        return None
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def hours(start, end):
    start, end = utc(start), utc(end)
    if not start or not end or end < start:
        return None
    return (end - start).total_seconds() / 3600


def distribution(values):
    values = sorted(values)
    def percentile(fraction):
        position = (len(values) - 1) * fraction
        return round(values[floor(position)] + (values[ceil(position)] - values[floor(position)]) * (position % 1), 1)
    return {'samples': len(values), 'medianHours': percentile(.5) if values else None,
            'p90Hours': percentile(.9) if values else None,
            'buckets': [sum(low <= value < high for value in values) for low, high in
                        [(0, 4), (4, 24), (24, 48), (48, 72), (72, float('inf'))]]}


async def dashboard(db, org_id, *, days=30, job_id=None, stamp=None):
    stamp = utc(stamp) or datetime.now(timezone.utc)
    # Calendar-day window in IST, including today; all calculations remain UTC.
    local_today = stamp.astimezone(IST).replace(hour=0, minute=0, second=0, microsecond=0)
    start = (local_today - timedelta(days=days - 1)).astimezone(timezone.utc)
    data = await portfolio(db, org_id, job_id)
    jobs = data['jobs']
    # All job and portfolio snapshots share one stage-history join and one set of role totals.
    stage_metrics = {
        key: {'$in': ['$currentStage', sorted(members)]}
        for key, _, members in STAGES if key not in {'technical', 'managerial', 'hr'}
    }
    known_stages = sorted(set().union(*(members for _, _, members in STAGES)))
    stage_metrics['other'] = {'$not': [{'$in': ['$currentStage', known_stages]}]}
    stage_metrics['linksUnsent'] = {'$and': [
        nonempty('$assessment.link'), {'$not': [application_conditions()['linksSent']]},
    ]}
    counts = await pipeline_counts(db, org_id, [job['jobId'] for job in jobs], application_metrics=stage_metrics)
    stage_labels = [(key, label) for key, label, _ in STAGES] + [('other', 'Other stages')]
    stage_totals = {key: sum(row[key] for row in counts.values()) for key, _ in stage_labels}
    stage_rows = [{'key': key, 'label': label, 'count': stage_totals[key]} for key, label in stage_labels]
    summary = {key: sum(row[key] for row in counts.values()) for key in [
        'resumesUploaded', 'atsScored', 'atsProcessing', 'linksGenerated', 'linksSent',
        'assessmentsCompleted', 'technical', 'managerial', 'hr', 'linksUnsent']}
    status = lambda job: job.get('lifecycleStatus') or {'open': 'OPEN', 'on_hold': 'ON_HOLD', 'closed': 'CLOSED', 'filled': 'CLOSED'}.get(job.get('status'), 'OPEN')
    summary.update(openRoles=sum(status(j) == 'OPEN' for j in jobs),
        openPositions=sum(max(0, int(j.get('positionsTotal') or 0) - int(j.get('positionsFilled') or 0)) for j in jobs if status(j) == 'OPEN'),
        hired=stage_totals['hired'], offers=stage_totals['offer'], onHold=stage_totals['hold'])
    history = defaultdict(list)
    bookings = defaultdict(list)
    reviews = defaultdict(list)
    for row in data['history']:
        history[row['applicationId']].append(row)
    for row in data['interviews']:
        bookings[row['applicationId']].append(row)
    for row in data['reviews']:
        reviews[row['applicationId']].append(row)
    metrics = {key: {'label': label, 'values': [], 'eligible': 0, 'waiting': 0, 'overdue': 0} for key, label in [
        ('assessmentResponse', 'Invitation → assessment start'),
        ('technicalScheduling', 'Assessment complete → technical booking'),
        ('managerialScheduling', 'Technical approval → managerial booking'),
        ('hrScheduling', 'Managerial approval → HR booking'),
    ]}
    aging = {key: {'key': key, 'label': label, 'under24': 0, 'days1to3': 0, 'over72': 0, 'unknown': 0} for key, label, _ in STAGES[:6]}
    by_job = defaultdict(lambda: {'waiting': 0, 'overdue': 0})
    completions_by_date = defaultdict(int)
    def measure(key, origin, endpoint, active):
        origin = utc(origin)
        if not origin or origin > stamp:
            return
        metric = metrics[key]
        if start <= origin:
            metric['eligible'] += 1
            duration = hours(origin, endpoint)
            if duration is not None and utc(endpoint) <= stamp:
                metric['values'].append(duration)
        if not endpoint and active:
            metric['waiting'] += 1
            if hours(origin, stamp) >= 48:
                metric['overdue'] += 1
    for app in data['applications']:
        key, stage = app['applicationId'], app.get('currentStage')
        assessment = app.get('assessment') or {}
        events = sorted([row for row in history[key] if utc(row.get('transitionAt')) and utc(row['transitionAt']) <= stamp], key=lambda r: utc(r['transitionAt']))
        def event_time(target):
            return next((r['transitionAt'] for r in reversed(events) if r['toStage'] == target), None)
        def booked(round_name, after):
            after = utc(after)
            eligible = [utc(r.get('createdAt')) for r in bookings[key] if r.get('round') == round_name
                and r.get('status') != 'cancelled' and utc(r.get('createdAt')) and after and after <= utc(r['createdAt']) <= stamp]
            return min(eligible) if eligible else None
        def approval(round_name):
            dates = [utc(r.get('createdAt')) for r in reviews[key] if r.get('round') == round_name and utc(r.get('createdAt')) and utc(r['createdAt']) <= stamp]
            return max(dates) if dates else None
        active = stage not in TERMINAL
        sent = utc(assessment.get('sentAt')) or utc(event_time('ASSESSMENT_SENT'))
        # A submitted assessment with no start timestamp is unknown, never a zero-hour response.
        completion_events = [utc(row['transitionAt']) for row in events if row['toStage'] == 'ASSESSMENT_COMPLETED']
        stored_completion = utc(assessment.get('submittedAt')) or utc(assessment.get('completedAt'))
        if assessment.get('submissionTimeSource') == 'provider' and stored_completion:
            complete = stored_completion
        else:
            complete = min(completion_events, default=stored_completion)
        if complete and start <= complete <= stamp:
            completions_by_date[complete.astimezone(IST).date().isoformat()] += 1
        attempted = complete or assessment.get('score') is not None or assessment.get('state') in {'in_progress', 'completed', 'report_pending'}
        measure('assessmentResponse', sent, assessment.get('startedAt'), active and not attempted and stage in {'ASSESSMENT_SENT', 'SHORTLISTED'})
        measure('technicalScheduling', complete, booked('technical', complete), stage in {'ASSESSMENT_COMPLETED', 'ROUND1_PENDING_ASSIGNMENT'})
        technical = approval('technical')
        managerial = approval('managerial')
        measure('managerialScheduling', technical, booked('managerial', technical), stage == 'ROUND2_PENDING_ASSIGNMENT')
        hr_booking = booked('hr', managerial)
        measure('hrScheduling', managerial, hr_booking, stage == 'HR_ROUND')
        if stage == 'HR_ROUND' and managerial and not hr_booking:
            by_job[app['jobId']]['waiting'] += 1
            if hours(managerial, stamp) >= 48:
                by_job[app['jobId']]['overdue'] += 1
        for bucket_key, _, members in STAGES[:6]:
            if stage in members:
                entry = event_time(stage)
                elapsed = hours(entry, stamp)
                bucket = 'unknown' if elapsed is None else 'under24' if elapsed < 24 else 'days1to3' if elapsed < 72 else 'over72'
                aging[bucket_key][bucket] += 1
    timing = [{'key': key, 'label': metric['label'], **distribution(metric['values']),
        'eligible': metric['eligible'], 'withoutDuration': metric['eligible'] - len(metric['values']),
        'waiting': metric['waiting'], 'overdue': metric['overdue']} for key, metric in metrics.items()]
    # Intake + pre-intake applications: never double-count profiles created from intake.
    dates = [(local_today - timedelta(days=i)).date().isoformat() for i in reversed(range(days))]
    trend = {date: {'resumes': 0, 'assessments': completions_by_date[date]} for date in dates}
    intake_query = {**data['scope'], 'status': {'$ne': 'deleted'}, 'createdAt': {'$gte': start, '$lte': stamp}}
    recent = await db.resume_intake_items.find(intake_query, {'_id': 0, 'createdAt': 1}).sort('createdAt', -1).limit(RECORD_LIMIT + 1).to_list(RECORD_LIMIT + 1)
    legacy_query = {**data['scope'], 'intakeItemId': None, 'createdAt': {'$gte': start, '$lte': stamp}}
    legacy = await db.applications.find(legacy_query, {'_id': 0, 'createdAt': 1}).sort('createdAt', -1).limit(RECORD_LIMIT + 1).to_list(RECORD_LIMIT + 1)
    for row in recent[:RECORD_LIMIT] + legacy[:RECORD_LIMIT]:
        date = utc(row.get('createdAt'))
        if date and date.astimezone(IST).date().isoformat() in trend:
            trend[date.astimezone(IST).date().isoformat()]['resumes'] += 1
    intake_count = len(recent) if len(recent) <= RECORD_LIMIT else await db.resume_intake_items.count_documents(intake_query)
    legacy_count = len(legacy) if len(legacy) <= RECORD_LIMIT else await db.applications.count_documents(legacy_query)
    summary['resumesInWindow'] = intake_count + legacy_count
    rows = []
    for job in jobs:
        c = counts[job['jobId']]
        rows.append({'jobId': job['jobId'], 'title': job.get('title') or 'Untitled role',
            'department': job.get('department') or 'Unassigned', 'status': status(job),
            'positions': max(0, int(job.get('positionsTotal') or 0) - int(job.get('positionsFilled') or 0)),
            **{key: value for key, value in c.items() if key not in stage_metrics},
            'hrWaiting': by_job[job['jobId']]['waiting'], 'hrOverdue': by_job[job['jobId']]['overdue'],
            'stages': {key: c[key] for key, _ in stage_labels},
            'daysOpen': round(hours(job.get('createdAt'), stamp) / 24) if status(job) == 'OPEN' and hours(job.get('createdAt'), stamp) is not None else None})
    return {'generatedAt': stamp.isoformat(), 'days': days, 'windowStart': start.isoformat(), 'timezone': 'Asia/Kolkata',
        'selectedJobId': job_id, 'jobOptions': data['choices'], 'summary': summary, 'stages': stage_rows,
        'roles': rows, 'trend': [{'date': date, **values} for date, values in trend.items()],
        'timing': timing, 'aging': list(aging.values()),
        'quality': {'limited': data['limited'] or len(recent) > RECORD_LIMIT or len(legacy) > RECORD_LIMIT,
            'applicationsAnalyzed': len(data['applications']),
            'notes': ['Current pipeline counts are a snapshot; resume and completion trends use the selected period.',
                'Timing cohorts begin in the selected period. Open waiting queues include older active applications. 48 hours is an attention threshold, not an agreed SLA.',
                'Assessment start requires a provider timestamp. Booking latency measures when the booking was created, not the interview start time.',
                'Stage age uses the latest matching transition timestamp. Missing history is shown as unknown.']}}
