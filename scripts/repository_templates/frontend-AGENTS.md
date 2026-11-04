# Frontend repository

Standalone React/Vite UI with a Cloudflare Pages same-origin API gateway.
Use Node 22, npm ci, npm run typecheck, npm run lint, npm test, npm run build.
Publish dist/; keep _worker.js, _routes.json and _headers at its root.
Browser API requests stay same-origin /api/*. BACKEND_ORIGIN is a Pages runtime
binding, never a browser variable. Authentication/authorization and data rules
are enforced by the separate Oracle backend. Do not add provider credentials,
database secrets, Python source, uploads or private environment files here.
Preserve public/ illustration assets, accessibility, mobile layout, masking,
review locking and success feedback. Coordinate /api contract changes with the
backend repo. There are no backend migrations in this repo.
