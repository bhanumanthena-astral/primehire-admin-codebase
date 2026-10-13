import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Workbook,SpreadsheetFile} from '@oai/artifact-tool';

const dir=path.dirname(fileURLToPath(import.meta.url));
const payload=JSON.parse(await fs.readFile(path.join(dir,'developer-data.json'),'utf8'));
const wb=Workbook.create();
const sheet=wb.worksheets.add('Developer fields');
const guide=wb.worksheets.add('Paste guide');
const rows=payload.rows.map(row=>row.map((value,index)=>index===3&&value ? new Date(`${value}T00:00:00Z`) : value));
sheet.getRange('A1:I60').values=[payload.headers,...rows];
sheet.showGridLines=false;
sheet.tabColor='#334155';
sheet.freezePanes.freezeRows(1);
sheet.freezePanes.freezeColumns(2);
const widths=[65,335,105,120,190,400,400,475,245];
sheet.getRange('A1:I60').format.font={name:'Arial',size:11,color:'#1F2937'};
sheet.getRange('A1:I60').format.wrapText=true;
sheet.getRange('A2:I60').format.verticalAlignment='top';
sheet.getRange('A1:I1').format={fill:'#334155',font:{name:'Arial',size:11,bold:true,color:'#FFFFFF'},wrapText:true,verticalAlignment:'center',horizontalAlignment:'center',rowHeightPx:42};
for(let i=0;i<widths.length;i++) sheet.getRange(`${String.fromCharCode(65+i)}1:${String.fromCharCode(65+i)}60`).format.columnWidthPx=widths[i];
sheet.getRange('A2:A60').setNumberFormat('0');
sheet.getRange('D2:D60').setNumberFormat('dd/mm/yyyy');
for(let index=0;index<rows.length;index++){
  const rowNumber=index+2;
  const lines=Math.max(...rows[index].map((value,column)=>String(value??'').split('\n').reduce((sum,line)=>sum+Math.max(1,Math.ceil(line.length/Math.max(1,(widths[column]-20)/6))),0)));
  sheet.getRange(`A${rowNumber}:I${rowNumber}`).format.rowHeightPx=Math.max(80,lines*17+18);
  if(index%2===1) sheet.getRange(`A${rowNumber}:I${rowNumber}`).format.fill='#F8FAFC';
}
sheet.getRange('C2:C60').conditionalFormats.add('containsText',{text:'Fixed',format:{fill:'#DBEAFE',font:{color:'#1E40AF',bold:true}}});
sheet.getRange('C2:C60').conditionalFormats.add('containsText',{text:'Phase2',format:{fill:'#FEF3C7',font:{color:'#92400E'}}});
sheet.getRange('A1:I60').format.borders={insideHorizontal:{style:'thin',color:'#E2E8F0'}};
sheet.tables.add('A1:I60',true,'DeveloperFields');

guide.showGridLines=false;
guide.tabColor='#64748B';
const guideData=[
  ['Copy developer fields',''],
  ['Prepared','12 October 2026 from the supplied 59-row bug sheet.'],
  ['Before pasting','Match the ID order with the original sheet. If rows were reordered, copy by bug ID instead of pasting an entire block. Paste values only.'],
  ['Status','Copy Developer fields!C2:C60 into original N2:N60.'],
  ['Date, owner and fix notes','Copy Developer fields!D2:H60 into original R2:V60.'],
  ['Dependency','Copy Developer fields!I2:I60 into original X2:X60.'],
  ['QA fields','Closed by is not included. Tester, environment, resources, credentials, descriptions and original test dates are not overwritten by these ranges.'],
  ['Fixed status','Fixed means the code change is complete. New changes still require deployment and manual testing. Existing Closed statuses are preserved.'],
  ['Resolved dates','12/10/2026 is used for new UI fixes with a recorded completion date. The MCQ fix uses 10/10/2026. Earlier unknown dates remain blank rather than being invented.'],
  ['Assignee','Existing owners are preserved. Blank assignee for bug 39 uses Bhanu Pratap Manthena, the existing primary developer in the supplied sheet. Review that owner before pasting.'],
  ['Unresolved provider issues','Bugs 12, 49 and 50 have a temporary scheduling workaround. Bug 58 needs provider report follow-up. Their original statuses are preserved and their notes explicitly state they are not confirmed fixed.'],
  ['Other rows','Rows outside the reviewed fixes retain the supplied developer values. No new fix is claimed for them.'],
  ['Validation','155 frontend tests, TypeScript and the production build passed. Chrome and Edge each passed 29 local UI checks. Physical Android and deployed portal testing remain pending.'],
  ['Writing','Developer notes use plain language without em dashes.'],
  ['Source','User-supplied pasted bug sheet and completed code changes in this conversation. The live Google Sheet was not modified.'],
];
guide.getRange('A1:B15').values=guideData;
guide.getRange('A1:B15').format.font={name:'Arial',size:11,color:'#1F2937'};
guide.getRange('A1:A15').format.columnWidthPx=220;
guide.getRange('B1:B15').format.columnWidthPx=820;
guide.getRange('A1:B15').format.wrapText=true;
guide.getRange('A1:B15').format.verticalAlignment='top';
guide.getRange('A1:B1').format.font={name:'Arial',size:15,bold:true,color:'#0F172A'};
guide.getRange('A1:B1').format.rowHeightPx=40;
for(let i=1;i<guideData.length;i++){
  guide.getRange(`A${i+1}:B${i+1}`).format.rowHeightPx=Math.max(45,Math.ceil(guideData[i][1].length/115)*18+16);
  guide.getRange(`A${i+1}`).format.font={name:'Arial',size:11,bold:true,color:'#334155'};
}

wb.recalculate();
const dates=sheet.getRange('D2:D60').values;
if(sheet.getRange('A2:A60').values.length!==59) throw new Error('Missing rows');
if(sheet.getRange('C51').values[0][0]!=='Phase2') throw new Error('Provider access issue incorrectly marked fixed');
if(sheet.getRange('G37').values[0][0].includes('negative')) throw new Error('Unexpected MCQ cause field');
await fs.writeFile(path.join(dir,'inspection.txt'),(await wb.inspect({kind:'table',range:'Developer fields!A37:I40',include:'values',tableMaxRows:4,tableMaxCols:9,maxChars:3000})).ndjson);
const errorScan=await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#NUM!|#NULL!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:30},summary:'Formula error scan'});
await fs.writeFile(path.join(dir,'error-scan.txt'),errorScan.ndjson);
for(const [name,range,file] of [['Developer fields','F1:I6','developer-preview.png'],['Paste guide','A1:B15','paste-guide-preview.png']]){
  const preview=await wb.render({sheetName:name,range,scale:1.4,format:'png'});
  await fs.writeFile(path.join(dir,file),new Uint8Array(await preview.arrayBuffer()));
}
const output=await SpreadsheetFile.exportXlsx(wb);
await output.save(path.join(dir,'PrimeHire_Developer_Bug_Updates.xlsx'));
console.log(JSON.stringify({file:path.join(dir,'PrimeHire_Developer_Bug_Updates.xlsx'),rows:rows.length,updated:42,categories:payload.counts}));
