import {jsPDF} from 'jspdf';
import type {ReportContent,ReportMetadata} from '../lib/reportingApi';
import {normalizeMcq} from './mcqReport';
import {drawMcqPdf} from './mcqPdf';

export function storedReportPdf(content:ReportContent,metadata:ReportMetadata):jsPDF {
 const doc=new jsPDF();
 let y=18;
 function paragraph(text:string){
   doc.setFont('helvetica','normal');doc.setFontSize(10);doc.setTextColor(24,40,63);
   const lines:string[]=doc.splitTextToSize(text,180);
   for(const line of lines){if(y>276){doc.addPage();y=18;}doc.text(line,14,y);y+=5;}
   y+=4;
 }
 paragraph(metadata.candidateName+' - '+metadata.jobTitle+'\n'+metadata.roundType+' report - Version '+metadata.version);
 paragraph('Overall score: '+(content.overview.value??'Unavailable')+(content.overview.maximum!==null?' / '+content.overview.maximum:''));
 for(const [index,question] of content.questions.entries()){
   if(question.type?.toUpperCase()==='MCQ'){
     y=drawMcqPdf(doc,normalizeMcq(question.mcqInput??{},content.assessmentQuestions),'Q'+(index+1)+'. '+(question.question??'Question text unavailable'),y);
   }else{
     paragraph('Q'+(index+1)+'. '+(question.question??'Question text unavailable'));
     paragraph('Score: '+(question.score??'Unavailable')+(question.maximum!==null?' / '+question.maximum:''));
     paragraph('Response: '+(question.transcript??'Transcript unavailable.'));
     paragraph('Evaluation: '+(question.feedback??question.aiAnalysis??'Unavailable'));
     if(question.mediaReference)paragraph('Video recording available in the on-screen report.');
   }
 }
 return doc;
}
export function downloadStoredReportPdf(content:ReportContent,metadata:ReportMetadata){
 storedReportPdf(content,metadata).save('report-'+metadata.reportId+'-v'+metadata.version+'.pdf');
}
