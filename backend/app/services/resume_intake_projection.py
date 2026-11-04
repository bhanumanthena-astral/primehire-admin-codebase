"""Central default projection for Module 2 profiles and reviewer free text."""
import re
from .pii import mask_email, mask_phone


def redact_contacts(text):
    text = re.sub(r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", lambda m: mask_email(m.group()), str(text))
    return re.sub(r"(?<!\w)\+?\d[\d ()-]{5,}\d(?!\w)", lambda m: mask_phone(m.group()), text)


def project_management_profile(profile, *, reveal=False):
    """Module 4 projection retains education structure; contacts require audited reveal."""
    if reveal:
        return dict(profile)
    def safe(value):
        if isinstance(value, str): return redact_contacts(value)
        if isinstance(value, list): return [safe(part) for part in value]
        if isinstance(value, dict): return {key:safe(part) for key,part in value.items()}
        return value
    result = safe(profile)
    result['email'] = mask_email(profile.get('email',''))
    result['phone'] = mask_phone(profile.get('phone',''))
    return result


def project_profile(profile, *, detail=False, reveal=False):
    output = dict(profile or {})
    if not detail:
        output = {key: output.get(key) for key in ['name', 'email', 'phone', 'experienceYears', 'currentDesignation', 'education', 'ugDegree', 'ugSpecialization', 'ugUniversity', 'pgDegree', 'pgSpecialization', 'pgUniversity', 'doctorateDegree', 'doctorateSpecialization', 'doctorateUniversity']}
    if reveal:
        return output
    output['email'] = mask_email(output.get('email') or '')
    output['phone'] = mask_phone(output.get('phone') or '')
    for key in ['summary', 'headline', 'dateOfBirth']:
        output.pop(key, None)
    for key, value in output.items():
        if key not in {'email', 'phone'}:
            if isinstance(value, str):
                output[key] = redact_contacts(value)
            elif isinstance(value, list):
                output[key] = [redact_contacts(part) for part in value]
    return output
