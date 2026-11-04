"""Content validation, bounded archive reads and real fail-closed ClamAV scan."""
from __future__ import annotations
import io
import socket
import struct
import time
import zipfile
from pathlib import PurePosixPath
from ..config import settings
from .storage import validate_client_filename
from .upload_validate import detect_kind, _check_double_extension
from .resume_intake_errors import IntakeError

MIMES = {"pdf": "application/pdf", "doc": "application/msword",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}


def scanner_ready():
    try:
        with socket.create_connection((settings.resume_clamd_host, settings.resume_clamd_port), timeout=3) as conn:
            conn.settimeout(3)
            conn.sendall(b"zPING\0")
            return conn.recv(64).rstrip(b"\0\n") == b"PONG"
    except OSError:
        return False


def scan(data: bytes):
    """ClamAV INSTREAM. An unavailable/invalid scanner can never return clean."""
    try:
        deadline = time.monotonic() + settings.resume_scan_timeout_s
        with socket.create_connection((settings.resume_clamd_host, settings.resume_clamd_port), timeout=3) as conn:
            conn.sendall(b"zINSTREAM\0")
            for offset in range(0, len(data), 65536):
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError
                conn.settimeout(remaining)
                chunk = data[offset:offset + 65536]
                conn.sendall(struct.pack("!I", len(chunk)) + chunk)
            conn.sendall(b"\0\0\0\0")
            reply = b""
            while len(reply) < 4096 and b"\0" not in reply:
                conn.settimeout(max(.01, deadline - time.monotonic()))
                part = conn.recv(1024)
                if not part:
                    break
                reply += part
        answer = reply.rstrip(b"\0\n")
        if answer.endswith(b": OK"):
            return "clean"
        if answer.endswith(b" FOUND"):
            return "virus_detected"
    except (OSError, TimeoutError, ValueError):
        pass
    return "scan_required"


def validate_resume(name, data, limit_mb, mime=""):
    try:
        return _validate_resume(name, data, limit_mb, mime)
    except IntakeError:
        raise
    except (zipfile.BadZipFile, OSError, RuntimeError, ValueError):
        raise IntakeError("rejected", "The document is corrupt or unreadable.") from None


def _validate_resume(name, data, limit_mb, mime=""):
    try:
        validate_client_filename(name)
        _check_double_extension(name)
    except ValueError as exc:
        raise IntakeError("rejected", str(exc)) from None
    ext = PurePosixPath(name).suffix.lower()
    if ext not in {".pdf", ".doc", ".docx"}:
        raise IntakeError("unsupported_format", "Only PDF, DOCX or DOC resumes are supported.")
    if not data:
        raise IntakeError("rejected", "The file is empty.")
    if len(data) > limit_mb * 1024 * 1024:
        raise IntakeError("rejected", f"Resume exceeds the {limit_mb} MB limit.")
    kind = detect_kind(data)
    if kind == "doc" and ext == ".docx":
        import olefile
        with olefile.OleFileIO(io.BytesIO(data)) as ole:
            if ole.exists("EncryptedPackage") or ole.exists("EncryptionInfo"):
                raise IntakeError("password_protected", "Encrypted Word documents cannot be processed.")
    if kind != ext[1:]:
        raise IntakeError("rejected", "File signature does not match its extension.")
    if mime and mime.split(";", 1)[0].strip().lower() not in {MIMES[kind], "application/octet-stream", "application/x-ole-storage" if kind == "doc" else MIMES[kind]}:
        raise IntakeError("rejected", "Declared MIME type does not match the resume.")
    if kind == "docx":
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            names = archive.namelist()
            if "word/document.xml" not in names or "[Content_Types].xml" not in names:
                raise IntakeError("rejected", "The Word document is corrupt or incomplete.")
            if any(info.flag_bits & 1 for info in archive.infolist()):
                raise IntakeError("password_protected", "Encrypted Word archives cannot be processed.")
            if any("vbaproject" in n.lower() or "encryptedpackage" in n.lower() for n in names):
                raise IntakeError("rejected", "Macro-enabled or encrypted documents are not supported.")
            if sum(info.file_size for info in archive.infolist()) > 30 * 1024 * 1024:
                raise IntakeError("rejected", "Word document exceeds the decompression limit.")
            if archive.getinfo('[Content_Types].xml').file_size > 1024 * 1024:
                raise IntakeError("rejected", "Word content metadata exceeds the safe size limit.")
            content_types = archive.read('[Content_Types].xml').lower()
            if b'macroenabled' in content_types or b'vbaproject' in content_types:
                raise IntakeError("rejected", "Macro-enabled documents are not supported.")
    if kind == "doc":
        import olefile
        try:
            with olefile.OleFileIO(io.BytesIO(data)) as ole:
                if any(part.casefold() in {"vba", "macros", "_vba_project"} for path in ole.listdir() for part in path):
                    raise IntakeError("rejected", "Word documents containing macros are not supported.")
                if ole.exists("EncryptedPackage") or ole.exists("EncryptionInfo"):
                    raise IntakeError("password_protected", "Encrypted documents cannot be processed.")
                if not ole.exists("WordDocument"):
                    raise IntakeError("rejected", "The legacy Word document is corrupt.")
                header = ole.openstream("WordDocument").read(12)
                if len(header) < 12:
                    raise IntakeError("rejected", "The legacy Word document is corrupt.")
                if int.from_bytes(header[10:12], "little") & 0x8100:
                    raise IntakeError("password_protected", "Password-protected documents cannot be processed.")
        except IntakeError:
            raise
        except (OSError, ValueError):
            raise IntakeError("rejected", "The legacy Word document is corrupt.") from None
    return kind


def inspect_zip(archive, limits):
    entries = [info for info in archive.infolist() if not info.is_dir()]
    if not entries:
        raise IntakeError("rejected", "The ZIP is empty.")
    if len(entries) > limits.zipMaxFiles:
        raise IntakeError("rejected", f"ZIP exceeds the {limits.zipMaxFiles}-file limit.")
    if any(info.flag_bits & 1 for info in entries):
        raise IntakeError("password_protected", "Password-protected ZIP files are not supported.")
    if sum(info.file_size for info in entries) > limits.expandedMaxMb * 1024 * 1024:
        raise IntakeError("rejected", "ZIP exceeds the total decompression limit.")
    return entries


def read_zip_entry(archive, info, limits):
    path = PurePosixPath(info.filename.replace("\\", "/"))
    if path.is_absolute() or ".." in path.parts or ":" in info.filename or "\x00" in info.filename or (info.external_attr >> 16) & 0o170000 == 0o120000:
        raise IntakeError("rejected", "Unsafe archive entry path or symbolic link.")
    if path.suffix.lower() in {".zip", ".7z", ".rar"}:
        raise IntakeError("unsupported_format", "Nested archives are not supported.")
    if path.suffix.lower() not in {".pdf", ".doc", ".docx"}:
        raise IntakeError("unsupported_format", "Archive entry is not a supported resume.")
    if info.file_size > limits.resumeMaxMb * 1024 * 1024 or info.file_size > max(1, info.compress_size) * 200:
        raise IntakeError("rejected", "Archive entry exceeds size or compression-ratio limits.")
    try:
        with archive.open(info) as source:
            data = source.read(limits.resumeMaxMb * 1024 * 1024 + 1)
    except (OSError, RuntimeError, zipfile.BadZipFile):
        raise IntakeError("rejected", "Archive entry is corrupt.") from None
    return path.name, data
