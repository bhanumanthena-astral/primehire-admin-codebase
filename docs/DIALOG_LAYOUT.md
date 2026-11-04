# Application dialog layout

Dialogs use `src/components/ui/Modal.tsx`, backed by the installed Base UI Dialog.
Its portal mounts outside the application root, so card hover transforms, page
entrance animations and clipping cannot change the position of the overlay.

The backdrop covers and blurs the whole viewport. The panel stays centered,
fits within the available screen height and scrolls internally for long forms.
Keyboard focus stays inside, Escape closes the dialog and focus returns to the
opening control. Dismissal is disabled while saving where the form exposes a
pending state. Position and scale animations are deliberately omitted.

Jobs status, access, edit, assignment and reopen; team access, invitation and
view-as; job creation confirmations; candidate passwords; interview rescheduling;
and report sharing use this shared layer. Navigation drawers, menus and the
candidate workspace retain their existing layouts.

Browser regression tests in `e2e/modals.spec.ts` cover viewport geometry, full
backdrop coverage, focus, scroll locking, stable positioning, cancellation and
long forms on desktop and mobile. They use the isolated in-memory test server.
This fix adds no environment variables or database changes.
