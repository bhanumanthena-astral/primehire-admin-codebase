import type {jsPDF} from 'jspdf';
import {mcqSummary,mcqOptionLabel,mcqOutcomeLabel,missingOptionMessage,type McqResult} from './mcqReport';

export function drawMcqPdf(doc:jsPDF,result:McqResult,question:string,y:number):number {
 const left=14,width=182,bottom=278,lineHeight=4.5;
 function paragraph(text:string,kind:'neutral'|'green'|'red'='neutral') {
   doc.setFont('helvetica','normal');doc.setFontSize(9);
   const lines:string[]=doc.splitTextToSize(text.replace(/·/g,' - ').replace(/’/g,"'"),width-18);
   let offset=0;
   while(offset<lines.length){
     if(y+15>bottom){doc.addPage();y=18;}
     const count=Math.min(lines.length-offset,Math.max(1,Math.floor((bottom-y-8)/lineHeight)));
     const height=count*lineHeight+8;
     const fill=kind==='green'?[236,253,245]:kind==='red'?[255,241,242]:[255,255,255];
     const border=kind==='green'?[167,243,208]:kind==='red'?[254,205,211]:[226,232,240];
     const ink=kind==='green'?[6,78,59]:kind==='red'?[136,19,55]:[51,65,85];
     doc.setFillColor(fill[0],fill[1],fill[2]);doc.setDrawColor(border[0],border[1],border[2]);
     doc.roundedRect(left,y,width,height,2,2,'FD');
     doc.setTextColor(ink[0],ink[1],ink[2]);
     doc.text(lines.slice(offset,offset+count),left+6,y+6,{lineHeightFactor:1.42});
     if(offset===0 && kind!=='neutral'){
       doc.setDrawColor(ink[0],ink[1],ink[2]);doc.setLineWidth(.5);
       const x=left+width-7,top=y+5;
       if(kind==='green'){doc.line(x-2,top+1,x,top+3);doc.line(x,top+3,x+3,top-1);}
       else{doc.line(x-2,top-1,x+2,top+3);doc.line(x+2,top-1,x-2,top+3);}
     }
     offset+=count;y+=height+3;
   }
 }
 paragraph('MCQ - '+mcqOutcomeLabel(result)+'\n'+question);
 for(const option of result.options){
   const correct=result.outcome!=='pending'&&option.id===result.correctOptionId;
   const wrong=result.outcome==='incorrect'&&option.id===result.selectedOptionId;
   const label=mcqOptionLabel(result,option.id);
   paragraph(option.id+'. '+(option.text??'Option '+option.id+' (text unavailable)')+(label?'\n'+(correct?'[Correct] ':wrong?'[Incorrect] ':'')+label:''),correct?'green':wrong?'red':'neutral');
 }
 paragraph(mcqSummary(result),result.outcome==='correct'?'green':result.outcome==='incorrect'?'red':'neutral');
 if(result.hasMissingOptionText)paragraph(missingOptionMessage);
 return y+4;
}
