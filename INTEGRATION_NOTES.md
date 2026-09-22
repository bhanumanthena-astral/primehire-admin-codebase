# PrimeHire API Integration Notes

This document captures the architecture, implementation choices, and handling of known data model gaps/ambiguities for the **Student Assessment & Candidate Evaluation Platform** integration with the **PrimeHire API (v1)**.

---

## 1. Architecture Overview

To secure sensitive API credentials (`x-access-key` and `x-secret-key`) and satisfy security directives, the application employs a full-stack **BFF (Backend-For-Frontend)** architecture:

1. **Client-Side Proxy (`src/lib/primehireClient.ts`)**:
   - Provides clean, strongly-typed asynchronous functions for all UI modules.
   - Forwards request data to the secure server proxy under the `/api/primehire/*` namespace.
   - Automatically handles **camelCase ⇆ snake_case** transformations dynamically.
   - Incorporates robust offline fallbacks to standard client-side state storage if keys are absent or endpoints fail.

2. **Express Proxy Server (`server.ts`)**:
   - Integrates with the production Vite runner.
   - Intercepts requests on the `/api/primehire/*` mountpoint.
   - Safely injects the credential headers (`x-access-key`, `x-secret-key`) retrieved from server-side environment variables before routing them to `https://api.placement.vils.ai/primehire/api/v1`.
   - Never exposes sensitive keys to browser bundles.

---

## 2. Dynamic Gaps & Inconsistencies Handling

The following known API discrepancies have been handled programmatically:

### A. Identifier Mapping (`interview_id` vs. `response_id` vs. `candidate_id`)
- **Issue**: Ambiguity regarding whether endpoints expect `interview_id`, `response_id`, or `candidate_id` when fetching reports or status.
- **Handling**:
  - The `Candidate` type has been enriched in `src/types.ts` with optional `interviewId` and `responseId` fields.
  - Upon generating links (`POST /interview`), the client saves both returned IDs.
  - Subsequent requests for status (`GET /interview/{id}/status`), rescheduling, or reporting fall back defensively on whichever ID is available.

### B. "Generate Link" Behavior
- **Issue**: No dedicated standalone endpoint exists to generate/distribute invite links directly.
- **Handling**:
  - Leverages `POST /interview` defensively. Passing candidate schedules to this endpoint registers and provisions credentials in a single transaction, returning the unique workspace URLs.

### C. HR Round Evaluation Matrix
- **Issue**: The API does not accept scoring fields (`max_score`, `weightage`) for **HR Round** questions, but the UI allows input.
- **Handling**:
  - The assessment creation proxy strips out or skips serializing `maxScore`/`weightage` fields for questions categorized under `roundType === 'HR'`.

---

## 3. Local Sandbox & Simulation Support
- **Decoupling**: The **Candidate Workspace Simulator** (`CandidateWorkspaceSimulator.tsx`) remains a robust local tester experience.
- **Auditing**: It allows recruiters to trial full test experiences using candidate credentials, automatically calculating and compiling mock performance summaries to simulate report compilation.

---

## 4. Configuration Instructions

Define the credentials in `.env` (refer to `.env.example`):
```env
PRIMEHIRE_ACCESS_KEY=your_access_key
PRIMEHIRE_SECRET_KEY=your_secret_key
```
Once configured, the BFF proxy will immediately direct live candidate submissions, assessment profiles, and scoring to the cloud endpoint.
