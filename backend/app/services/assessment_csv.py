"""Bounded RFC-4180 CSV parsing; no LLM or business-record writes."""
import csv
import hashlib
import io
import json
import re
from datetime import date, datetime, time, timedelta, timezone
from pydantic import ValidationError
from ..schemas.assessment_management import AssessmentConfig

HEADERS = ['Job Description', 'Language Selection', 'Round Type',
           'Start Date', 'End Date', 'Question Type', 'Max Duration (Seconds)', 'Max Score',
           'Weightage (%)', 'Question Prompt / Text', 'Expected Reference Answer']
OPTIONAL = ['Job Title', 'Option A', 'Option B', 'Option C', 'Option D', 'Correct Answer']
IST = timezone(timedelta(hours=5, minutes=30))


def digest(value):
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


def group_job_id(org, group):
    return 'JOB-' + digest(org + '\0' + group)[:32]


def parse_csv(text, org):
    result = {'previewHash': digest(text), 'rows': [], 'groups': [], 'fileErrors': []}
    if len(text.encode('utf-8')) > 2_000_000:
        result['fileErrors'].append('CSV exceeds 2 MB')
        return result
    try:
        reader = csv.reader(io.StringIO(text.lstrip('\ufeff')), strict=True)
        headers = [value.strip() for value in next(reader, [])]
        if not headers:
            raise ValueError('CSV is empty')
        if len(set(value.casefold() for value in headers)) != len(headers):
            raise ValueError('Duplicate column headers must be corrected')
        missing = [value for value in HEADERS if value not in headers]
        if missing:
            raise ValueError('Missing mandatory columns: ' + ', '.join(missing))
        # Accept older saved templates, but new uploads need no user-created identifier.
        if any(value not in HEADERS + OPTIONAL + ['Assessment Group ID'] for value in headers):
            raise ValueError('Unknown column headers; use the downloadable template')
        grouped = {}
        for values in reader:
            row_number = reader.line_num
            if not any(value.strip() for value in values):
                continue
            if len(result['rows']) >= 1000:
                raise ValueError('Maximum 1,000 question rows per file')
            row = {'row': row_number, 'status': 'valid', 'errors': []}
            result['rows'].append(row)
            if len(values) != len(headers):
                row.update(status='invalid', errors=[{'field': 'Row', 'reason': 'Column count does not match the header'}])
                # Keep the identifiable group blocked instead of importing its
                # other questions while silently dropping this malformed row.
                values = (values + [''] * len(headers))[:len(headers)]
            values = dict(zip(headers, [value.strip() for value in values]))
            metadata_keys = ['Job Description', 'Language Selection', 'Round Type', 'Start Date', 'End Date', 'Job Title']
            group = values.get('Assessment Group ID') or 'auto:' + digest(json.dumps([values.get(key, '') for key in metadata_keys], ensure_ascii=False))
            grouped.setdefault(group, []).append((row, values))
            row['groupId'] = f'Assessment {list(grouped).index(group) + 1}'
            if len(grouped) > 100:
                raise ValueError('Maximum 100 assessments per file')
        if not result['rows']:
            raise ValueError('CSV contains no question rows')
        for group, entries in grouped.items():
            base = entries[0][1]
            metadata = {}
            for header in ['Job Description', 'Language Selection', 'Round Type', 'Start Date', 'End Date', 'Job Title']:
                if any(values.get(header, '') != base.get(header, '') for _, values in entries):
                    for row, _ in entries:
                        row['errors'].append({'field': header, 'reason': 'Conflicting assessment values within this group'})
            questions = []
            for index, (row, values) in enumerate(entries):
                question = {'id': f'q_{index + 1}', 'text': values['Question Prompt / Text'],
                    'type': values['Question Type'], 'referenceAnswer': values['Expected Reference Answer']}
                for header, key in [('Max Duration (Seconds)', 'maxDuration'), ('Max Score', 'maxScore'), ('Weightage (%)', 'weightage')]:
                    raw = values[header]
                    if not raw:
                        continue
                    try:
                        if key == 'maxDuration' and not re.fullmatch(r'[0-9]+', raw):
                            raise ValueError()
                        question[key] = int(raw) if key == 'maxDuration' else float(raw)
                    except ValueError:
                        row['errors'].append({'field': header, 'reason': 'A valid positive numeric value is required'})
                if question['type'] == 'MCQ':
                    options = [values.get('Option ' + letter, '') for letter in 'ABCD']
                    question['options'] = [value for value in options if value]
                    answer = values.get('Correct Answer') or question['referenceAnswer']
                    if answer.upper() in list('ABCD') and options['ABCD'.index(answer.upper())]:
                        answer = options['ABCD'.index(answer.upper())]
                    question['correctOption'] = answer
                questions.append(question)
            for header, key in [('Start Date', 'startDate'), ('End Date', 'endDate')]:
                try:
                    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', base[header]):
                        raise ValueError()
                    metadata[key] = datetime.combine(date.fromisoformat(base[header]), time(), IST)
                except ValueError:
                    for row, _ in entries:
                        row['errors'].append({'field': header, 'reason': 'Use a valid YYYY-MM-DD date'})
            config = None
            try:
                config = AssessmentConfig.model_validate({
                    'jobId': group_job_id(org, group), 'jobTitle': base.get('Job Title') or base['Job Description'].split('\n')[0][:200],
                    'jobDescription': base['Job Description'], 'language': base['Language Selection'],
                    'roundType': base['Round Type'], 'questions': questions, **metadata,
                })
            except ValidationError as errors:
                for error in errors.errors(include_input=False, include_context=False, include_url=False):
                    location = error['loc']
                    targets = [entries[location[1]][0]] if len(location) > 1 and location[0] == 'questions' and isinstance(location[1], int) else [row for row, _ in entries]
                    for row in targets:
                        row['errors'].append({'field': '.'.join(str(part) for part in location) or 'Assessment', 'reason': error['msg']})
            invalid = any(row['errors'] for row, _ in entries)
            for row, _ in entries:
                row['status'] = 'invalid' if invalid else 'valid'
                if invalid and not row['errors']:
                    row['errors'].append({'field': 'Assessment Group', 'reason': 'Another question in this group is invalid; the entire group is blocked'})
            result['groups'].append({'groupId': entries[0][0]['groupId'], 'rows': [row['row'] for row, _ in entries],
                'status': 'invalid' if invalid else 'valid', 'config': config.model_dump(mode='json') if config and not invalid else None})
    except (csv.Error, ValueError) as error:
        result['fileErrors'].append(str(error) if isinstance(error, ValueError) else 'Malformed CSV quoting')
    return result
