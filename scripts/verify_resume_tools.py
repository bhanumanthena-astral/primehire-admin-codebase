"""Real local scanner/OCR/DOC smoke check using synthetic/public test data."""
import hashlib
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'backend'))
from app.config import settings
from v2_local_tools import configure_local_tools
from app.services.resume_intake_parse import isolated
from app.services.resume_intake_security import scan, scanner_ready, validate_resume
import pymupdf

configure_local_tools(settings)
assert scanner_ready(), 'Local scanner is unavailable'
assert scan(b'Synthetic resume verification text') == 'clean'
with pymupdf.open() as source:
    page=source.new_page()
    page.insert_text((40,60),'Candidate Name: Synthetic OCR Candidate',fontsize=17)
    page.insert_text((40,100),'ocr.fixture@example.com',fontsize=17)
    page.insert_text((40,140),'Python SQL - 3 years of experience',fontsize=17)
    image=page.get_pixmap(matrix=pymupdf.Matrix(2,2)).tobytes('png')
with pymupdf.open() as scanned:
    scanned.new_page().insert_image(pymupdf.Rect(0,0,595,842),stream=image)
    data=scanned.tobytes()
assert scan(data)=='clean'
result=isolated(data,'pdf',options={'tessdata':settings.resume_ocr_tessdata})
assert result['profile']['email']=='ocr.fixture@example.com', 'OCR failed to recover the synthetic contact'
assert any('OCR' in warning for warning in result['warnings'])
sample=ROOT/'backend/tools/downloads/word97-fixture.doc'
if sample.is_file():
    data=sample.read_bytes()
    expected=sample.with_suffix('.git-sha').read_text().strip()
    assert hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()==expected
    validate_resume('fixture.doc',data,10)
    assert scan(data)=='clean'
    result=isolated(data,'doc',options={'converter':settings.resume_doc_converter})
    assert len(result['rawText'].strip())>10
print('Real scanner, scanned-PDF OCR and legacy DOC conversion: passed')
