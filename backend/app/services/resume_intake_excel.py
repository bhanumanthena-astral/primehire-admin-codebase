"""Strict XLSX template parsing, read-only and with bounded decompression."""
from __future__ import annotations
import io
import json
import zipfile
from datetime import date, datetime
from pydantic import ValidationError
from ..schemas.resume_intake import CandidateProfile
from .resume_intake_errors import IntakeError

COLUMNS = {
    "Candidate Name": "name", "Email": "email", "Phone": "phone", "Resume File Name": "resumeFileName",
    "Current Location": "currentLocation", "Preferred Locations": "preferredLocations", "Total Experience": "experienceYears",
    "Current Company": "currentCompany", "Current Designation": "currentDesignation", "Department": "department",
    "Role": "role", "Industry": "industry", "Key Skills": "skills", "Resume Headline": "headline", "Summary": "summary",
    "UG Degree": "ugDegree", "UG Specialization": "ugSpecialization", "UG University": "ugUniversity", "UG Graduation Year": "ugGraduationYear",
    "PG Degree": "pgDegree", "PG Specialization": "pgSpecialization", "PG University": "pgUniversity", "PG Graduation Year": "pgGraduationYear",
    "Doctorate Degree": "doctorateDegree", "Doctorate Specialization": "doctorateSpecialization",
    "Doctorate University": "doctorateUniversity", "Doctorate Graduation Year": "doctorateGraduationYear",
    "Gender": "gender", "Marital Status": "maritalStatus", "Home Town": "homeTown", "Pin Code": "pinCode", "Date of Birth": "dateOfBirth",
}


def build_template():
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill
    book = Workbook()
    sheet = book.active
    sheet.title = "Candidates"
    sheet.append(list(COLUMNS))
    sheet.freeze_panes = "A2"
    sheet.auto_filter.ref = sheet.dimensions
    for cell in sheet[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="B56D22")
        sheet.column_dimensions[cell.column_letter].width = 24
    for column in ["C", "AE"]:
        for row in range(2, 22):
            sheet[f"{column}{row}"].number_format = "@"
    output = io.BytesIO()
    book.save(output)
    return output.getvalue()


def parse_excel(data, max_rows=5000, require_resume=False):
    from openpyxl import load_workbook
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            infos = archive.infolist()
            if len(infos) > 500 or sum(i.file_size for i in infos) > 50 * 1024 * 1024:
                raise IntakeError("rejected", "Excel exceeds the decompression limit.")
            if any("vbaProject" in i.filename or "externalLinks/" in i.filename for i in infos):
                raise IntakeError("rejected", "Excel macros and external links are not supported.")
        book = load_workbook(io.BytesIO(data), read_only=True, data_only=False, keep_links=False)
    except IntakeError:
        raise
    except Exception:
        raise IntakeError("rejected", "The Excel file is corrupt, encrypted or not XLSX.") from None
    try:
        if len(book.worksheets) != 1:
            raise IntakeError("rejected", "Use the single-sheet Candidates template.")
        sheet = book.worksheets[0]
        hard_rows = max(1000, max_rows * 2 + 1)
        if sheet.max_column > len(COLUMNS) or sheet.max_row > hard_rows:
            raise IntakeError("rejected", f"Excel exceeds column limits or the {max_rows}-row limit.")
        rows = sheet.iter_rows(max_row=sheet.max_row, max_col=len(COLUMNS))
        headers = [str(c.value or "").strip() for c in next(rows)]
        populated = [h for h in headers if h]
        if len(set(populated)) != len(populated) or any(h not in COLUMNS for h in populated):
            raise IntakeError("rejected", "Unexpected or duplicate Excel columns. Use the prescribed template.")
        if "Candidate Name" not in headers or not ({"Email", "Phone"} & set(headers)) or (require_resume and "Resume File Name" not in headers):
            raise IntakeError("rejected", "Required columns are missing: Candidate Name, Email or Phone, and Resume File Name when attaching resumes.")
        output = []
        seen_contacts = set()
        nonempty = 0
        for number, row in enumerate(rows, 2):
            if all(cell.value in (None, "") for cell in row):
                continue
            nonempty += 1
            if nonempty > max_rows:
                raise IntakeError("rejected", f"Excel exceeds the {max_rows}-row limit.")
            item = {"rowNumber": number, "profile": {}, "resumeFileName": "", "warnings": []}
            if any(cell.data_type == "f" for cell in row):
                output.append({**item, "status": "rejected", "error": "Excel formulas are not allowed in candidate rows."})
                continue
            values = {}
            try:
                for header, cell in zip(headers, row):
                    if not header or cell.value in (None, ""):
                        continue
                    key, value = COLUMNS[header], cell.value
                    if key == "resumeFileName":
                        item[key] = str(value).strip()
                        if len(item[key]) > 255:
                            raise ValueError("Resume File Name is too long")
                        continue
                    if key in {"skills", "preferredLocations"}:
                        values[key] = [v.strip() for v in str(value).replace(";", ",").split(",") if v.strip()]
                    elif key == "dateOfBirth":
                        values[key] = value.date() if isinstance(value, datetime) else value
                    elif key.endswith("GraduationYear") or key == "experienceYears":
                        if isinstance(value, bool):
                            raise ValueError("Numeric candidate fields cannot be true/false")
                        values[key] = value
                    else:
                        if key in {"phone", "pinCode"} and isinstance(value, float):
                            if not value.is_integer():
                                raise ValueError("Phone/postal code must be text or whole digits")
                            value = int(value)
                        values[key] = str(value)
                profile = CandidateProfile.model_validate(values)
                if len(profile.name) < 2 or not (profile.email or profile.phone):
                    raise ValueError("Candidate Name and a valid Email or Phone are required")
                item["profile"] = profile.model_dump(mode="json")
                contacts = ([f'email:{profile.email}'] if profile.email else []) + ([f'phone:{profile.phone[-10:]}'] if profile.phone else [])
                duplicate = any(contact in seen_contacts for contact in contacts)
                seen_contacts.update(contacts)
                item["status"] = "duplicate_suspected" if duplicate else "review_required"
                if duplicate:item['warnings'].append('Another row in this worksheet uses the same contact information. Review the identity before confirming.')
                if not item["resumeFileName"]:
                    item["warnings"].append("No resume attached; ATS will use the confirmed profile.")
            except ValidationError as exc:
                item.update(status="rejected", error="; ".join(f"{'.'.join(map(str,e['loc']))}: {e['msg']}" for e in exc.errors())[:1000])
            except ValueError as exc:
                item.update(status="rejected", error=str(exc)[:1000])
            except TypeError:
                item.update(status="rejected", error="Candidate row contains invalid field types.")
            output.append(item)
        if not output:
            raise IntakeError("rejected", "The Excel sheet has no candidate rows.")
        return {"rows": output}
    finally:
        book.close()
