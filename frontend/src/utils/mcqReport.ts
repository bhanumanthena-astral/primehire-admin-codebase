export type McqOption={id:string;text:string|null};
export type McqResult={outcome:'correct'|'incorrect'|'unanswered'|'pending'|'unknown';options:McqOption[];selectedOptionId:string|null;correctOptionId:string|null;hasMissingOptionText:boolean};
type RecordValue=Record<string,any>;
export function optionId(value:unknown):string|null {
  if(value===null||value===undefined)return null;
  const text=String(value).trim();
  if(!text || (Number.isFinite(Number(text))&&Number(text)<0))return null;
  return /^[a-z]$/i.test(text)?text.toUpperCase():text;
}
const textKey=(value:unknown)=>String(value??'').normalize('NFKC').replace(/\s+/g,' ').trim().toLowerCase();
function sanitizedId(value:unknown):string {
  const id=String(value??'').replace(/[^a-zA-Z0-9_]/g,'_');
  return /^[0-9]/.test(id)?'q_'+id:id;
}
export function matchMcqQuestion(question:RecordValue,originals:RecordValue[]):RecordValue|undefined {
  const id=question.id??question.questionId??question.question_id;
  if(id!==null&&id!==undefined){
    const exact=originals.filter(q=>String(q.id??q.questionId??q.question_id)===String(id));
    if(exact.length===1)return exact[0];
    if(exact.length>1)return;
    const sanitized=originals.filter(q=>sanitizedId(q.id??q.questionId??q.question_id)===String(id));
    if(sanitized.length===1)return sanitized[0];
    if(sanitized.length>1)return;
  }
  const key=textKey(question.question??question.questionText??question.text);
  const matches=key?originals.filter(q=>textKey(q.question??q.questionText??q.text)===key):[];
  return matches.length===1?matches[0]:undefined;
}
function optionsOf(value:unknown):McqOption[] {
  if(!Array.isArray(value))return [];
  return value.flatMap((option,index)=>{
    if(typeof option==='string')return [{id:String.fromCharCode(65+index),text:option.trim()?option:null}];
    if(!option||typeof option!=='object')return [];
    const id=optionId(option.id??option.option_id??option.optionId)??String.fromCharCode(65+index);
    const text=[option.data,option.text,option.label].find(value=>typeof value==='string'&&value.trim());
    return [{id,text:typeof text==='string'&&text.trim()?text:null}];
  });
}
export function normalizeMcq(question:RecordValue,originals:RecordValue[]=[]):McqResult {
  const original=matchMcqQuestion(question,originals);
  const supplied=optionsOf(question.options);
  const options=supplied.some(o=>o.text)?supplied:optionsOf(original?.options);
  const usingStrings=Array.isArray(supplied.some(o=>o.text)?question.options:original?.options) &&
    (supplied.some(o=>o.text)?question.options:original?.options).every((o:unknown)=>typeof o==='string');
  function resolve(value:unknown):string|null {
    const id=optionId(value);
    const legacy=id?.match(/^opt_(\d+)$/i);
    return usingStrings&&legacy&&Number(legacy[1])>0&&Number(legacy[1])<=options.length?String.fromCharCode(64+Number(legacy[1])):id;
  }
  const selectedOptionId=resolve(question.option_id??question.optionId);
  const rawCorrect=question.correct_option_id??question.correctOptionId;
  let correctOptionId=resolve(rawCorrect);
  if(correctOptionId===null && optionId(rawCorrect)===null && original){
    const fallback=original.correctOption??original.correct_option;
    const byText=options.filter(o=>o.text===fallback);
    correctOptionId=byText.length===1?byText[0].id:resolve(fallback);
  }
  for(const id of [selectedOptionId,correctOptionId])if(id!==null&&!options.some(o=>o.id===id))options.push({id,text:null});
  const generated=question.is_result_generated??question.isResultGenerated;
  const outcome=generated!==true?'pending':selectedOptionId===null?'unanswered':correctOptionId===null?'unknown':selectedOptionId===correctOptionId?'correct':'incorrect';
  return {outcome,options,selectedOptionId,correctOptionId,hasMissingOptionText:options.some(o=>!o.text)};
}
export function mcqSummary(result:McqResult):string {
  if(result.outcome==='pending')return 'This answer has not been evaluated yet.';
  if(result.outcome==='unanswered')return 'The candidate has not selected any option.';
  if(result.outcome==='unknown')return 'The correct answer is unavailable in this report.';
  if(result.outcome==='correct')return 'You have selected the right option.';
  const correct=result.options.find(o=>o.id===result.correctOptionId);
  return 'You have selected the wrong option. Correct answer: '+result.correctOptionId+'. '+(correct?.text??'Option '+result.correctOptionId+' (text unavailable)')+'.';
}
export const mcqOutcomeLabel=(result:McqResult)=>({correct:'Correct answer',incorrect:'Incorrect answer',unanswered:'Not answered',pending:'Awaiting evaluation',unknown:'Answer review'})[result.outcome];
export function mcqOptionLabel(result:McqResult,id:string):string {
  const selected=id===result.selectedOptionId;
  const correct=result.outcome!=='pending'&&id===result.correctOptionId;
  return selected&&correct?'Selected · Correct answer':correct?'Correct answer':selected?'Candidate’s selection':'';
}
export const missingOptionMessage='Some option text is unavailable. Answer IDs from the report are shown where the original options could not be matched.';
