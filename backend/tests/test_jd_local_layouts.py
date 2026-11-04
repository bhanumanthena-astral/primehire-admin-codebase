"""Normal JD metadata layouts, as opposed to prescribed colon templates."""
import io
import pytest
from docx import Document
from app.services.resume_extract import extract_text
from app.services.jd_local import extract_local_fields
from app.services.jd_validate import validate_jd_extraction


def frontend_jd():
    doc=Document()
    doc.add_heading('JOB DESCRIPTION',0)
    doc.add_heading('Frontend Developer',1)
    table=doc.add_table(rows=1,cols=4)
    for cell,label,value in zip(table.rows[0].cells,['COMPANY','EXPERIENCE','EMPLOYMENT TYPE','WORK MODE'],['Nxtagent AI','1+ years','Full-time','Work from Office (On-site)']):
        cell.text=label+'\n'+value
    doc.add_heading('Role Overview',2)
    doc.add_paragraph('Nxtagent AI is looking for a Frontend Developer with 1+ years of hands-on experience in React.js and TypeScript.')
    doc.add_paragraph('Build accessible responsive interfaces, integrate REST APIs and collaborate with backend engineers.')
    output=io.BytesIO();doc.save(output);return output.getvalue()

async def test_word_metadata_table_prefills_review_fields(db):
    text=extract_text(frontend_jd(),'docx')
    local=extract_local_fields(text)
    review=await validate_jd_extraction(local,db,'default',original_text=text)
    assert review.values['companyName']=='Nxtagent AI'
    assert review.values['title']=='Frontend Developer'
    assert review.values['jobRole']=='Frontend Developer'
    assert review.values['minExperienceYears']==1
    assert review.values['workMode']=='ONSITE'
    assert 'maxExperienceYears' not in review.values
    assert 'positionsTotal' not in review.values and 'department' not in review.values and 'location' not in review.values
    assert 'Build accessible responsive interfaces' in review.values['jdHtml']
    assert 'React' in review.values['keywords'] and 'TypeScript' in review.values['keywords']
    assert local['evidence']['companyName']=='COMPANY: Nxtagent AI'

@pytest.mark.parametrize('text,expected',[
    ('Experience: 1+ years',{'minExperience':'1'}),
    ('Experience required\n2 to 4 yrs',{'minExperience':'2','maxExperience':'4'}),
    ('Minimum experience: 2\nMaximum experience: 5',{'minExperience':'2','maxExperience':'5'}),
    ('We need at least 3 years of experience.',{'minExperience':'3'}),
    ('COMPANY | Nxtagent AI | EXPERIENCE | 1+ years',{'companyName':'Nxtagent AI','minExperience':'1'}),
    ('Company\nLocation\nHyderabad',{'location':'Hyderabad'}),
])
def test_supported_metadata_and_experience_variations(text,expected):
    out=extract_local_fields(text)
    for key,value in expected.items():assert out[key]==value
    if text.startswith('Company\nLocation'):assert 'companyName' not in out


def test_conflicting_metadata_is_not_silently_chosen():
    out=extract_local_fields('Company\nAcme\nCompany: Other\nExperience: 1+ years\nExperience: 3+ years')
    assert 'companyName' not in out and 'minExperience' not in out
    assert out['warnings']


def test_narrative_company_and_heading_without_metadata_labels():
    out=extract_local_fields('JOB DESCRIPTION\nFrontend Developer\nRole Overview\nNxtagent AI is looking for a Frontend Developer with 1+ years of experience.')
    assert out['companyName']=='Nxtagent AI' and out['jobTitle']=='Frontend Developer'
    assert out['minExperience']=='1'
