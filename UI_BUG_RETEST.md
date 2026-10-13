# UI bug review and manual retest

Reviewed on 12 October 2026 using the pasted bug sheet. The authenticated Google Sheet could not be opened because browser control failed to start. The read-only link check reached the Google sign-in page.

The audit covers all 24 rows marked UI and five related wording or form-layout items. Changes are local. No production deployment or bug sheet updates were made. Manual testing and your confirmation are required before any sheet status or resolved date is changed.

## Changes ready for your testing

| Bug IDs | What changed | What to check manually |
| --- | --- | --- |
| 1, 40 | Header spacing is clearer. The duplicated compact heading and extra module cards were removed. The existing stable scrolling behavior is retained. | Scroll up and down through the dashboard in Chrome and Edge. Headings should stay readable, without blinking or touching the next section. |
| 4 | The report close button has its own reserved space. Long names and email addresses wrap inside the report header. | Open a report on desktop and a narrow screen. Scroll the report and confirm the close button stays fully visible and works. |
| 30, 44 | There is one module navigation surface for each screen size. Module names are consistent: Executive Overview, Candidate Directory, Assessments, and Mail Templates. | Switch between all four modules. Check that there are no extra clickable module cards and that the names stay consistent. |
| 41 | Module headers share the same layout and spacing. Primary actions use the same alignment, with a stacked layout on small screens. | Compare New Assessment and Custom Template on desktop. Check that the actions remain easy to reach on a narrow screen. |
| 38, 42, 46, 57 | Candidate and profile menus open outside the table containers. They fit the available screen space and scroll when necessary. The empty padding below the assessment table was removed. Hidden mobile cards no longer open duplicate menus on desktop. | Open menus for the first and last candidates in different profiles. Confirm all expected actions are visible. Resize the window and drag the menu scrollbar when it appears. Opening the menu should not create a blank area below the table. |
| 39, 54 | Persistent setup metadata no longer produces an endless Syncing label. Genuine setup failures still show a clear warning and a Retry action. | Check an existing assessment and a newly created assessment. Neither should show a permanent Syncing label. A real setup failure should still remain visible. |
| 43 | Assessment creation, rescheduling, and candidate review use the same time picker. Selected hour, minute, and AM or PM values are blue. Values still use IST and the existing UTC conversion. | Set an exact time, including a minute that is not a multiple of five. Change AM to PM and back. Confirm the selected values are blue and the displayed schedule matches what you chose. |
| 45 | Filter results are shown immediately in the filter bar. A View matching candidates action opens the filtered directory. Candidate name, email, and assessment title searches use the same matching rules in the summary, dashboard, and directory. | Apply a round and report filter. Check the result count before scrolling. Open the matching candidates and compare the list with the displayed count. Clear the filters and check that all records return. |
| 47 | Small screens show candidate details as readable cards, including IDs, profile, round, schedule, report, invitation, and credentials. Selection and existing actions remain available. | Use a 360px screen or Android Chrome. Check a long candidate name and email. Confirm dates and times are readable, the page does not scroll sideways, and candidate actions work. |
| 48 | The grade-filter message now says Filter applied instead of Filter added. | Apply a grade filter and check the confirmation message. |
| 51, 52 | Manual registration collects candidate details only. Scheduling happens once in the review list. The duplicate Add Candidate buttons below the list were removed. CSV upload and bulk scheduling remain available. | Add two candidates through the manual form. Confirm each appears once in the review list. Set each schedule there, then try CSV upload and bulk scheduling. |
| 53 | Assessment profile windows display both dates and times in IST. | Create or open a profile with a future schedule. Compare the displayed start and end times with the selected values. |
| 56 | Delete confirmation is mounted in the viewport with bounded height and internal scrolling. The same approach is used for password, reschedule, bulk schedule, and invitation dialogs. | Open Delete Candidate near the bottom of the directory, then cancel. The complete dialog should appear immediately without scrolling the page. Repeat on a narrow screen. |
| 59 | Invitation template names and subjects wrap instead of being cut off. Template badges wrap to another line when needed. The picker fits the viewport and scrolls inside the dialog. | Open Send Invite with several custom templates and long names. Select different templates, check the preview, and confirm the dialog remains readable on desktop and mobile. Cancel when finished. |

## Existing UI fixes retained

These rows were already marked Closed in the pasted sheet. Their current implementation was reviewed. They should not be reopened or rewritten merely because this audit was performed.

| Bug IDs | Current behavior | Manual regression check |
| --- | --- | --- |
| 2 | Active assessment status uses green. | Check Active status in the Executive Overview and assessment list. |
| 9 | Assessment start and end dates are labelled Optional, without required asterisks. | Open assessment creation and check both labels. |
| 10, 29 | Required question fields have an asterisk, including question text, question type, duration, and applicable scoring fields. | Check BASIC, TECHNICAL, and HR question forms. HR should not show scoring fields it does not use. |
| 17 | The reported LinkedIn-style wording is not present in this frontend. | Check pipeline filter headings. If the wording still appears in a separate Elite HR page, that page needs a separate review. |
| 21 | The portal currently uses a light theme. The old dark-mode issue does not apply to a selectable dark theme in this build. | Check dashboard text contrast in the supported light theme. |
| 27 | Performance and Assessment Metrics remains visible in the light theme. | Check the dashboard heading and subtitle. |
| 37 | Profile editing has one edit control. The profile menu contains activation controls rather than another Edit Profile option. | Open a profile card and its menu, then count the edit entry points. |

## Earlier fixes to confirm before sheet updates

| Bug IDs | Earlier work available for retest |
| --- | --- |
| 5 | Report PDF download uses the current report data. Download a completed report and open the file. |
| 20 | Detailed Feedback shows evaluator remarks, while Transcript shows the candidate's spoken response. |
| 26, 31 | Report regeneration was removed from the application at your request. Report viewing and downloading remain available. This is a removed feature, not a claim that the provider's regeneration service was fixed. |
| 32, 33 | Grade filters use actual report scores and the same grade bands as reports, including A+, B+, C+, and F. Compare a candidate's report with the exact grade filter. |
| 35, 55 | Mail templates use server-backed saves and deletes. Stale browser caches are no longer uploaded during read-only refreshes. Create a disposable template, check it in another browser, delete it, then refresh both browsers. |
| 36 | MCQ results show the available option text, selected answer, correct answer, and outcome in the report and PDF. Negative or blank answer IDs are treated as unanswered. Test correct, incorrect, and skipped answers. |

The report chart label improvements are also retained. Check Skill Profile and Score Distribution in a narrow report window.

## Issues that should not be marked fixed by this UI pass

- Bugs 12, 49, and 50 involve provider scheduling and access checks. The existing minimum 24-hour rule is a temporary workaround and does not prove that early access or provider time validation is fixed.
- Bug 58 concerns a question missing from the provider response. The frontend cannot restore a result the backend did not return.
- Other functionality rows were outside this UI audit unless listed above as earlier work for retest.

## Draft developer notes for the sheet

The wording below is ready to use after you confirm the relevant bug IDs. It uses plain language and no em dashes.

| Bug IDs | Root cause analysis | Dev fix |
| --- | --- | --- |
| 1, 40 | Repeated headings and tight spacing made the header area look crowded. | Simplified the header and added clearer spacing while keeping scrolling stable. |
| 4 | Long report header content could crowd the close control on small screens. | Reserved space for the close button and allowed candidate details to wrap. |
| 30, 44 | The same module navigation appeared in several places and used different names. | Kept one navigation surface per screen size and made module names consistent. |
| 41 | Module headers used different layouts, so action buttons did not align consistently. | Applied a shared header layout with consistent spacing and a mobile layout. |
| 38, 42, 46, 57 | Menus were inside scrolling tables that could cut off their edges. Extra table padding was used to make room for them. | Moved menus outside the table containers, added screen-edge positioning, and removed the extra padding. |
| 39, 54 | A stored setup state was displayed as ongoing progress even when no active request was running. | Removed the persistent Syncing badge and kept genuine failure warnings with Retry. |
| 43 | The native time control used browser-dependent selection colors. | Added a shared time picker with blue selection states for hour, minute, and AM or PM. |
| 45 | Filter results were below the visible area, and there was no immediate summary. | Added visible result counts and a direct action to open matching candidates. |
| 47 | The wide candidate table was difficult to read on small screens. | Added mobile candidate cards with wrapping text, full schedule details, selection, and actions. |
| 48 | The filter confirmation message used the wrong wording. | Changed the message to Filter applied. |
| 51, 52 | Manual registration and the review list repeated scheduling and candidate entry controls. | Kept candidate entry in the manual form and scheduling in the review list. |
| 53 | Profile schedule summaries displayed dates without times. | Included start and end times with the IST timezone. |
| 56 | Dialogs were positioned inside the workspace, which affected their viewport placement. | Used viewport dialogs with a bounded height and internal scrolling. |
| 59 | Long template names and badges competed for space inside a fixed dialog. | Allowed template text and badges to wrap and made the dialog scroll within the viewport. |

For confirmed rows, the Comment can say: "Retested and confirmed. The updated interface is working as expected." Use that wording only after your manual confirmation.

Update developer-owned fields only after confirmation: Status, Resolved Date, Comment, Root cause analysis, and Dev fix. Keep the existing Assignee unless you request a change. Preserve tester-owned fields, including Closed by, and preserve descriptions, resources, priorities, and original test dates. Do not overwrite already closed rows unnecessarily. Do not record a resolved date before the deployed build has been tested.

## Validation

- All 155 frontend tests passed.
- TypeScript passed with no errors.
- The production build passed. The existing large-bundle warning remains.
- Chrome passed 29 layout and interaction checks.
- Edge passed the same 29 checks.
- Checks included desktop and 360px layouts, menu scrollbar dragging, single visible popups, viewport dialogs, filter summaries, time selection, template wrapping, and single-entry registration.
- Browser checks used synthetic records in isolated local sessions. API writes were blocked, so no invitations or candidate changes were sent.
- Physical Android testing and your manual verification of the deployed portal are still required. These changes have not been deployed by this task.
