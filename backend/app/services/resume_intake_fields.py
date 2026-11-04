"""Conservative local section/layout helpers. No inference through a model."""
import re

HEADERS = {'summary','professional summary','profile summary','career summary','objective','career objective',
    'skills','technical skills','key skills','education','educational qualifications','academic qualifications',
    'experience','work experience','employment history','professional experience','employment','career history','work history','projects','personal projects','certifications','qualifications','academic background','educational background',
    'personal information','personal details','contact','contact details','resume','curriculum vitae'}


def enrich(text, values):
    values = dict(values)
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    # A summary is a declared section, never the candidate's contact header.
    summary=[]
    collecting=False
    for line in lines:
        heading=line.strip(' :|-').casefold()
        if heading in {'summary','professional summary','profile summary','career summary','objective','career objective'}:
            collecting=True
            continue
        inline=re.match(r'(?i)^(?:professional summary|profile summary|career summary|summary|objective)\s*:\s*(.+)',line)
        if inline:
            summary.append(inline.group(1));collecting=True;continue
        if collecting:
            if heading in HEADERS or re.match(r'(?i)^(?:email|phone|mobile|name)\s*:',line):
                break
            summary.append(line)
            if sum(map(len,summary))>=5000:break
    values['summary']=' '.join(summary)[:5000]
    if not re.search(r'(?im)^\s*(?:candidate name|full name|name)\s*:',text):
        values['name']=''
        for line in lines[:5]:
            heading=line.strip(' :|-').casefold()
            words=line.split()
            if heading in HEADERS:
                if heading in {'resume','curriculum vitae'}:continue
                break
            if re.search(r'(?i)\b(engineer|developer|manager|consultant|architect|analyst|resume)\b',line):
                continue
            if 2<=len(words)<=6 and len(line)<=100 and all(c.isalpha() or c in " .'-" for c in line):
                values['name']=line;break
    # Labeled tenure with months is more precise than a first integer match.
    tenure=re.search(r'(?im)^\s*(?:total (?:work )?experience|experience)\s*[:|-]\s*(\d+(?:\.\d+)?)\s*(years?|yrs?)(?:\s*(?:and)?\s*(\d+)\s*(?:months?|mos?))?',text)
    if tenure:
        values['experienceYears']=round(float(tenure.group(1)) + int(tenure.group(3) or 0)/12,2)
    months=re.search(r'(?im)^\s*(?:total (?:work )?experience|experience)\s*:\s*(\d+)\s*months?\b',text)
    if months:values['experienceYears']=round(int(months.group(1))/12,2)
    enrich_employment(lines, values)
    enrich_education(lines, values)
    return values


DEGREES = {
    'ug': r"\b(?:b\.?\s*tech|b(?:\.\s*e\.?|\s+e\.?|(?-i:E))|b\.?\s*sc|bca|bba|bcom|b\.?\s*com|bachelor(?:['’]s|s)?(?:\s+of\s+(?:technology|engineering|science|arts|commerce|computer applications?|business administration))?)\b",
    'pg': r"\b(?:m\.?\s*tech|m(?:\.\s*e\.?|\s+e\.?|(?-i:E))|m\.?\s*sc|mca|mba|m\.?\s*com|master(?:['’]s|s)?(?:\s+of\s+(?:technology|engineering|science|arts|commerce|computer applications?|business administration))?)\b",
    'doctorate': r'\b(?:ph\.?\s*d\.?|doctorate|doctor of philosophy)\b',
}
EMPLOYMENT = {'experience','work experience','employment history','professional experience','employment','career history','work history'}
MONTH = r'(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)'
DATE_RANGE = re.compile(rf'(?i)\b({MONTH})\.?\s+(\d{{4}})\s*(?:[-–—]|to)\s*(?:({MONTH})\.?\s+(\d{{4}})|(present|current|now|ongoing))\b')


def enrich_employment(lines, values):
    """Use declared titles and dated employment; never infer tenure from education."""
    from datetime import datetime, timezone, timedelta
    now = datetime.now(timezone(timedelta(hours=5, minutes=30)))
    in_work = False
    work_lines = []
    candidates = []
    for index, line in enumerate(lines):
        heading = line.strip(' :|-').casefold()
        if heading in HEADERS:
            in_work = heading in EMPLOYMENT
            continue
        if in_work:
            work_lines.append(line)
        if values.get('currentDesignation'):
            continue
        explicit = re.match(r'(?i)^(?:current (?:designation|job title|role)|present designation|designation|job title)\s*[:|–-]\s*(.+)', line)
        if explicit:
            values['currentDesignation'] = explicit.group(1).strip()[:100]
            continue
        # Split a visual two-column title/date row before testing the title itself.
        title = DATE_RANGE.sub('', line).strip(' |,–—-')
        title = re.split(r'\s{2,}|\s+(?:at|@)\s+', title, maxsplit=1)[0].strip()
        if not (2 <= len(title) <= 100 and len(title.split()) <= 12):
            continue
        if not re.search(r'(?i)\b(?:engineer|developer|architect|analyst|consultant|manager|designer|scientist|administrator|specialist|recruiter|executive|lead|intern)\b', title):
            continue
        if re.search(r'(?i)\b(?:seeking|looking|aspiring|aspire|pursuing|built|developed|designed|worked|responsible|experience|skills)\b|[.!?]$', title):
            continue
        context = ' '.join(lines[max(0,index-1):index+2])
        if in_work and re.search(r'(?i)\b(present|current|ongoing)\b', context):
            candidates.append((0, index, title))
        elif index < 5 and not re.search(r'\b(?:19|20)\d{2}\b', line):
            candidates.append((1, index, title))
    if not values.get('currentDesignation') and candidates:
        values['currentDesignation'] = min(candidates)[2]
    if values.get('experienceYears') is not None:
        return
    intervals = []
    for line in work_lines:
        for match in DATE_RANGE.finditer(line):
            start = int(match[2])*12 + datetime.strptime(match[1][:3], '%b').month - 1
            end = (int(match[4])*12 + datetime.strptime(match[3][:3], '%b').month - 1) if match[3] else now.year*12 + now.month - 1
            if 1900*12 <= start < end <= now.year*12 + now.month - 1:
                intervals.append((start,end))
    if intervals:
        merged=[]
        for start,end in sorted(intervals):
            if merged and start <= merged[-1][1]:
                merged[-1]=(merged[-1][0],max(end,merged[-1][1]))
            else:
                merged.append((start,end))
        years=round(sum(end-start for start,end in merged)/12,2)
        if years <= 50:
            values['experienceYears']=years


def enrich_education(lines, values):
    """Recognize degree evidence even when a PDF places it before its heading."""
    education=list(values.get('education') or [])
    for index,line in enumerate(lines):
        for level,pattern in DEGREES.items():
            degree=re.search(pattern,line,re.I)
            if not degree:
                continue
            # Avoid treating a narrative mention of a degree as a separate credential.
            if len(line)>250 or re.search(r'(?i)\b(?:seeking|looking for|must have|required|requirement)\b',line):
                continue
            declared=degree.group().strip()
            if not values.get(f'{level}Degree'):
                values[f'{level}Degree']=declared[:100]
            if not any(entry.casefold()==declared.casefold() for entry in education):
                education.append(declared)
            context=[line]
            for direction in [-1,1]:
                for distance in [1,2]:
                    pos=index+direction*distance
                    if pos<0 or pos>=len(lines):break
                    part=lines[pos]
                    if part.strip(' :|-').casefold() in HEADERS or any(re.search(other,part,re.I) for other in DEGREES.values()):break
                    context.append(part)
            years=re.findall(r'\b(?:19|20)\d{2}\b',' | '.join(context))
            if years and not values.get(f'{level}GraduationYear'):
                values[f'{level}GraduationYear']=max(map(int,years))
            university=next((part.strip(' ,|-') for entry in context for part in re.split(r'[|;]',entry)
                if re.search(r'(?i)\b(university|college|institute)\b',part) and len(part.strip())<=200),None)
            if university and not values.get(f'{level}University'):
                values[f'{level}University']=re.sub(r'\s{2,}.*$','',university).strip()
            specialization=re.search(pattern+r'\s+(?:in\s+)([^|;,\n]+)',line,re.I)
            if specialization and not values.get(f'{level}Specialization'):
                values[f'{level}Specialization']=specialization.group(1).strip()[:150]
            elif '|' in line and not values.get(f'{level}Specialization'):
                parts=[part.strip() for part in line.split('|')]
                if len(parts)>1 and not re.search(r'(?i)cgpa|gpa|university|college|institute|\d{4}',parts[1]):
                    values[f'{level}Specialization']=parts[1][:150]
    values['education']=education[:30]
