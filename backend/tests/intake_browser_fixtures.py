"""Generate synthetic acceptance files; contains no real candidate data."""
import io
import sys
import zipfile
from docx import Document
from openpyxl import Workbook

kind = sys.argv[1]
out = io.BytesIO()
if kind in {"excel", "ats-range"}:
    book = Workbook()
    sheet = book.active
    sheet.append(["Candidate Name", "Email", "Phone", "Key Skills"])
    if kind == "ats-range":
        for value in [45,55,85]:sheet.append([f"Range Candidate {value}",f"range{value}@example.com","","Python, SQL"])
    else:
        sheet.append(["Spreadsheet Candidate", "spreadsheet@example.com", "", "Python, SQL"])
        sheet.append(["Invalid Candidate", "invalid", "", "Python"])
    book.save(out)
else:
    doc = Document()
    for line in ["Candidate Name: Browser Candidate", "browser.candidate@example.com", "Phone: +919887766554",
        "Python SQL", "3 years of experience", "Current designation: Platform Engineer"]:
        doc.add_paragraph(line)
    doc.save(out)
    if kind == "zip":
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("valid.docx", out.getvalue())
            z.writestr("../unsafe.docx", out.getvalue())
            z.writestr("invalid.png", b"test-image")
        out = archive
sys.stdout.buffer.write(out.getvalue())
