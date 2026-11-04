# Resume upload interface

The resume upload page uses the shared Elite HR colors and cards. Users choose
an eligible open job, drop files or browse, review individual file names and
sizes, confirm consent, then upload. The selected-job summary stays next to the
drop zone on desktop and moves below it on smaller screens.

`ResumeFilePicker.tsx` appends subsequent selections, skips duplicate selections,
supports removal and clearing, and reports unsupported, empty, oversized or
excess files. Its limits match the application's defaults: PDF/DOCX/DOC,
5 MB per file and ten files per batch. The server remains responsible for
authoritative content, permission and size validation.

While uploading, file controls, the job selector and consent are locked; the UI
shows an indeterminate upload indicator. Processing progress comes from actual
batch counts, followed by the existing per-file results and batch history.
Failed requests retain the selected files so the user can retry.

No backend, CRUD, schema or environment configuration changes are included.

Regression checks cover mixed valid/invalid selections, duplicate files, batch
limits, removal, disabled controls and consent. `e2e/resume-upload.spec.ts`
checks desktop/mobile layout, browser file drops, the existing multipart fields,
pending controls, failure/retry and processing progress with mocked upload
responses. It does not upload to the live database.
