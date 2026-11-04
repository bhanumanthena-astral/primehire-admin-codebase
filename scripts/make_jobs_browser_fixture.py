from pathlib import Path
from docx import Document
target=Path('e2e/fixtures'); target.mkdir(parents=True,exist_ok=True)
doc=Document()
for line in [
    'Company Name: Demo Labs', 'Job Role: Backend Engineer',
    'Job Title: Browser Demo Engineer', 'Department: Engineering',
    'Minimum Experience: 2', 'Maximum Experience: 5', 'Number of Positions: 2',
    'Keywords: Python, SQL', 'Opened At: 2026-01-01', 'Closes At: 2027-12-31',
    'Assignee: hr@example.com', 'Work Mode: Remote',
    'Job Description: Build reliable Python and SQL services for our platform team. Write automated tests and collaborate with product engineers.',
]: doc.add_paragraph(line)
doc.save(target/'job.docx')
