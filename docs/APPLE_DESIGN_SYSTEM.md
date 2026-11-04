# Elite HR Apple-inspired web design

Applied at the user's request using https://github.com/dickwu/apple-design-skill.
Its SKILL.md, cross-platform translation, accessibility, layout, typography, color,
designing-for-macOS, buttons, sidebars, Liquid Glass, dark-mode and lists-and-tables
references were read. Reference Markdown stays in a temporary folder; no repository
script, skill installer, Apple font asset or proprietary icon pack is executed or
distributed. This is a responsive React/browser adaptation of the principles, not
a claim to provide native AppKit controls or Apple's native Liquid Glass material.

## Product and visual direction

Elite HR is a working tool for recruiters, administrators and interviewers. Its
job is to keep a candidate's progress, evidence and next action clear. The signature
element is the existing hiring journey and candidate timeline, surrounded by quiet
surfaces. A decorative marketing hero, repeated brand illustrations and fake macOS
window buttons would distract from that purpose, so they are excluded.

Plan critique: a generic blue dashboard is not enough. Keep job stages, assignment
context, score evidence and interview handoffs prominent; reduce visual noise in
the supporting controls. Retain Elite HR's name and existing Lucide icon vocabulary.

## Semantic tokens and contrast

| Role | Light | Dark | Contrast on its paired surface |
| --- | --- | --- | --- |
| Canvas / content surface | #f5f5f7 / #ffffff | #141416 / #1c1c1e | Background roles |
| Primary content | #1d1d1f | #f5f5f7 | 16.83:1 / 15.63:1 |
| Secondary content | #636366 | #a1a1a6 | 5.99:1 / 6.61:1 |
| Action accent / label | #0066cc / #ffffff | #64a8ff / #081a33 | 5.57:1 / 7.12:1 |
| Success | #237a3b | #7bd99a | Distinct text/icon status, never color alone |
| Destructive | #b42318 | #ff9b93 | Distinct text/icon status, never color alone |

Ratios are computed from sRGB relative luminance, not sampled from screenshots.
Controls use #8e8e93 outlines on white (3.26:1) and a visible accent focus ring.
Caution retains a separate semantic amber role. Data/grade colors retain meaning.

Typography uses the platform system stack: -apple-system, BlinkMacSystemFont,
Segoe UI, system-ui, sans-serif. No download of SF Pro or remote Google Fonts.
Roles: 28/24px page titles, 18/17px section headings, 15/14px body/data, 13/12px
labels, with no custom utility text below 11px. Tabular numerals align scores.
Use rem units for the shared control and text scale so zoom remains effective.

Regular layout: persistent sidebar + light toolbar + aligned workspace content.
Compact layout: menu button + toolbar + the same workspace, with grouped forms
stacking and tables scrolling internally rather than widening the whole document.

```text
Regular                          Compact
[Sidebar][Toolbar             ]  [Menu  Search  Appearance]
[       ][Title / actions      ]  [Title / actions         ]
[       ][Job hiring journey   ]  [Job hiring journey wrap ]
[       ][Content / data table ]  [Content / table scroll  ]
```

## Components and accessibility

Use subdued sidebar/toolbar translucency only in the functional navigation layer.
Content cards, forms, reports and dialogs have opaque adaptive surfaces. Shared
buttons use a prominent primary action, neutral secondary actions and explicit
destructive styling, with immediate hover/press/focus feedback. Avoid hover lifts
on frequent controls. Controls are at least 44px high on coarse pointers/compact
layouts; desktop utility controls stay at least 28px, with larger default targets.

Retain portal-based modal placement, focus handling, escape dismissal, and all
existing action confirmations. Keep touch targets usable, keyboard focus visible,
light/dark appearance consistent, and respect reduced motion, reduced transparency,
increased contrast and forced colors. Browser zoom and system font sizing replace
native Dynamic Type; native menu-bar or window-chrome conventions do not apply.

## Boundaries and verification

No hiring or assessment behavior, database CRUD, provider integration, permission
model or report scores are changed. Print/export documents keep explicit print
colors. Screen report surfaces use the same adaptive semantic tokens as the app.
Search by name/email from the preceding change is retained. Verify both appearances
and compact layouts using synthetic accounts, existing unit/browser journeys and
contrast checks. Do not send real invitations or access real candidate data for QA.

## Verified result — 2 November 2026

The screen migration covers the app shell and sign-in, jobs/workspaces, resume
intake and ATS review, candidate management, assessment management/invitations,
reports, team access, recruitment trackers/calendar, and the technical, managerial
and HR portals. Standalone portals share the same appearance control. Existing
invitation-table name/email search and report-version integration are preserved.

Visual critique: the first large-text view compressed filters and card metrics.
Job filters now use a container query and the card grid uses a rem-based minimum
width, allowing a full-width card at 200% text. Active sidebar selection retains
its contrasting background while hovered. Screen reports use adaptive action and
status tokens; print/export surfaces retain explicit print colors.

Validation uses synthetic fixtures with no Atlas, real invitations or provider
mutations: 235 frontend tests and 1,853 backend tests passed (83.65% backend
coverage). Assessment/design (6), resume intake (5), candidate management (3) and
recruitment portals (5) browser journeys passed. Dedicated design checks verify
system typography, light/dark surfaces, active-navigation contrast, mobile focus
restoration, 44px menu targets and 200% text reflow. Production build and TypeScript
checks pass. The local frontend responds with HTTP 200 at http://127.0.0.1:3000; its redesigned sign-in renders in a clean browser context with zero runtime errors. Final focused job/portal/appearance tests (22) and the technical portal dark-mode/review browser journey also pass.
No auth surface changed. No database migration, new setting or dependency added.

## Shared alignment corrections — 3 November 2026

Labels using `space-y-1` or `space-y-2` now use an actual grid gap so bare label
text has space above its input, select or textarea. Shared controls retain their
own focus ring without a second global outline. Textareas resize vertically and
stay within their container; table wrappers retain horizontal scrolling.
The interview review workspace has a readable maximum width, consistent rating
card alignment and explicit form spacing. Report headers wrap actions and summary
text on narrow screens, and the app-header search can shrink without pushing
adjacent controls off screen. The recruitment browser journey checks the editable
review at 390, 768, 1280 and 1920 pixels, including label spacing and page overflow.
These are shared corrections and targeted screen checks, not a claim that every
possible application screen and data combination has been audited.
Validation: 273 frontend tests, all five recruitment browser journeys, TypeScript,
lint and the production build pass. Review screenshots at all four widths were
generated; the desktop screenshot was visually inspected. Existing Vite chunk-size
and mixed-import warnings remain.

Known follow-ups outside the visual change: the production lock still uses
pypdf 6.21.2; its audit reports seven existing advisories, with fixes listed in
6.21.3/6.21.4. The older development environment also has separate advisories and
is not the V2 production lock. No packages were changed by this task. Frontend
runtime audit reports zero vulnerabilities. Gitleaks is unavailable locally, so
its CI check was not reproduced. Vite retains its existing large-chunk warning;
route-level splitting is a separate performance change.
