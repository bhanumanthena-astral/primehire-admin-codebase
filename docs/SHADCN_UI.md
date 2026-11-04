# Shared shadcn controls

Application screens use the Base UI shadcn components in `components/ui`.
Imports resolve through the existing project-root `@/` alias.

- `AppSelect` in `src/components/ui` adapts option children to the shared Select.
  Use `onValueChange` with a string value. It preserves empty values, disabled
  options, form names and accessible trigger labels. Menus close before a
  selection opens another dialog and render above dialog overlays.
- Text inputs, textareas, buttons, checkboxes and tables use the shared shadcn
  components. File inputs remain native for browser upload support.
- `PAButton`, `Panel`, `Pill`, `FilterSelect` and `EmptyNote` delegate to shared
  Button, Card, Badge, Select and Empty components.
- `Modal` delegates to the shared Dialog while retaining scroll limits,
  dismissal locks and labels. Use `finalFocus` when a menu selection opens a
  dialog, since the selected menu item disappears before focus can return.
- Resume processing uses Progress; intake mode selection uses RadioGroup;
  report tabs use Tabs. Business-specific charts and print markup stay custom.

Test selects by opening their menu and selecting a visible option. Native
`selectOption`/change events do not exercise the new controls. The unit helper
is `src/test-select.ts`; browser tests use `getByRole('option')`.

Verification: TypeScript checks, production build, 115 UI tests, resume upload
browser checks and desktop/mobile dialog checks. Browser tests use isolated
test services and do not restart live services or change live databases.
