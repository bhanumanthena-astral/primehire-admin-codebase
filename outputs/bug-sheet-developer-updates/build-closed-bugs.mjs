import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Workbook, SpreadsheetFile} from '@oai/artifact-tool';

const directory = path.dirname(fileURLToPath(import.meta.url));
const payload = JSON.parse(await fs.readFile(path.join(directory, 'closed-bugs-data.json'), 'utf8'));
const wb = Workbook.create();
const sheet = wb.worksheets.add('Closed bugs');
const guide = wb.worksheets.add('Copy guide');
const end = payload.rows.length + 1;
sheet.getRange(`A1:J${end}`).values = [payload.headers, ...payload.rows];
sheet.showGridLines = false;
sheet.tabColor = '#1E293B';
sheet.freezePanes.freezeRows(1);
sheet.freezePanes.freezeColumns(2);
const widths = [60, 315, 95, 120, 205, 375, 410, 445, 160, 275];
const area = sheet.getRange(`A1:J${end}`);
area.format.font = {name: 'Arial', size: 11, color: '#1F2937'};
area.format.wrapText = true;
area.format.verticalAlignment = 'top';
for (let column = 0; column < widths.length; column++) {
  sheet.getRange(`${String.fromCharCode(65 + column)}1:${String.fromCharCode(65 + column)}${end}`).format.columnWidthPx = widths[column];
}
const table = sheet.tables.add(`A1:J${end}`, true, 'ClosedBugNotes');
table.showFilterButton = true;
sheet.getRange('A1:J1').format = {
  fill: '#1E293B', font: {name: 'Arial', size: 11, bold: true, color: '#FFFFFF'},
  wrapText: true, horizontalAlignment: 'center', verticalAlignment: 'center', rowHeightPx: 44,
};
area.format.borders = {insideHorizontal: {style: 'thin', color: '#E2E8F0'}};
sheet.getRange(`A2:A${end}`).setNumberFormat('0');
sheet.getRange(`D2:D${end}`).setNumberFormat('dd/mm/yyyy');
sheet.getRange(`D2:D${end}`).format.fill = '#FFF7DC';
sheet.getRange(`C2:C${end}`).conditionalFormats.add('containsText', {
  text: 'Closed', format: {fill: '#DCFCE7', font: {color: '#166534', bold: true}},
});
for (const text of ['not confirmed', 'temporary workaround', 'missing from the backend']) {
  sheet.getRange(`F2:F${end}`).conditionalFormats.add('containsText', {
    text, format: {fill: '#FEF3C7', font: {color: '#92400E'}},
  });
}
for (const text of ['needs review', 'PrimeHire']) {
  sheet.getRange(`J2:J${end}`).conditionalFormats.add('containsText', {
    text, format: {fill: '#FEF3C7', font: {color: '#92400E'}},
  });
}
payload.rows.forEach((row, index) => {
  sheet.getRange(`A${index + 2}:J${index + 2}`).format.fill = index % 2 === 0 ? '#FFFFFF' : '#F8FAFC';
  sheet.getRange(`D${index + 2}`).format.fill = '#FFF7DC';
  const estimatedLines = Math.max(...row.map((value, column) =>
    String(value ?? '').split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / ((widths[column] - 18) / 6.3))), 0)));
  sheet.getRange(`A${index + 2}:J${index + 2}`).format.rowHeightPx = Math.max(90, estimatedLines * 18 + 20);
});

const guideRows = [
  ['Copy guide', ''],
  ['Scope', '33 bugs marked Closed in your latest pasted sheet. The original sheet was not modified.'],
  ['Status', 'Closed is copied from your sheet. It is not a new claim that all provider issues have been repaired.'],
  ['Resolved Date', 'Pale yellow date cells are blank because actual resolution dates were not recorded. Fill the real dates before copying.'],
  ['Owners and QA', 'Existing assignees and Closed by values are preserved. Closed by is a QA field; bug 11 remains blank as supplied.'],
  ['Notes requiring attention', 'Amber notes identify qualifications: bug 11 needs assessment-level expiry review, bug 12 has a temporary workaround, and bug 58 needs backend report follow-up.'],
  ['Before copying', 'Check the bug IDs and row order against your original sheet. Use the batch ranges only if the original rows still match the pasted source. Paste values only.'],
  ['Field mapping', 'Workbook C goes to original N (Status). Workbook D:J goes to original R:X (Resolved Date, Assignee, Comment, Root cause analysis, Dev fix, Closed by, Dependency).'],
  ['Source', 'Latest user-supplied 67-row pasted bug sheet and the developer notes prepared in this conversation. Prepared 13 October 2026.'],
  ['', ''],
  ['Bug IDs', 'Copy range in this workbook -> destination in original sheet'],
  ...payload.batches,
  ['Status copying', 'The original rows already say Closed. If copying status too, use the same batch row groups: workbook column C goes to original column N.'],
];
const guideEnd = guideRows.length;
guide.showGridLines = false;
guide.tabColor = '#64748B';
guide.getRange(`A1:B${guideEnd}`).values = guideRows;
guide.getRange(`A1:B${guideEnd}`).format.font = {name: 'Arial', size: 11, color: '#1F2937'};
guide.getRange(`A1:B${guideEnd}`).format.wrapText = true;
guide.getRange(`A1:B${guideEnd}`).format.verticalAlignment = 'top';
guide.getRange(`A1:A${guideEnd}`).format.columnWidthPx = 255;
guide.getRange(`B1:B${guideEnd}`).format.columnWidthPx = 820;
guide.getRange('A1:B1').format.font = {name: 'Arial', size: 15, bold: true, color: '#1E293B'};
guide.getRange('A1:B1').format.rowHeightPx = 40;
for (let index = 1; index < guideEnd; index++) {
  guide.getRange(`A${index+1}:B${index+1}`).format.rowHeightPx = Math.max(38, Math.ceil(guideRows[index][1].length / 105) * 19 + 16);
  guide.getRange(`A${index+1}`).format.font = {name: 'Arial', size: 11, bold: true, color: '#334155'};
}
guide.getRange('A11:B11').format = {fill: '#1E293B', font: {name: 'Arial', size: 11, bold: true, color: '#FFFFFF'}, verticalAlignment: 'center', rowHeightPx: 40};
guide.getRange('A10:B10').format.rowHeightPx = 15;
wb.recalculate();
const errors = await wb.inspect({kind:'match', searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#NUM!|#NULL!|#SPILL!|#CALC!', options:{useRegex:true,maxResults:20}, maxChars:1500});
await fs.writeFile(path.join(directory, 'closed-bugs-inspection.txt'), errors.ndjson);
for (const [sheetName, range, filename] of [
  ['Closed bugs', 'A1:E5', 'closed-bugs-overview.png'],
  ['Closed bugs', 'F1:J5', 'closed-bugs-notes.png'],
  ['Closed bugs', 'F33:J34', 'closed-bugs-provider-notes.png'],
  ['Copy guide', `A1:B${guideEnd}`, 'closed-bugs-copy-guide.png'],
]) {
  const image = await wb.render({sheetName, range, scale:1.3, format:'png'});
  await fs.writeFile(path.join(directory, filename), new Uint8Array(await image.arrayBuffer()));
}
const outputPath = path.join(directory, 'PrimeHire_Closed_Bugs_Developer_Notes.xlsx');
const file = await SpreadsheetFile.exportXlsx(wb);
await file.save(outputPath);
console.log(JSON.stringify({file:outputPath, closedRows:payload.rows.length, sheets:2, copyBatches:payload.batches.length}));
