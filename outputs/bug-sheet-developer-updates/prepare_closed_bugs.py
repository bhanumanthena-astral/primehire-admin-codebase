import csv
import json
from pathlib import Path

directory = Path(__file__).resolve().parent
source = Path(r'C:\Users\onlyf\.codex\attachments\ce6a65ca-333a-4fd2-9b13-ba2c00cfec1a\Pasted text.txt')
with source.open(encoding='utf-8-sig', newline='') as handle:
    source_rows = list(csv.DictReader(handle, delimiter='\t'))

# Comment, root cause, developer fix, dependency. Source ownership and dates are preserved below.
notes = {
1: ('Header spacing and scrolling behavior have been stabilized.', 'Changes to header height during scrolling could shift the layout and repeatedly trigger the scroll state.', 'Kept header height stable, improved spacing, and removed the duplicate compact heading.', 'None identified'),
2: ('Active assessment status now uses green.', 'The Active badge used the general blue accent instead of the active-state color.', 'Applied green styling to Active assessment badges.', 'None identified'),
3: ('Candidate registration now saves assignments through the application backend.', 'The original failure cause was not recorded. Candidate registration required reliable persistence against the selected assessment.', 'Save candidates with the selected assessment ID and add them to the interface only after server confirmation. Failed rows remain available for correction.', 'None identified'),
4: ('The report close button remains visible beside long candidate details.', 'Report header content could crowd or cover the close control.', 'Reserved space for the close button and allowed long names and email addresses to wrap.', 'None identified'),
5: ('The current report export generates a downloadable PDF.', 'The earlier export did not complete the browser download. The exact historical failure was not recorded.', 'Generate the PDF from normalized report data and explicitly trigger the browser download.', 'None identified'),
6: ('Inspect opens the directory with the evaluated-report filter applied.', 'The dashboard shortcut needed to pass the evaluated status to the candidate directory.', 'Apply the GENERATED report-status filter before opening the directory.', 'None identified'),
7: ('Question duration outside 1 to 120 seconds is flagged and cannot be saved.', 'Duration limits were not consistently enforced during assessment submission.', 'Added duration bounds, visible validation messages, submission validation, and backend schema validation.', 'None identified'),
8: ('Monitor opens only candidates whose reports are being processed.', 'The dashboard shortcut needed to pass the processing status to the candidate directory.', 'Apply the GENERATING report-status filter before opening the directory.', 'None identified'),
9: ('Assessment start and end dates are clearly labelled Optional.', 'Optional date fields were displayed with required-field indicators.', 'Removed required asterisks from assessment date fields and added Optional labels.', 'None identified'),
10: ('Required question settings now have consistent indicators.', 'Required-field indicators were missing from several question configuration labels.', 'Added indicators to question type, duration, and applicable score and weightage fields.', 'None identified'),
11: ('Closure is retained from the sheet. Assessment-profile expiry enforcement is not confirmed by the current code.', 'The current invitation checks use the candidate interview end time rather than the assessment profile end date.', 'Candidate-window expiry checks are present. A separate verified fix for assessment-profile expiry was not found.', 'Assessment-profile end-date enforcement needs review'),
12: ('A minimum 24-hour interview window was introduced as a temporary workaround.', "Submitted timestamps matched the selected IST window, but the provider rejected login during a valid window. The provider's internal cause is unconfirmed.", 'Enforced a minimum 24-hour interview window in scheduling validation. This does not establish that provider access checks were repaired.', 'PrimeHire provider scheduling and login validation'),
13: ('Assessment profiles load from shared backend storage after reopening the portal.', 'Browser-local data did not provide reliable shared persistence for assessments and their candidate mappings.', 'Persist assessments on the backend and refresh the shared assessment list while retaining stable assessment identifiers.', 'None identified'),
14: ('MCQ creation validates the selected correct answer against the current options.', 'Editing or removing options could leave the correct-answer value pointing to an option that no longer existed.', 'Keep the correct answer synchronized with the option list and map it to the provider option ID when creating the assessment.', 'None identified'),
15: ('Candidate searches use consistent matching across the dashboard and directory.', 'Search scopes and matching rules differed between views.', 'Use shared matching rules for candidate name, email, and assessment title, with trimmed and case-insensitive searches.', 'None identified'),
16: ('Assessment creation includes protection against repeated submissions.', 'The exact cause of the earlier duplicate-profile incident was not recorded.', 'Block repeated submits while saving and use backend idempotency and uniqueness checks for assessment creation.', 'Original Elite HR incident details were not recorded'),
17: ('The reported LinkedIn-style wording is absent from the current frontend.', 'The filter label referenced an unrelated external platform.', 'Use application-specific filter labels without the reported LinkedIn-style wording.', 'None identified'),
18: ('BASIC assessment payloads include the required question criteria.', 'The request did not match the required BASIC verbal-question payload fields.', 'Map BASIC verbal questions to the criteria field and validate required content before sending the assessment to PrimeHire.', 'None identified'),
19: ('Assessments are stored centrally and refreshed across users and browsers.', 'Browser-local assessment state did not provide a shared source of truth.', 'Use backend storage for assessment writes and reload the authoritative list on refresh, focus, and periodic synchronization.', 'None identified'),
20: ('Evaluator feedback and candidate transcripts display their respective content.', 'Feedback and transcript content were mapped through overlapping report paths.', 'Map evaluator remarks to Detailed Feedback and spoken responses to Transcript without substituting one for the other.', 'None identified'),
21: ('The current portal uses the supported light theme.', 'The reported dark theme had insufficient text contrast.', 'Retained the light theme and removed the theme selection control. This closure does not claim that a separate dark theme was repaired.', 'None identified'),
26: ('Resolved by removing report regeneration as requested.', 'Regeneration could fail when a valid provider response identifier was unavailable.', 'Removed report regeneration controls, client operations, and mutation routes. Report viewing and PDF download remain available.', 'No provider regeneration repair is claimed'),
27: ('Performance and Assessment Metrics is readable in the supported light theme.', 'The heading did not have sufficient contrast in the light view.', 'Applied readable foreground styling and retained the light-theme interface.', 'None identified'),
28: ('Weightage entry no longer retains an unwanted leading zero.', 'Numeric input state retained the initial zero while the user entered another value.', 'Allow an empty input while editing, normalize leading zeros, and validate the resulting numeric weightage.', 'None identified'),
29: ('Question prompt text is visibly marked as required.', 'The required question-text label lacked an asterisk.', 'Added the required-field indicator and retained validation for empty question text.', 'None identified'),
31: ("Report regeneration was removed at the product owner's request.", 'Regeneration could leave the report in an analyzing state without a completed result.', 'Removed regeneration actions and their mutation routes. Existing reports can still be viewed and downloaded.', 'No provider regeneration repair is claimed'),
32: ('Grade choices and score boundaries match the grades displayed in reports.', 'The filter offered fewer grade choices than the report grading system.', 'Use the same grading function and include A+, A, B+, B, C+, C, D, E, and F in the grade filters.', 'None identified'),
34: ('Candidate selection can be cleared through the selection controls.', 'Select All did not consistently provide a working deselection path.', 'Update selection state when the checkbox is cleared and provide a Clear Selection action.', 'None identified'),
35: ('Custom templates are retained through server-backed saves and refreshes.', 'Template creation and refresh did not consistently use authoritative server storage.', 'Wait for server confirmation when saving and reload the server template list on refresh.', 'None identified'),
37: ('Assessment profiles have one edit entry point.', 'The same Edit Profile action appeared as both an icon and a menu item.', 'Kept the profile edit control and removed the duplicate edit entry from the profile menu.', 'None identified'),
38: ('Menus support scrolling through their scrollbar and fit the available viewport.', 'Menu placement and scroll handling interfered with scrollbar interaction inside scrolling tables.', 'Render menus outside table containers and use a bounded scroll area with screen-edge positioning.', 'None identified'),
55: ('Deleted custom templates are no longer recreated by stale browser caches.', 'Read-only refreshes could upload cached templates that had been deleted from the server.', 'Make refreshes server-authoritative and read-only, wait for delete confirmation, and retain server deletion markers.', 'None identified'),
58: ('Closure is retained from the sheet. The expected question result is missing from the backend response.', 'The provider response does not contain the expected question-wise report entry.', 'The frontend displays the entries returned by the provider. No frontend change can reconstruct an omitted result, and no verified backend repair is recorded here.', 'PrimeHire report backend; Sreekar and Rahul investigation'),
}

rows = []
positions = []
for original_row, item in enumerate(source_rows, 2):
    if not item.get('ID', '').isdigit() or item.get('Status', '').strip().lower() != 'closed':
        continue
    bug_id = int(item['ID'])
    comment, cause, fix, dependency = notes[bug_id]
    rows.append([bug_id, item['Title'].strip(), item['Status'], item['Resolved Date'] or None,
                 item['Assignee'], comment, cause, fix, item['Closed by'], dependency])
    positions.append(original_row)
assert len(rows) == 33 and {row[0] for row in rows} == set(notes)
assert all(row[3] is None for row in rows)
assert all('\u2014' not in str(value) for row in rows for value in row)

# Safe copy batches avoid overwriting non-closed rows between these records.
batches = []
start = 0
for index in range(1, len(rows) + 1):
    if index < len(rows) and positions[index] == positions[index - 1] + 1:
        continue
    end = index - 1
    label = str(rows[start][0]) if start == end else f'{rows[start][0]} to {rows[end][0]}'
    batches.append([label, f'Closed bugs!D{start+2}:J{end+2} -> original R{positions[start]}:X{positions[end]}'])
    start = index

payload = {'headers': ['ID', 'Title', 'Status', 'Resolved Date', 'Assignee', 'Comment', 'Root cause analysis', 'Dev fix', 'Closed by', 'Dependency'],
           'rows': rows, 'original_rows': positions, 'batches': batches, 'source': str(source)}
(directory / 'closed-bugs-data.json').write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'closed_bugs': len(rows), 'copy_batches': batches, 'dates': 'Source blanks preserved'}))
