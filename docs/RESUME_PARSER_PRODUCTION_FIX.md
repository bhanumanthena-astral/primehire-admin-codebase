# Production resume parsing fix — 19 November 2026

Deployed backend release: `20261119-resume-skills-02`.
Previous release retained: `20261118-ats-resume-03`.
Reference: `JOB-cbb30f522aed4cc791e7f01074320649` — Backend Developer Intern.

## Findings and changes

The deployed parser used a narrow legacy catalogue and the list projection omitted skills even when stored. The fix adds curated aliases and evidence, recovers DOCX table/header/text-box content, preserves parsed skills in list responses, and safely redacts supporting evidence. Ambiguous/negated terms are guarded. Cached regex patterns contain no resume data; duplicate alias hits do not inflate occurrence counts. A profile exceeding the existing 150-skill limit retains a bounded list and emits a warning instead of silently losing all skills.

The release preserves the existing ATS weights and hiring logic. Canonical reviewed skill names match symmetric aliases; removed skills are not reintroduced into scoring. No dependency pins, APIs, mail configuration, hiring transitions or database schema migrations changed.

Only 12 parser/evidence/repair files were overlaid on the exact deployed baseline, excluding unrelated uncommitted development work. The packaged ATS module is a minimal production-baseline patch; the larger local ATS development rewrite was deliberately not shipped. Exact code is in `artifacts/backend/elitehr-backend-20261119-resume-skills-02.tar.gz` with checksum and release manifest. The file list is recorded in `.tmp/parser-hotfix-files.json`.

## Verification and repair

- 80 checks passed against the staged production package; the separate repair guard/idempotency test passed (81 distinct checks). A related local development run passed 49 checks.
- Linux isolated-parser and alias-scoring smoke passed before rollout; parsing also passed as the actual unprivileged service user afterward.
- Configuration/database/scanner preflight passed. Native encrypted backup `elitehr-postgres-20261119T060042Z.enc` was created and authenticated decryption verified. A fresh restore exercise was not run in this pass.
- Deployment readiness passed with PostgreSQL, storage and scanner OK. API, resume and assessment units are active; final recent error-log query returned no errors.
- One-job dry run found 375 records, 372 eligible. Exactly 372 unreviewed, unconfirmed, unexpired profiles were refreshed with new skills and local-only advisory ATS previews. Each has fresh snapshot hashes, parser/score versions, visible skills and an audit record. All scores are within 0–100; zero eligible records remain. Previous ATS results are retained in `atsBeforeSkillRepair`.
- Human-reviewed, confirmed and other-job records are protected by scope, item leases and revision checks. No candidates were created, stages changed, invitations sent, or external AI calls made by the repair.
- In-place comparison measured approximately 29.82 ms mean text parsing per resume on this host. This excludes extraction/OCR/I/O and is not an upload-throughput SLA. With unchanged weights, 30 local scores increased, two decreased after false-positive correction, and 340 were unchanged.

## Remaining source-file limits and rollback

Two files still returned no usable text on an in-place, scanner-approved recheck. One other source remains rejected. These three retain their explicit review/error status; no skills or scores were fabricated. OCR language data is configured and present.

The previous code release and encrypted database/files/config backup remain available. Code rollback must be coordinated with the new optional profile evidence fields and the repaired suggestions; use the preserved backup/repair audits for any necessary targeted data restoration rather than overwriting concurrent user edits. No rollback was needed. No frontend deployment, DNS change or Git push was performed.

Evidence: `.tmp/parser-production-package-tests.log`, `.tmp/parser-fixed-tests.log`, `.tmp/parser-production-deployment2.log`, `.tmp/parser-production-repair.log`. Production document content and credentials were not exported to these reports.
