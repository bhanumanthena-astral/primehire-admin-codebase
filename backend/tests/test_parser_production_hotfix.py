"""Production hotfix contracts: recall, precision, isolation and reviewed scoring."""
import io
import pytest
from app.services.resume_extract import deterministic_parse, extract_text
from app.services.skill_taxonomy import extract_skill_evidence, skill_hit, _pattern
from app.services.resume_intake_parse import isolated
from app.schemas.resume_intake import IntakeSettings
from app.services.resume_intake_ats import score
from app.services.resume_intake_projection import project_profile


def document(lines):
    from docx import Document
    doc=Document()
    for line in lines:doc.add_paragraph(line)
    output=io.BytesIO();doc.save(output);return output.getvalue()


def test_backend_intern_skill_recall_and_no_contact_inference():
    text='Skills: Python, ReactJS, NodeJS, PostgreSQL, scikit-learn, JWT, GitHub, Postman\nProjects\nDeveloped REST APIs with FastAPI and Docker.\nContact: java@example.test https://example.test/spring/python'
    skills=set(deterministic_parse(text)['skills'])
    assert {'Python','React','Node.js','PostgreSQL','scikit-learn','JWT','GitHub','Postman','REST','FastAPI','Docker'} <= skills
    assert 'Java' not in skills and 'Spring' not in skills


@pytest.mark.parametrize('text',['Built a no-code platform using Python.','Deployed without downtime using Docker.','Not only Python but also SQL.'])
def test_operational_no_downtime_language_does_not_negate_real_skills(text):
    skill='Docker' if 'Docker' in text else 'Python'
    assert skill_hit(text,skill)


@pytest.mark.parametrize('text',['No experience with Java.','Never used Java.','Not familiar with Java.'])
def test_negated_skills_stay_excluded(text):
    assert not skill_hit(text,'Java')


def test_evidence_counts_mentions_once_and_regex_cache_reuses_only_patterns():
    assert extract_skill_evidence('Skills: React.js')[0]['occurrences']==1
    _pattern.cache_clear()
    deterministic_parse('Skills: Python, SQL')
    before=_pattern.cache_info()
    deterministic_parse('Skills: Python, SQL')
    after=_pattern.cache_info()
    assert after.misses==before.misses and after.hits>before.hits


def test_docx_tables_headers_and_text_boxes_preserve_skill_text():
    from docx import Document
    from docx.oxml import OxmlElement
    doc=Document();doc.add_paragraph('Synthetic Engineer')
    cells=doc.add_table(rows=1,cols=2).rows[0].cells
    cells[0].text='Technical skills';cells[1].text='FastAPI, PostgreSQL'
    doc.sections[0].header.paragraphs[0].text='Python, Docker'
    box=OxmlElement('w:txbxContent');paragraph=OxmlElement('w:p');run=OxmlElement('w:r');text=OxmlElement('w:t');text.text='Skills: Redis, Kafka';run.append(text);paragraph.append(run);box.append(paragraph);doc.element.body.append(box)
    data=io.BytesIO();doc.save(data)
    assert {'FastAPI','PostgreSQL','Python','Docker','Redis','Kafka'}<=set(deterministic_parse(extract_text(data.getvalue(),'docx'))['skills'])


def test_isolated_parser_keeps_skills_instead_of_silently_dropping_an_over_limit_list():
    from app.services.skill_taxonomy import SKILLS
    data=document(['Synthetic Engineer','test@example.test','Technical Skills',', '.join(SKILLS)])
    parsed=isolated(data,'docx')
    assert len(parsed['profile']['skills'])==150
    assert any('150-skill' in warning for warning in parsed['warnings'])
    assert parsed['parserVersion']=='resume-parser-v3'


def test_exact_reviewed_aliases_are_counted_without_readmitting_removed_resume_skills():
    result=score({'skills':['ReactJS','Go']},'Skills: Java, React, Go',{'mustHaveSkills':['React.js','Go']},IntakeSettings())
    assert result['breakdown']['skills']==100
    absent=score({'skills':[]},'Skills: Java',{'mustHaveSkills':['Java']},IntakeSettings())
    assert absent['breakdown']['skills']==0


def test_list_projection_exposes_skills_without_contact_or_evidence_leaks():
    profile={'name':'Synthetic','email':'synthetic@example.test','phone':'9876543210','skills':['Python'],'skillEvidence':[{'skill':'Python','excerpt':'synthetic@example.test uses Python'}]}
    public=project_profile(profile)
    assert public['skills']==['Python'] and 'skillEvidence' not in public
    assert public['email']!='synthetic@example.test'
