import {normalizeReport} from '../normalizeReport';
import {describe,expect,it} from 'vitest';
import {matchMcqQuestion,normalizeMcq,mcqSummary} from '../mcqReport';
const base={id:'q-1',question:'Who owns ChatGPT?',type:'MCQ',options:['Google','OpenAI','Microsoft','Meta'],correct_option_id:'B',is_result_generated:true};
describe('MCQ evidence',()=>{
 it('normalizes IDs and labels correct and incorrect answers',()=>{
   const correct=normalizeMcq({...base,option_id:' b '});
   expect(correct.outcome).toBe('correct');expect(mcqSummary(correct)).toBe('You have selected the right option.');
   const incorrect=normalizeMcq({...base,option_id:'A'});
   expect(incorrect.outcome).toBe('incorrect');expect(mcqSummary(incorrect)).toBe('You have selected the wrong option. Correct answer: B. OpenAI.');
 });
 it.each([-1,-8,'-1',' -8 ',null,undefined,'','  '])('treats %s as unanswered',id=>{
   expect(normalizeMcq({...base,option_id:id}).outcome).toBe('unanswered');
 });
 it('keeps zero and opaque IDs',()=>{
   expect(normalizeMcq({...base,option_id:0,correct_option_id:'0'}).outcome).toBe('correct');
   expect(normalizeMcq({...base,option_id:'vendor-uuid',correct_option_id:'vendor-uuid'}).outcome).toBe('correct');
 });
 it('requires generated status and never uses scores to infer correctness',()=>{
   expect(normalizeMcq({...base,is_result_generated:false,option_id:'B',obtained_score:100}).outcome).toBe('pending');
   expect(normalizeMcq({...base,is_result_generated:undefined,option_id:'B'}).outcome).toBe('pending');
   expect(normalizeMcq({...base,correct_option_id:undefined,option_id:'A'}).outcome).toBe('unknown');
 });
 it('accepts aliases and object option shapes',()=>{
   const result=normalizeMcq({optionId:' b ',correctOptionId:'B',isResultGenerated:true,options:[{option_id:'A',data:'Google'},{optionId:'B',label:'OpenAI'}]});
   expect(result.outcome).toBe('correct');expect(result.options.map(o=>o.text)).toEqual(['Google','OpenAI']);
 });
 it('matches original and sanitized IDs, recovers only unique text matches',()=>{
   const originals=[{id:'q-1',text:base.question,options:base.options,correctOption:'OpenAI'}];
   expect(normalizeMcq({...base,options:[],correct_option_id:undefined,option_id:'opt_2'},originals).outcome).toBe('correct');
   expect(matchMcqQuestion({id:'q_1'},originals)?.id).toBe('q-1');
   expect(matchMcqQuestion({id:'q_123_id'},[{id:'123-id'}])?.id).toBe('123-id');
   expect(matchMcqQuestion({question:'  WHO owns ChatGPT? '},originals)?.id).toBe('q-1');
   expect(matchMcqQuestion({question:base.question},[...originals,{...originals[0],id:'other'}])).toBeUndefined();
   expect(matchMcqQuestion({id:'q-1'},[...originals,{...originals[0]}])).toBeUndefined();
 });
 it('prefers report options and preserves missing text and unresolved IDs',()=>{
   const result=normalizeMcq({...base,options:[{id:'A',text:'Provider value'}],option_id:'opaque',correct_option_id:'missing'});
   expect(result.options).toEqual([{id:'A',text:'Provider value'},{id:'opaque',text:null},{id:'missing',text:null}]);
   expect(result.hasMissingOptionText).toBe(true);
   expect(normalizeMcq({...base,options:[],option_id:'A'}).options[0].text).toBeNull();
 });
});

it('normalizes the provider data envelope and carries the same MCQ result into report exports',()=>{
 const report=normalizeReport({data:{report:{question_wise_result:[{...base,option_id:'B'}]}}});
 expect(report?.questions[0].mcq?.outcome).toBe('correct');
});
