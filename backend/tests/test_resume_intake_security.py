"""Untrusted document boundaries, parser isolation and explainable score contracts."""
import io
import zipfile
import pytest
import pymupdf
from pydantic import ValidationError
from tests.test_resume_intake_v2 import client, headers, upload, drain, first, word, workbook, zipped
from app.services.resume_intake_security import validate_resume, inspect_zip, read_zip_entry, IntakeError
from app.services.resume_intake_parse import isolated
from app.services.resume_intake_excel import parse_excel
from app.services.resume_intake_ats import score
from app.services.resume_intake_exports import export_xlsx, profile_pdf
from app.services.resume_intake_projection import project_profile, redact_contacts
from app.schemas.resume_intake import CandidateProfile, IntakeSettings


@pytest.mark.parametrize('filename,data,mime',[
    ('resume.pdf',b'', ''), ('resume.pdf',b'plain text','application/pdf'),
    ('resume.exe.pdf',b'%PDF-1.7 fake','application/pdf'), ('resume.png',b'image','image/png'),
    ('../resume.docx',b'PK',''), ('resume.docx',b'not a word file',''),
    ('resume.docx',word(),'image/png'), ('resume.docx',word(), 'application/pdf'),
],ids=['empty','spoofed','double-extension','unsupported','unsafe-path','corrupt','mime-image','mime-pdf'])
def test_rejects_empty_spoofed_unsafe_or_unsupported_files(filename,data,mime):
    with pytest.raises(IntakeError):
        validate_resume(filename,data,10,mime)


def test_docx_macros_and_inflated_metadata_are_rejected():
    base = word()
    for extra_name,content in [('word/vbaProject.bin',b'macro'),('[Content_Types].xml',b'x'*(1024*1024+1))]:
        output=io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(base)) as source, zipfile.ZipFile(output,'w') as target:
            for member in source.infolist():
                if member.filename != extra_name:
                    target.writestr(member.filename,source.read(member))
            target.writestr(extra_name,content)
        with pytest.raises(IntakeError) as exc:
            validate_resume('resume.docx',output.getvalue(),10)
        assert exc.value.code == 'rejected'


def test_archive_file_count_expansion_compression_and_empty_limits():
    limits=IntakeSettings(zipMaxFiles=2,expandedMaxMb=10)
    for entries in [[], [('a.pdf',b'a'),('b.pdf',b'b'),('c.pdf',b'c')], [('a.pdf',b'a'*11000000)]]:
        with zipfile.ZipFile(io.BytesIO(zipped(entries))) as archive:
            with pytest.raises(IntakeError):
                inspect_zip(archive,limits)
    with zipfile.ZipFile(io.BytesIO(zipped([('bomb.pdf',b'x'*100000)]))) as archive:
        with pytest.raises(IntakeError,match='compression-ratio'):
            read_zip_entry(archive,archive.infolist()[0],IntakeSettings())


@pytest.mark.parametrize('fields',[
    {'email':'invalid'}, {'email':'a..b@example.com'}, {'email':'a@example'},
    {'phone':'123'}, {'phone':'1'*16}, {'experienceYears':-1}, {'experienceYears':True},
    {'experienceYears':51}, {'ugGraduationYear':1800}, {'ugGraduationYear':True},
    {'dateOfBirth':'2999-01-01'}, {'dateOfBirth':1730000000}, {'pinCode':'../bad'},
    {'gender':'unexpected'}, {'maritalStatus':'unexpected'}, {'$set':{'name':'Injected'}},
])
def test_profile_invalid_values_and_operator_injection(fields):
    with pytest.raises(ValidationError):
        CandidateProfile(**fields)


def test_profile_deduplicates_skills_and_keeps_missing_optional_fields_blank():
    profile=CandidateProfile(skills=['Python',' python ','SQL'],phone='+91 (98765) 43210')
    assert profile.skills == ['Python','SQL'] and profile.phone == '+919876543210'
    assert profile.experienceYears is None and profile.ugGraduationYear is None


def test_encrypted_pdf_corrupt_pdf_page_limit_and_missing_ocr():
    with pymupdf.open() as document:
        document.new_page().insert_text((40,40),'Synthetic candidate resume text')
        encrypted=document.tobytes(encryption=pymupdf.PDF_ENCRYPT_AES_256,owner_pw='owner-test',user_pw='user-test')
    with pytest.raises(IntakeError) as exc:
        isolated(encrypted,'pdf')
    assert exc.value.code == 'password_protected'
    with pytest.raises(IntakeError):
        isolated(b'%PDF-1.7 corrupt','pdf')
    with pymupdf.open() as document:
        for _ in range(21): document.new_page()
        data=document.tobytes()
    with pytest.raises(IntakeError,match='20-page'):
        isolated(data,'pdf')
    pixmap=pymupdf.Pixmap(pymupdf.csRGB,pymupdf.IRect(0,0,800,300),False)
    pixmap.clear_with(255)
    image=pixmap.tobytes('png')
    with pymupdf.open() as document:
        document.new_page().insert_image(pymupdf.Rect(0,0,400,150),stream=image)
        data=document.tobytes()
    with pytest.raises(IntakeError) as exc:
        isolated(data,'pdf',options={'tessdata':''})
    assert exc.value.code == 'ocr_required'


@pytest.mark.parametrize('columns',[
    ['Candidate Name','Unexpected'], ['Candidate Name','Email','Email'], ['Email','Phone'],
])
def test_excel_requires_prescribed_columns(columns):
    with pytest.raises(IntakeError):
        parse_excel(workbook([],columns))


def test_excel_row_limit_numeric_phone_and_missing_resume_reference():
    with pytest.raises(IntakeError,match='row limit'):
        parse_excel(workbook([['One','one@example.com'],['Two','two@example.com']]),max_rows=1)
    result=parse_excel(workbook([['Candidate','',9876543210.0]],['Candidate Name','Email','Phone']))
    assert result['rows'][0]['profile']['phone'] == '9876543210'
    with pytest.raises(IntakeError,match='Required columns'):
        parse_excel(workbook([],['Candidate Name','Email']),require_resume=True)


def test_ats_missing_education_not_fabricated_and_personal_attributes_do_not_score():
    job={'title':'Engineer','jobRole':'Engineer','mustHaveSkills':['Python'],'minExperienceYears':3,'jdText':'Bachelor degree required'}
    profile=CandidateProfile(name='Candidate',skills=['Python']).model_dump(mode='json')
    result=score(profile,'Worked with a bachelor student',job,IntakeSettings())
    assert result['breakdown']['education'] is None and result['breakdown']['experience'] is None
    assert result['breakdown']['skills'] == 100
    other=score({**profile,'gender':'male','maritalStatus':'married','dateOfBirth':'1990-01-01'},'Worked with a bachelor student',job,IntakeSettings())
    assert result['overall'] == other['overall']


def test_exports_preserve_numeric_scores_and_neutralize_formulas():
    from app.api.resume_intake import safe_cell
    from openpyxl import load_workbook
    data=export_xlsx([{'fileName':'=HYPERLINK("bad")','status':'completed','ats':{'overall':83},'profile':{'experienceYears':4.5,'name':'=cmd()'}}],safe_cell)
    book=load_workbook(io.BytesIO(data));row=list(book.active.rows)[1]
    assert row[0].data_type == 's' and row[2].value == 83 and row[2].data_type == 'n'
    assert all(cell.data_type != 'f' for cell in row)
    pdf=profile_pdf({'name':'Candidate','summary':'<script>bad</script>'+'A long summary '*300},'Engineer',None)
    with pymupdf.open(stream=pdf,filetype='pdf') as document:
        assert 1 < document.page_count <= 30


def test_projection_redacts_contacts_in_optional_fields_and_notes():
    projected=project_profile({'name':'Candidate','email':'person@example.com','phone':'+919876543210','summary':'Secret','currentCompany':'Contact person@example.com'},detail=True)
    assert 'person@example.com' not in str(projected) and 'summary' not in projected
    assert '9876543210' not in redact_contacts('Call +919876543210 or person@example.com')


async def test_admin_grants_are_enforced_on_existing_resume_actions(client,db):
    response=await upload(client);await drain(db)
    item=await first(client,response.json()['batchId'])
    await db['users'].update_one({'userId':'hr'},{'$set':{'jobAccess':['view']}})
    caps=(await client.get('/api/resume-intake/capabilities',headers=headers())).json()
    assert not caps['canUpload']
    path=f"/api/resume-intake/items/{item['itemId']}"
    assert (await client.get(path,headers=headers())).json()['canEdit'] is False
    assert (await client.post(path+'/reveal',headers=headers())).status_code == 403
    assert (await client.post(path+'/notes',json={'text':'Not authorized'},headers=headers())).status_code == 403


async def test_upload_body_cap_and_admission_limit_do_not_parse_or_store(client,db,monkeypatch):
    from app.config import settings
    response=await client.post('/api/resume-intake/upload',content=b'',headers={**headers(),'Content-Length':str(127*1024*1024)})
    assert response.status_code == 413
    monkeypatch.setattr(settings,'resume_upload_concurrency',1)
    from app.models.resume_intake import now
    from datetime import timedelta
    await db['resume_intake_limits'].insert_one({'_id':'upload:default:0','owner':'busy','expiresAt':now()+timedelta(minutes=1)})
    busy=await upload(client)
    assert busy.status_code == 429 and busy.headers['retry-after'] == '10'
    assert await db['resume_intake_batches'].count_documents({}) == 0
