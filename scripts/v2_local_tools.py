"""Select project-local tools for development only; production uses explicit config."""
from pathlib import Path


def configure_local_tools(settings):
    if settings.is_production:
        return
    tools = Path(__file__).resolve().parents[1] / 'backend' / 'tools'
    if not settings.resume_ocr_tessdata and (tools / 'tessdata' / 'eng.traineddata').is_file():
        settings.resume_ocr_tessdata = str(tools / 'tessdata')
    converter = tools / 'antiword' / 'antiword.exe'
    if not settings.resume_doc_converter and converter.is_file():
        settings.resume_doc_converter = str(converter)
