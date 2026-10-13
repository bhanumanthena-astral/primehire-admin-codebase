import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Workbook, SpreadsheetFile} from '@oai/artifact-tool';

const directory = path.dirname(fileURLToPath(import.meta.url));
const payload = JSON.parse(await fs.readFile(path.join(directory, 'open-bugs-data.json'), 'utf8'));
const wb = Workbook.create();
const sheet = wb.worksheets.add('Open and reopened');
const guide = wb.worksheets.add('Copy guide');
const end = payload.rows.length + 1;
const area = sheet.getRange(`A1:G${end}`);
area.values = [payload.headers, ...payload.rows];
sheet.showGridLines = false;
sheet.tabColor = '#1E293B';
sheet.freezePanes.freezeRows(1);
sheet.freezePanes.freezeColumns(2);
const widths = [60, 330, 105, 210, 430, 440, 460];
area.format.font = {name:'Arial', size:11, color:'#1F2937'};
area.format.wrapText = true;
area.format.verticalAlignment = 'top';
widths.forEach((width, column) => {
  sheet.getRange(`${String.fromCharCode(65+column)}1:${String.fromCharCode(65+column)}${end}`).format.columnWidthPx = width;
});
const table = sheet.tables.add(`A1:G${end}`, true, 'OpenBugDeveloperNotes');
table.showFilterButton = true;
sheet.getRange('A1:G1').format = {
  fill:'#1E293B', font:{name:'Arial',size:11,bold:true,color:'#FFFFFF'},
  wrapText:true, horizontalAlignment:'center', verticalAlignment:'center', rowHeightPx:46,
};
area.format.borders = {insideHorizontal:{style:'thin',color:'#E2E8F0'}};
sheet.getRange(`A2:A${end}`).setNumberFormat('0');
payload.rows.forEach((row,index) => {
  const lines = Math.max(...row.map((value,column) => Math.max(1,Math.ceil(String(value??'').length / ((widths[column]-18)/6.3)))));
  const range = sheet.getRange(`A${index+2}:G${index+2}`);
  range.format.fill = index%2===0 ? '#FFFFFF' : '#F8FAFC';
  range.format.rowHeightPx = Math.max(90,lines*18+20);
});
sheet.getRange(`D2:D${end}`).conditionalFormats.add('containsText', {
  text:'Ready for manual retest',format:{fill:'#DBEAFE',font:{color:'#1E40AF',bold:true}},
});
sheet.getRange(`D2:D${end}`).conditionalFormats.add('containsText', {
  text:'Needs investigation',format:{fill:'#FEF3C7',font:{color:'#92400E',bold:true}},
});
const guideRows = [
  ['Copy guide',''],
  ['Scope','20 bugs marked Open or Re-open in the latest pasted sheet. 17 have completed code changes; 3 are not confirmed fixed.'],
  ['Developer review','Blue means code fix complete and ready for manual retest. Deployment and manual confirmation remain pending. Amber means further investigation is needed.'],
  ['Three fields to copy','Workbook E:G contains Comment, Root cause analysis, and Dev fix in exactly the same order as original sheet T:V.'],
  ['Before copying','Match the bug IDs and original row order before using the batch ranges. Paste values only. If the original sheet has been reordered, copy by bug ID.'],
  ['Status and ownership','Original statuses are preserved for reference. This workbook does not change status, resolved date, assignee, or Closed by.'],
  ['Not confirmed fixed','Bugs 60, 61, and 62 are included with investigation notes. They should not be marked Fixed or Closed based on this workbook.'],
  ['Other sheet statuses','Closed, Fixed, Phase2, and blank-status rows are outside this Open and Re-open selection.'],
  ['Source','Latest user attachment e5058b26-6734-4fda-9c9a-15ec1dc20746/Pasted text.txt, completed UI changes, and the manual retest checklist. Prepared 13 October 2026.'],
  ['',''],
  ['Bug IDs and review','Copy range in this workbook -> destination in original sheet'],
  ...payload.batches,
  ['Original sheet','The live bug sheet was not modified. Copy only the notes you want to transfer.'],
];
const guideEnd = guideRows.length;
guide.showGridLines = false;
guide.tabColor = '#64748B';
guide.getRange(`A1:B${guideEnd}`).values = guideRows;
guide.getRange(`A1:B${guideEnd}`).format.font = {name:'Arial',size:11,color:'#1F2937'};
guide.getRange(`A1:B${guideEnd}`).format.wrapText = true;
guide.getRange(`A1:B${guideEnd}`).format.verticalAlignment = 'top';
guide.getRange(`A1:A${guideEnd}`).format.columnWidthPx = 255;
guide.getRange(`B1:B${guideEnd}`).format.columnWidthPx = 820;
guide.getRange('A1:B1').format.font = {name:'Arial',size:15,bold:true,color:'#1E293B'};
guide.getRange('A1:B1').format.rowHeightPx = 40;
guideRows.forEach((row,index) => {
  if (!index) return;
  guide.getRange(`A${index+1}:B${index+1}`).format.rowHeightPx = Math.max(38,Math.ceil(row[1].length/105)*19+16);
  guide.getRange(`A${index+1}`).format.font = {name:'Arial',size:11,bold:true,color:'#334155'};
});
guide.getRange('A11:B11').format = {fill:'#1E293B',font:{name:'Arial',size:11,bold:true,color:'#FFFFFF'},verticalAlignment:'center',rowHeightPx:40};
guide.getRange('A10:B10').format.rowHeightPx = 15;
wb.recalculate();
const errors = await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#NUM!|#NULL!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:20},maxChars:1500});
await fs.writeFile(path.join(directory,'open-bugs-inspection.txt'),errors.ndjson);
for (const [sheetName,range,filename] of [
  ['Open and reopened','A1:D5','open-bugs-overview.png'],
  ['Open and reopened','E1:G5','open-bugs-fix-notes.png'],
  ['Open and reopened','D19:G21','open-bugs-investigation.png'],
  ['Copy guide',`A1:B${guideEnd}`,'open-bugs-copy-guide.png'],
]) {
  const image = await wb.render({sheetName,range,scale:1.3,format:'png'});
  await fs.writeFile(path.join(directory,filename),new Uint8Array(await image.arrayBuffer()));
}
const outputPath = path.join(directory,'PrimeHire_Open_Reopened_Bug_Notes.xlsx');
const output = await SpreadsheetFile.exportXlsx(wb);
await output.save(outputPath);
console.log(JSON.stringify({file:outputPath,rows:20,readyForRetest:17,notConfirmedFixed:[60,61,62],copyColumns:'E:G -> T:V'}));
