import {jsPDF} from 'jspdf';
import {expect,it,vi} from 'vitest';
import {drawMcqPdf} from '../mcqPdf';
import {normalizeMcq} from '../mcqReport';
it('exports every option with labels and paginates a long option without losing the tail',()=>{
 const doc=new jsPDF();
 const colors=vi.spyOn(doc,'setFillColor');
 const result=normalizeMcq({options:['Google','OpenAI '+('Long option text '.repeat(900))+'TAIL_MARKER','Microsoft','Meta'],option_id:'A',correct_option_id:'B',is_result_generated:true});
 drawMcqPdf(doc,result,'Who owns ChatGPT?',270);
 expect(doc.getNumberOfPages()).toBeGreaterThan(2);
 const pdf=doc.output();
 expect(pdf).toContain('TAIL_MARKER');
 expect(pdf).toContain('Candidate');
 expect(pdf).toContain('Correct answer');
 expect(pdf).toContain('Microsoft');
 expect(pdf).toContain('Meta');
 expect(colors).toHaveBeenCalledWith(236,253,245);
 expect(colors).toHaveBeenCalledWith(255,241,242);
});
