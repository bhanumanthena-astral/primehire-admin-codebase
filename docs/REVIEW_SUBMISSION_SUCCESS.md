# Interview review submission confirmation

The user requests a clear success message, congratulations and appreciation for
the interviewer's time, a professional 3D character, and a return to the interview
screen after submitting a technical, managerial or HR review.

Only a successful existing review POST triggers confirmation. Its returned saved
record is authoritative; there is no extra detail GET that could misreport a
successful save as a submission failure. Errors retain entered feedback and allow
retry. An in-flight guard prevents duplicate submission. Saving a draft does not
show a final-submission message.

The interviewer returns immediately to My interviews (Completed reviews) with a
prominent, persistent thank-you card. It congratulates them by first name, confirms
the saved candidate/round, and appreciates their time, care and expertise. It does
not imply that a hiring recommendation is a final hiring decision. The card stays
until dismissed; there is no timed redirect that removes the message before it can
be read. Continue to interviews dismisses it and restores keyboard focus. View
submitted review opens the locked record directly on Reviews & decision.

The heading receives focus and the saved-state message is announced. The layout
adapts to light/dark mode and mobile. If the illustration fails to load, confirmation
and next actions remain usable. No backend, database, OAuth, permission, provider,
schema, migration or environment-variable change is required.

## Illustration provenance

Generated using the built-in image generation tool, not the CLI. The original is
retained in Codex's generated-images folder. The selected RGBA PNG is copied into
the project at `frontend/public/images/interview-review-thank-you.png`; its alpha
channel is preserved (1312 × 1199 pixels). It is served from the application's
own origin without third-party image requests or candidate data in the prompt.

Final generation prompt:

> Use case: stylized-concept. Create an original professional 3D character illustration for the successful interview-review completion state of Elite HR, a premium blue-and-neutral enterprise hiring application. A single fictional adult colleague, waist-up and fully contained in frame, wearing a tailored cobalt-blue smart-casual jacket over a simple light shirt. Warm, appreciative expression and a subtle congratulatory smile; one hand rests naturally over the heart in thanks and the other makes a modest open-palm acknowledgement toward the viewer. Exactly two anatomically coherent hands. Refined soft-clay 3D rendering, adult proportions, tasteful facial detail, soft studio lighting, balanced centered composition, polished and calm rather than childish. Genuine transparent background with a clean alpha silhouette so the character blends with both light and dark UI. Allow a comfortable margin around the figure. No text, letters, logos, watermarks, extra characters, props, confetti, or background scene. This is a small in-app illustration thanking an interviewer for their time and thoughtful feedback.

## Verification

Targeted tests cover all three rounds, success only after saving, failure/retry,
duplicate-submit protection, the personalized message, next actions, image fallback,
and retained review locking/ratings. Recruitment browser journeys exercise the
return to My interviews, completed filter, real image loading, light/dark/mobile
confirmation and reopening the locked review.


Verified on 3 November 2026: 283 frontend tests passed across 48 files, including
all-round saved-review callbacks, failure/retry, duplicate-submit protection,
ratings/locking, focus and image fallback. The five core recruitment browser
journeys passed with real local PNG loading and light/dark/mobile confirmation.
The additional managerial-to-HR handoff journey passed separately after its
round assertion was corrected to check the selected value rather than decorative
arrow text. This also verifies that returning to My interviews does not disrupt
HR scheduling. TypeScript/lint, production build and whitespace checks passed.
The running frontend serves the congratulations card and the PNG as image/png;
the production output includes the identical local image asset. Synthetic test
fixtures were used, without sending real invitations or modifying live candidates.

The image is a one-time static asset (1,335,507 bytes), not a runtime AI request.
Existing bundle-size warnings and previously documented backend dependency
advisories are unchanged by this presentation feature.
