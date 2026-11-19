"""Central default projection for Module 2 profiles and reviewer free text."""
import re
from .pii import mask_email, mask_phone
from .skill_taxonomy import canonical_skill


def redact_contacts(text):
    text = re.sub(r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", lambda m: mask_email(m.group()), str(text))
    return re.sub(r"(?<!\w)\+?\d[\d ()-]{5,}\d(?!\w)", lambda m: mask_phone(m.group()), text)


def redact_value(value):
    if isinstance(value, str):
        return redact_contacts(value)
    if isinstance(value, list):
        return [redact_value(part) for part in value]
    if isinstance(value, dict):
        return {key: redact_value(part) for key, part in value.items()}
    return value


def reconcile_skill_evidence(profile, previous=None):
    """Keep evidence only for skills still present in the reviewed profile.

    Requests from the UI may omit evidence (it is not editable), while a
    previously parsed profile may have it. Merge both, prefer the supplied
    evidence, then discard evidence for removed skills so a reviewer's edit
    cannot leave a misleading explanation behind.
    """
    profile = profile or {}
    supplied = profile.get("skillEvidence") or []
    fallback = (previous or {}).get("skillEvidence") or []
    combined = []
    seen = set()
    for item in [*supplied, *fallback]:
        if hasattr(item, "model_dump"):
            item = item.model_dump(mode="json")
        if not isinstance(item, dict):
            continue
        skill = canonical_skill(str(item.get("skill") or ""))
        if skill and skill.casefold() not in seen:
            seen.add(skill.casefold())
            fields = {"skill", "matchedText", "section", "page", "excerpt", "method", "confidence", "occurrences"}
            combined.append({key: value for key, value in item.items() if key in fields} | {"skill": skill})
    allowed = {canonical_skill(str(skill)) for skill in profile.get("skills", []) if str(skill).strip()}
    return [item for item in combined if item["skill"] in allowed]


def project_management_profile(profile, *, reveal=False):
    """Module 4 projection retains education structure; contacts require audited reveal."""
    if reveal:
        return dict(profile)
    result = redact_value(profile)
    result['email'] = mask_email(profile.get('email', ''))
    result['phone'] = mask_phone(profile.get('phone', ''))
    return result


def project_profile(profile, *, detail=False, reveal=False):
    output = dict(profile or {})
    if not detail:
        output = {key: output.get(key) for key in ['name', 'email', 'phone', 'skills', 'experienceYears',
            'currentDesignation', 'education', 'ugDegree', 'ugSpecialization', 'ugUniversity', 'pgDegree',
            'pgSpecialization', 'pgUniversity', 'doctorateDegree', 'doctorateSpecialization', 'doctorateUniversity']}
        output.pop('skillEvidence', None)
    if reveal:
        return output
    output['email'] = mask_email(output.get('email') or '')
    output['phone'] = mask_phone(output.get('phone') or '')
    for key in ['summary', 'headline', 'dateOfBirth']:
        output.pop(key, None)
    for key, value in list(output.items()):
        if key not in {'email', 'phone'}:
            output[key] = redact_value(value)
    return output
