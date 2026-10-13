import csv
import json
from collections import Counter
from pathlib import Path

output = Path(__file__).resolve().parent
repo = output.parents[1]
source = Path(r'C:\Users\onlyf\.codex\attachments\9f19e0ac-d390-4481-bcf1-6290a6bf3885\Pasted text.txt')
with source.open(encoding='utf-8-sig', newline='') as handle:
    rows = list(csv.DictReader(handle, delimiter='\t'))
assert [int(row['ID']) for row in rows] == list(range(1,60))
updates = {}

for line in (repo / 'UI_BUG_RETEST.md').read_text(encoding='utf-8').split('## Draft developer notes for the sheet')[1].split('For confirmed rows')[0].splitlines():
    cells = [cell.strip() for cell in line.strip().strip('|').split('|')]
    if len(cells) == 3 and cells[0][0:1].isdigit():
        for value in cells[0].split(','):
            updates[int(value)] = {'root':cells[1], 'fix':cells[2], 'kind':'new'}

def add(ids, cause, fix, kind='earlier'):
    for bug_id in ids:
        updates[bug_id] = {'root':cause, 'fix':fix, 'kind':kind}

add([1], 'Changing the header size while scrolling could shift the page and repeatedly trigger its scroll state.', 'Kept the sticky header bars at a constant height, stabilized scroll detection, and removed the duplicate compact heading.', 'new')
add([2], 'The Active badge used the general blue accent instead of the active-state color.', 'Active assessment badges use green in the dashboard and assessment views.', 'retained')
add([9], 'Optional assessment date fields were labelled with required-field indicators.', 'Start and end dates are labelled Optional without required asterisks.', 'retained')
add([10,29], 'Required question settings did not consistently show the required-field indicator.', 'Added required indicators to question text, question type, duration, and the scoring fields used by BASIC and TECHNICAL rounds.', 'retained')
add([17], 'The reported filter label included an external platform name.', 'The current frontend does not contain the reported LinkedIn-style wording. Existing closure is retained. A separate Elite HR page should be checked independently if the wording still appears.', 'retained')
add([21], 'The reported issue concerned low text contrast in dark mode.', 'The current portal uses a light theme. Its dashboard text is readable in the supported theme. This does not claim support for a separate dark theme.', 'retained')
add([27], 'The dashboard heading did not have enough contrast in the light view.', 'The Performance and Assessment Metrics heading uses visible foreground text in the light theme.', 'retained')
add([37], 'The same profile edit action appeared as both an icon and a menu option.', 'Kept one profile edit control. The profile menu contains activation actions without another Edit Profile entry.', 'retained')
add([5], 'The previous download flow did not reliably produce a PDF from the current report content.', 'The current export creates a PDF from normalized report data using native PDF text and drawing operations. The export path is covered by automated tests.')
add([20], 'Evaluator remarks and candidate responses were displayed through overlapping report content paths.', 'Separated evaluator feedback from spoken transcripts. Detailed Feedback and Transcript now display their respective content.')
add([26,31], 'Report regeneration could fail on provider response identifiers or remain in an analyzing state.', 'Removed report regeneration from the interface, client code, and mutation routes as requested. Report viewing and PDF download remain available.')
add([32], 'The filter offered fewer grade choices than the report grading system.', 'Made filter grades match report grades, including A+, B+, C+, and F, with the same score boundaries.')
add([33], 'Candidate filters used estimated scores and grade boundaries that did not match the report.', 'Filters now use actual report scores and the exact grade shown in the report. Candidates without the requested metric do not match.')
add([35], 'Template changes were not consistently retained through the server-backed save and refresh flow.', 'Template saves wait for the server response. Refreshes load the authoritative server list, including an empty list, rather than relying on local-only changes.')
add([36], 'The report view did not interpret MCQ selected and correct answer IDs or map them to option text.', 'Added MCQ options and outcome messages to the report and PDF. Correct answers are green, wrong selections are red, and negative or blank answer IDs are treated as unanswered.')
add([55], 'Refreshing a browser could upload stale cached templates that were missing on the server, recreating deleted templates.', 'Made refreshes read-only and server-authoritative. Deletes wait for server success, and server deletion markers prevent stale browser records from recreating a deleted template.')
add([12,49,50], 'The app timestamps matched the selected IST window, but provider login checks returned unexpected access decisions. The provider implementation cause is not confirmed.', 'Added a temporary minimum 24-hour interview window to scheduling forms. This is a workaround and does not repair the provider access checks.', 'unresolved')
add([58], 'The reported provider response omitted a question result. Restoring it requires backend investigation.', 'Corrected MCQ result display and PDF export on the frontend. These changes cannot restore question results omitted from the provider response.', 'unresolved')

primary_owner = Counter(row['Assignee'] for row in rows if row.get('Assignee')).most_common(1)[0][0]
headers = ['ID','Title','Status','Resolved Date','Assignee','Comment','Root cause analysis','Dev fix','Dependency']
data=[]
counts=Counter()
for row in rows:
    bug_id=int(row['ID'])
    update=updates.get(bug_id)
    record=[bug_id,row['Title'].strip(),row['Status'],row.get('Resolved Date') or None,row.get('Assignee') or '',row.get('Comment') or '',row.get('Root cause analysis') or '',row.get('Dev fix') or '',row.get('Dependency') or '']
    if update:
        counts[update['kind']]+=1
        record[6]=update['root']
        record[7]=update['fix']
        kind=update['kind']
        if kind=='unresolved':
            record[5]='Workaround or frontend-only change. The provider issue is not confirmed fixed. Original sheet status is preserved.'
            record[8]='PrimeHire scheduling and access validation' if bug_id in [12,49,50] else 'PrimeHire backend report generation'
        else:
            if row['Status']!='Closed': record[2]='Fixed'
            if kind=='new':
                record[5]='Code fix completed on 12 October 2026. Local tests and Chrome and Edge layout checks passed. Awaiting deployment and manual retest.'
                if row['Status']!='Closed': record[3]='2026-10-12'
            elif kind=='retained':
                record[5]='Existing fix retained after reviewing the current build. Original QA closure is preserved. Please perform the listed regression checks.'
            else:
                record[5]='Earlier code fix verified in the current build. Awaiting deployment and manual regression testing. Original QA closure is preserved where already recorded.'
            if bug_id==36:
                record[3]='2026-10-10'
                record[5]='MCQ report and PDF changes completed on 10 October 2026. Correct, incorrect, and unanswered states are covered by tests. Missing provider question entries remain a separate backend issue.'
            if bug_id in [26,31]:
                record[5]='Resolved by removing the regeneration feature at the product owner\'s request. This does not claim that the provider regeneration service was repaired.'
            if bug_id==39 and not record[4]: record[4]=primary_owner
            record[8]='Deployment and manual retest' if row['Status']!='Closed' else 'Manual regression check of the current build'
        for index in [5,6,7,8]:
            assert '\u2014' not in record[index] and '\u2013' not in record[index]
    data.append(record)

assert len(updates)==42 and len(data)==59
assert all(data[i-1][2]==rows[i-1]['Status'] for i in [12,49,50,58])
assert all(data[i-1][2]=='Closed' for i in [1,2,4,5,9,10,17,20,21,26,27,29,31,32,35,37,38,55])
payload={'headers':headers,'rows':data,'counts':dict(counts),'owner_assumption':primary_owner,'source':'User-supplied 59-row bug sheet','prepared_date':'2026-10-12'}
(output/'developer-data.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'rows':len(data),'reviewed_rows':len(updates),'categories':dict(counts)}))
