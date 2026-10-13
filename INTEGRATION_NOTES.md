# PrimeHire API Integration Notes

This document captures the architecture, implementation choices, and handling of known data model gaps/ambiguities for the **Student Assessment & Candidate Evaluation Platform** integration with the **PrimeHire API (v1)**.

---

## 1. Architecture Overview

To secure sensitive API credentials (`x-access-key` and `x-secret-key`) and satisfy security directives, the application employs a full-stack **BFF (Backend-For-Frontend)** architecture:

1. **Client-Side Proxy (`src/lib/primehireClient.ts`)**:
   - Provides clean, strongly-typed asynchronous functions for all UI modules.
   - Forwards request data to the secure server proxy under the `/api/backend/*` namespace.
   - Automatically handles **camelCase ⇆ snake_case** transformations dynamically.
   - Interview operations use real provider responses. API errors propagate to the UI without fabricated credentials, statuses, or reports.

2. **Express Proxy Server (`server.ts`)**:
   - Integrates with the production Vite runner.
   - Intercepts requests on the `/api/backend/*` mountpoint.
   - Safely injects the credential headers (`x-access-key`, `x-secret-key`) retrieved from server-side environment variables before routing them to `https://api.placement.vils.ai/primehire/api/v1`.
   - Never exposes sensitive keys to browser bundles.

---

## 2. Dynamic Gaps & Inconsistencies Handling

The following known API discrepancies have been handled programmatically:

### A. Identifier Mapping (`interview_id` vs. `response_id` vs. `candidate_id`)
- **Issue**: Ambiguity regarding whether endpoints expect `interview_id`, `response_id`, or `candidate_id` when fetching reports or status.
- **Handling**:
  - The `Candidate` type has been enriched in `src/types.ts` with optional `interviewId` and `responseId` fields.
  - Upon generating links (`POST /interview`), the client saves returned identifiers. Missing response IDs and candidate UUIDs remain unresolved.
  - Status, rescheduling, and reporting use the genuine interview ID. Password reset requires a verified provider UUID.

### B. "Generate Link" Behavior
- **Issue**: No dedicated standalone endpoint exists to generate/distribute invite links directly.
- **Handling**:
  - Leverages `POST /interview` defensively. Passing candidate schedules to this endpoint registers and provisions credentials in a single transaction, returning the unique workspace URLs.

### C. HR Round Evaluation Matrix
- **Issue**: The API does not accept scoring fields (`max_score`, `weightage`) for **HR Round** questions, but the UI allows input.
- **Handling**:
  - The assessment creation proxy strips out or skips serializing `maxScore`/`weightage` fields for questions categorized under `roundType === 'HR'`.

---

## 3. Production Interview Operations
- The candidate workspace simulator, completion and expiry shortcuts, and forced API failure control have been removed.
- `src/lib/interviewOperations.ts` handles real scheduling, status, password, and report requests. Failures remain visible and never create local success data.
- Historical testing fields and fabricated identifiers are discarded when candidates are loaded. Import safeguards still identify old test records and strip their testing payloads.
- Email templates retain a content preview; previewing does not send mail or change candidate status.

---

## 4. Configuration Instructions

Define the credentials in `.env` (refer to `.env.example`):
```env
PRIMEHIRE_ACCESS_KEY=your_access_key
PRIMEHIRE_SECRET_KEY=your_secret_key
```
Once configured, the BFF proxy will immediately direct live candidate submissions, assessment profiles, and scoring to the cloud endpoint.
