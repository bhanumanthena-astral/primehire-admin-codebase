"""Bounded generated-profile PDF and XLSX exports, no active content."""
import html
import io
from .resume_intake_excel import COLUMNS


def profile_pdf(profile, job_title, ats):
    import pymupdf as fitz
    escape = lambda value: html.escape(str(value), quote=True)
    fields = []
    for label, key in COLUMNS.items():
        value = profile.get(key)
        if value not in (None, "", []):
            value = ", ".join(map(str, value)) if isinstance(value, list) else value
            text = str(value)
            # Long paragraphs may exceed a page; short blocks flow reliably.
            paragraphs = "".join(f"<p>{escape(text[start:start + 500])}</p>" for start in range(0, len(text), 500))
            fields.append(f"<h4>{escape(label)}</h4>{paragraphs}")
    body = f"<h3>PRIMEHIRE · CANDIDATE PROFILE</h3><h1>{escape(profile.get('name','Candidate'))}</h1><p>{escape(job_title)}</p>"
    if ats:
        body += f"<p><b>ATS: {int(ats['overall'])}/100 · {escape(ats['category'])}</b></p><p>Advisory, application-specific evaluation.</p>"
    body += "".join(fields)
    css = "body{font-family:sans-serif;font-size:10pt;color:#29241e}h1{font-size:23pt}h3{font-size:9pt;color:#a76720}h4{font-size:10pt;color:#70552b;border-bottom:1pt solid #e7d9c0;margin-bottom:4pt}p{margin-top:3pt}"
    output = io.BytesIO()
    writer = fitz.DocumentWriter(output)
    story = fitz.Story(html=body, user_css=css)
    page = fitz.paper_rect("a4")
    content = fitz.Rect(36, 36, page.width - 36, page.height - 36)
    try:
        for _ in range(30):
            device = writer.begin_page(page)
            more, _ = story.place(content)
            story.draw(device)
            writer.end_page()
            if not more:
                break
        else:
            raise ValueError("Generated profile exceeds the page limit")
    finally:
        writer.close()
    return output.getvalue()


def export_xlsx(items, safe_cell):
    from openpyxl import Workbook
    from openpyxl.cell import WriteOnlyCell
    book = Workbook(write_only=True)
    sheet = book.create_sheet("Candidates")
    sheet.append(["File Name", "Status", "ATS Score", *COLUMNS.keys()])
    for item in items:
        profile = item.get("profile", {})
        values = [item["fileName"], item["status"], (item.get("ats") or {}).get("overall", ""), *[profile.get(key) for key in COLUMNS.values()]]
        cells = []
        for value in values:
            cell = WriteOnlyCell(sheet, value=value if isinstance(value, (int, float)) and not isinstance(value, bool) else safe_cell(value))
            if not isinstance(value, (int, float)) or isinstance(value, bool):
                cell.data_type = "s"
            cells.append(cell)
        sheet.append(cells)
    output = io.BytesIO()
    book.save(output)
    return output.getvalue()
