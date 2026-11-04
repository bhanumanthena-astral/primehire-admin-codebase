"""ATS-only provider boundary. Parsing/importing never calls this module."""
from __future__ import annotations
import asyncio
import re
from ..config import settings
from .resume_intake_ats import score
from .llm.base import scrub_text, detect_injection
from .llm.openrouter import score_candidate
from .llm.resilience import governance_key, bucket_take, breaker_check, breaker_record, bucket_clamp


def private_text(value, profile, limit=4000):
    text = re.sub(r'<[^>]+>', ' ', str(value or ''))
    for key in ['name', 'email', 'phone', 'dateOfBirth', 'homeTown', 'pinCode', 'currentCompany', 'ugUniversity', 'pgUniversity', 'doctorateUniversity']:
        sensitive = profile.get(key)
        if sensitive and len(str(sensitive)) >= 2:
            text = re.sub(re.escape(str(sensitive)), '[REDACTED]', text, flags=re.IGNORECASE)
    text = re.sub(r'(?<!\w)\+?\d[\d\s().-]{5,}\d(?!\w)',
        lambda match: '[PHONE]' if len(re.sub(r'\D','',match.group()))>=7 else match.group(),text)
    return scrub_text(text)[:limit]


async def evaluate(db, org, profile, text, job, limits, output_ref, *, local_score=score):
    """Bounded ATS-only call after human range selection; local result retained."""
    result = await asyncio.to_thread(local_score, profile, text, job, limits)
    result.update(localOverall=result['overall'], llmScore=None, llmReasons=[], llmStatus='not_configured', needsReview=False)
    selected_model = (settings.resume_ats_model or settings.openrouter_model).strip()
    if not settings.openrouter_api_key.strip() or not selected_model:
        result['note'] += ' LLM is not configured; this is a local score.'
        return result
    candidate = {
        'skills': [private_text(v, profile, 200) for v in profile.get('skills', [])],
        'experienceYears': profile.get('experienceYears'),
        'education': [private_text(v, profile, 200) for v in profile.get('education', [])] +
            [private_text(profile.get(k), profile, 100) for k in ['ugDegree','pgDegree','doctorateDegree'] if profile.get(k)],
        'summary': private_text(' '.join(str(profile.get(k) or '') for k in ['summary','role','currentDesignation','headline']), profile, 1500),
    }
    job_data = {key: private_text(job.get(key), profile, 300) for key in ['title','jobRole','department','location','workMode']}
    job_data.update(minExperienceYears=job.get('minExperienceYears'), maxExperienceYears=job.get('maxExperienceYears'),
        mustHaveSkills=[private_text(v, profile, 200) for v in (job.get('mustHaveSkills') or [])[:150]],
        keywords=[private_text(v, profile, 200) for v in (job.get('keywords') or [])[:150]],
        description=private_text(job.get('jdText') or job.get('jdHtml') or job.get('description'),profile,4000))
    # Raw resume text is checked locally and never sent to the provider.
    if detect_injection(text) or detect_injection(str(job_data)) or detect_injection(str(candidate)):
        result.update(llmStatus='blocked',needsReview=True)
        result['note'] += ' Suspicious document instructions require reviewer attention; LLM scoring was skipped.'
        return result
    key = f'openrouter:{selected_model.lower()}'
    allowed, _ = await breaker_check(db,key)
    if allowed:
        allowed, _ = await bucket_take(db,key)
    if not allowed:
        result.update(llmStatus='rate_limited',needsReview=True)
        result['note'] += ' LLM capacity is busy; local score retained. Recalculate ATS later.'
        return result
    try:
        outcome = await score_candidate(db,org,parsed=candidate,raw_text='',job_reqs=job_data,
            output_ref=output_ref,timeout_s=20,max_attempts=1,model_override=selected_model)
        await bucket_clamp(db,key,outcome.rate_limit_remaining)
        await breaker_record(db,key,success=outcome.llm_score is not None,retryable_failure=outcome.retryable)
    except Exception as exc:
        result.update(llmStatus='unavailable',needsReview=True,llmErrorCode=type(exc).__name__)
        result['note'] += ' LLM scoring is unavailable; local score retained. Recalculate ATS to retry.'
        return result
    if outcome.llm_score is None or outcome.injection_suspected:
        result.update(llmStatus='blocked' if outcome.injection_suspected else 'rate_limited' if outcome.error_code=='rate_limited' else 'unavailable',needsReview=True)
        result['retryAfterSeconds']=max(0,int(outcome.retry_after_s))
        result['note'] += ' LLM did not return a usable score; local score retained. Recalculate ATS to retry.'
        return result
    result.update(overall=outcome.llm_score,llmScore=outcome.llm_score,
        llmReasons=[private_text(reason,profile,500) for reason in outcome.reasons],llmStatus='done',method='llm_with_local_breakdown',
        needsReview=abs(outcome.llm_score-result['localOverall']) >= 20)
    overall=result['overall']
    result['category']='Excellent' if overall>=limits.excellentAt else 'Good' if overall>=limits.goodAt else 'Moderate' if overall>=limits.moderateAt else 'Low'
    result['note']='Advisory LLM overall score with a separately computed local breakdown. Personal attributes are excluded. Human hiring decision required.'
    if result['needsReview']:
        result['note'] += ' LLM and local scores differ by at least 20 points; review the evidence.'
    return result
