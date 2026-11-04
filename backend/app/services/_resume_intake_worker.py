"""Isolated local parser for Module 2. No secrets/config/network imports."""
from __future__ import annotations
import base64
import io
import json
import re
import subprocess
import sys
import tempfile
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))


def parse_document(data, kind, options):
    from app.services.resume_intake_errors import IntakeError
    if kind == "pdf":
        import pymupdf as fitz
        try:
            doc = fitz.open(stream=data, filetype="pdf")
        except Exception:
            raise IntakeError("rejected", "PDF is corrupt or unreadable.") from None
        with doc:
            if doc.needs_pass:
                raise IntakeError("password_protected", "PDF is password protected or encrypted.")
            if doc.is_repaired or doc.page_count == 0:
                raise IntakeError("rejected", "PDF is corrupt or incomplete.")
            if doc.page_count > 20:
                raise IntakeError("rejected", "Resume exceeds the 20-page limit.")
            parts = []
            used_ocr = False
            for page in doc:
                text = page.get_text(sort=True)
                if len(text.strip()) < 30 and page.get_images():
                    tessdata = options.get("tessdata", "")
                    if not tessdata or not Path(tessdata, "eng.traineddata").is_file():
                        raise IntakeError("ocr_required", "This resume needs OCR. Configure local OCR and retry.")
                    if page.rect.width * page.rect.height * (150 / 72) ** 2 > 15_000_000:
                        raise IntakeError("rejected", "Scanned page exceeds the safe OCR dimensions.")
                    try:
                        textpage = page.get_textpage_ocr(language="eng", dpi=150, full=True, tessdata=tessdata)
                        text = page.get_text(textpage=textpage, sort=True)
                        used_ocr = True
                    except Exception:
                        raise IntakeError("ocr_required", "OCR could not read this resume. Check the local OCR service and retry.") from None
                parts.append(text)
            text = "\n".join(parts)
    elif kind == "docx":
        from app.services.resume_extract import extract_text
        text = extract_text(data, "docx")
        used_ocr = False
    elif kind == "doc":
        converter = options.get("converter", "")
        if not converter or not Path(converter).is_file() or "antiword" not in Path(converter).name.lower():
            raise IntakeError("conversion_required", "Legacy DOC needs a configured local Word converter. Retry after setup or upload DOCX.")
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder, "resume.doc")
            source.write_bytes(data)
            try:
                env = dict(os.environ)
                mapping = Path(converter).parent / 'share' / 'antiword'
                if mapping.is_dir():
                    env['ANTIWORDHOME'] = str(mapping)
                completed = subprocess.run([converter, '-m', 'UTF-8.txt', '-w', '0', str(source)],
                    capture_output=True, timeout=20, check=True, env=env)
                text = completed.stdout.decode("utf-8", errors="replace")
            except (OSError, subprocess.SubprocessError):
                raise IntakeError("conversion_required", "The Word converter could not process this resume.") from None
        used_ocr = False
    else:
        raise IntakeError("unsupported_format", "Unsupported resume format.")
    if len(text.strip()) < 10:
        raise IntakeError("ocr_required", "No usable text was found. OCR or a replacement resume is required.")
    from app.services.resume_extract import deterministic_parse
    from app.schemas.resume_intake import CandidateProfile
    extracted = deterministic_parse(text[:50000])
    values = {k: v for k, v in extracted.items() if k in CandidateProfile.model_fields}
    warnings = []
    name_label = re.search(r"(?im)^\s*(?:candidate name|full name|name)\s*:\s*([^\r\n]+)", text)
    if name_label:
        values['name'] = name_label.group(1).strip()[:100]
    else:
        for line in text.splitlines()[:3]:
            line = line.strip()
            if 2 <= len(line) <= 100 and '@' not in line and not any(c.isdigit() for c in line) and len(line.split()) <= 6 and all(c.isalpha() or c in " .'-" for c in line) and line.casefold() not in {'resume','curriculum vitae','professional summary','personal information'}:
                values['name'] = line
                break
    phone_label = re.search(r"(?im)^\s*(?:phone|phone number|mobile|contact number|tel)\s*:\s*(\+?[\d(). -]{7,25})", text)
    if phone_label:
        values['phone'] = phone_label.group(1).strip()
    if values.get("experienceYears") is not None and not 0 <= values["experienceYears"] <= 50:
        values["experienceYears"] = None
    if values.get("phone") and not 7 <= len(re.sub(r"\D", "", values["phone"])) <= 15:
        values["phone"] = ""
    labels = {"currentLocation": "current location|location", "currentCompany": "current company|company",
        "currentDesignation": "current designation|designation", "department": "department", "role": "role",
        "industry": "industry", "homeTown": "home town|hometown", "headline": "resume headline|headline"}
    for key, label in labels.items():
        match = re.search(rf"(?im)^\s*(?:{label})\s*:\s*([^\n\r]+)", text)
        if match:
            limit = {"currentCompany": 150, "headline": 250}.get(key, 100)
            values[key] = match.group(1).strip()[:limit]
    for key, label in [('preferredLocations','preferred locations?'),('pinCode','pin code|postal code'),('dateOfBirth','date of birth|dob'),('gender','gender'),('maritalStatus','marital status')]:
        match = re.search(rf'(?im)^\s*(?:{label})\s*:\s*([^\r\n]+)', text)
        if match:
            value = match.group(1).strip()
            if key == 'preferredLocations':
                values[key] = [part.strip() for part in value.replace(';',',').split(',') if part.strip()][:30]
            elif key == 'dateOfBirth':
                from datetime import datetime
                for pattern in ['%Y-%m-%d','%d/%m/%Y','%d-%m-%Y','%d %B %Y']:
                    try:
                        values[key] = datetime.strptime(value,pattern).date()
                        break
                    except ValueError:
                        pass
            else:
                values[key] = value.lower().replace(' ','_').replace('-','_') if key in {'gender','maritalStatus'} else value[:12]
    for level in ['ug','pg','doctorate']:
        for suffix, maximum in [('Degree',100),('Specialization',150),('University',200),('GraduationYear',4)]:
            match = re.search(rf"(?im)^\s*{level}\s*{suffix.replace('GraduationYear','graduation year')}\s*:\s*([^\r\n]+)", text)
            if match:
                value = match.group(1).strip()
                values[f'{level}{suffix}'] = int(value) if suffix == 'GraduationYear' and value.isdigit() else None if suffix == 'GraduationYear' else value[:maximum]
    for key, patterns in [('ugDegree',r'(?i)^(b\.?\s*tech|bca|b\.?\s*sc|bachelor)'),('pgDegree',r'(?i)^(m\.?\s*tech|mca|mba|m\.?\s*sc|master)'),('doctorateDegree',r'(?i)^(ph\.?\s*d|doctorate)')]:
        if not values.get(key):
            values[key] = next((degree for degree in values.get('education',[]) if re.search(patterns,degree)), '')
    from app.services.resume_intake_fields import enrich
    values = enrich(text, values)
    from pydantic import ValidationError
    # Invalid optional suggestions do not discard the rest of the resume.
    for _ in range(len(CandidateProfile.model_fields)):
        try:
            profile = CandidateProfile.model_validate(values)
            break
        except ValidationError as exc:
            for error in exc.errors():
                key = error['loc'][0]
                values.pop(key,None)
                warnings.append(f'{key}: extracted value needs manual review.')
    else:
        raise IntakeError('rejected','Candidate fields could not be validated safely.')
    confidence = {key: ("review" if used_ocr or key not in {'email','phone'} and not re.search(rf'(?im)^\s*{re.escape(key)}\s*:',text) else "extracted") for key, value in profile.model_dump().items() if value not in (None, "", [])}
    return {"profile": profile.model_dump(mode="json"), "rawText": text[:50000], "confidence": confidence,
        "warnings": warnings + (["OCR extraction requires careful review."] if used_ocr else []) + (["Resume text was truncated at the processing limit."] if len(text) > 50000 else [])}


def main():
    try:
        from app.services._resume_intake_limits import install_limits
        install_limits()
    except Exception:
        print(json.dumps({"ok": False, "code": "failed", "message": "Parser isolation is unavailable. Restore the worker resource limits and retry."}))
        return
    try:
        payload = json.loads(sys.stdin.read())
        data = base64.b64decode(payload["data"], validate=True)
        kind, options = payload["kind"], payload.get("options", {})
        if kind == "xlsx":
            from app.services.resume_intake_excel import parse_excel
            result = parse_excel(data, options.get("maxRows", 5000), options.get("requireResume", False))
        else:
            result = parse_document(data, kind, options)
        print(json.dumps({"ok": True, "result": result}))
    except Exception as exc:
        # Never echo parser exceptions, documents, paths or contacts.
        print(json.dumps({"ok": False, "code": getattr(exc, "code", "rejected"),
            "message": getattr(exc, "message", "Document could not be parsed safely.")}))


if __name__ == "__main__":
    main()
