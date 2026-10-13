import csv
import json
from pathlib import Path

directory = Path(__file__).resolve().parent
source = Path(r'C:\Users\onlyf\.codex\attachments\e5058b26-6734-4fda-9c9a-15ec1dc20746\Pasted text.txt')
with source.open(encoding='utf-8-sig', newline='') as handle:
    source_rows = list(csv.DictReader(handle, delimiter='\t'))
reviewed = {}
guide_path = directory.parents[1] / 'UI_BUG_RETEST.md'
section = guide_path.read_text(encoding='utf-8').split('## Draft developer notes for the sheet')[1].split('For confirmed rows')[0]
for line in section.splitlines():
    cells = [cell.strip() for cell in line.strip().strip('|').split('|')]
    if len(cells) == 3 and cells[0][:1].isdigit():
        for value in cells[0].split(','):
            reviewed[int(value)] = (cells[1], cells[2])

comments = {
39: 'Existing assessment cards no longer show a persistent Syncing label. Genuine setup failures still show a warning and Retry action.',
40: 'Header spacing has been improved and the duplicate compact heading has been removed.',
41: 'Module headers now share consistent spacing and action-button alignment, with a stacked layout on smaller screens.',
42: 'Profile and candidate menus are positioned outside scrolling containers so their available options remain visible.',
43: 'Selected hour, minute, and AM or PM values are highlighted in blue in the shared time picker.',
44: 'Module names are consistent across the portal, with one navigation surface for each screen size.',
45: 'Applied filters immediately show matching record counts and provide a direct action to open the filtered candidate directory.',
46: 'Candidate action menus fit the available viewport and scroll internally when necessary.',
47: 'Mobile screens display readable candidate cards with full details, schedules, selection, and available actions.',
48: 'The confirmation message now says Filter applied.',
51: 'Manual registration collects candidate details only. Start and end schedules are entered once in the review list.',
52: 'The duplicate Add Candidate controls below the review list have been removed. Candidate entry remains in the manual registration form.',
53: 'Assessment profile windows now show both dates and times in IST.',
54: 'The persistent Syncing display has been removed. Genuine setup errors remain visible with a Retry action.',
56: 'Candidate confirmation dialogs appear within the viewport and scroll internally when needed.',
57: 'Action menus no longer require extra space below the table, so opening a menu does not create the blank white area.',
59: 'Invitation template names, subjects, and badges wrap within a dialog that fits and scrolls inside the viewport.',
}
pending = {
60: (
    'The immediate-login failure is not confirmed fixed. The source sheet assigns this issue to Rahul Palamarthi.',
    'Login reportedly fails immediately after assessment setup and works after waiting. The provider-side cause has not been confirmed.',
    'No verified fix is recorded for this issue. Investigate provider setup readiness and capture the failed login response before closing it.'),
61: (
    'The reschedule failure after editing and resending a TECHNICAL assessment is not confirmed fixed.',
    'The cause is unconfirmed. The supplied report does not include the failing reschedule request or the provider error response.',
    'No verified fix is recorded for this edit-and-resend flow. Reproduce it with the current interview ID and review the provider reschedule response.'),
62: (
    'Edited questions and timing appear in the portal, but the candidate assessment reportedly retains the initial version. This issue is not confirmed fixed.',
    'The portal and candidate assessment show different versions after editing. The cause of the provider content mismatch has not been confirmed.',
    'No verified fix is recorded for updating an existing candidate interview after an assessment edit. Compare saved assessment details and the linked provider interview content.'),
}
rows, positions = [], []
for original_row, item in enumerate(source_rows, 2):
    if not item.get('ID', '').isdigit() or item.get('Status', '').strip().lower() not in {'open', 're-open', 'reopen', 'reopened'}:
        continue
    bug_id = int(item['ID'])
    if bug_id in comments:
        cause, fix = reviewed[bug_id]
        state, comment = 'Ready for manual retest', comments[bug_id]
    else:
        assert bug_id in pending, f'Unreviewed bug {bug_id}'
        state = 'Needs investigation'
        comment, cause, fix = pending[bug_id]
    title = item['Title'].strip().replace('\ufffd', '"')
    rows.append([bug_id, title, item['Status'], state, comment, cause, fix])
    positions.append(original_row)
assert len(rows) == 20
assert sum(row[3] == 'Ready for manual retest' for row in rows) == 17
assert [row[0] for row in rows if row[3] == 'Needs investigation'] == [60, 61, 62]
assert all('\u2014' not in str(value) for row in rows for value in row)
batches = []
start = 0
for index in range(1, len(rows) + 1):
    if index < len(rows) and positions[index] == positions[index-1] + 1 and rows[index][3] == rows[index-1][3]:
        continue
    end = index - 1
    label = str(rows[start][0]) if start == end else f'{rows[start][0]} to {rows[end][0]}'
    batches.append([f'{label} ({"retest" if rows[start][3] == "Ready for manual retest" else "investigate"})',
                    f'Open and reopened!E{start+2}:G{end+2} -> original T{positions[start]}:V{positions[end]}'])
    start = index
payload = {'headers': ['ID', 'Title', 'Original Status', 'Developer review', 'Comment', 'Root cause analysis', 'Dev fix'],
           'rows': rows, 'original_rows': positions, 'batches': batches, 'source': str(source)}
(directory / 'open-bugs-data.json').write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'open_or_reopened': len(rows), 'code_fixes': 17, 'not_confirmed_fixed': [60, 61, 62], 'copy_batches': batches}))
