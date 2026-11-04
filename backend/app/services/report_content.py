"""Evidence-only presentation contract for confirmed BASIC/TECHNICAL schemas."""
import math
from .report_normalize import deep_camel

SUPPORTED = {'BASIC', 'TECHNICAL'}
STATUSES = {'NOT_STARTED':'Not Started','PENDING':'Processing','GENERATING':'Processing',
    'PROCESSING':'Processing','GENERATED':'Completed','COMPLETED':'Completed',
    'PARTIAL':'Partial','FAILED':'Failed','ERROR':'Failed','ARCHIVED':'Archived','INVALIDATED':'Invalidated'}


def obj(value):
    return value if isinstance(value, dict) else {}


def number(value):
    return value if isinstance(value,(int,float)) and not isinstance(value,bool) and math.isfinite(value) else None


def pick(*values):
    return next((value for value in values if value is not None),None)


def text(value):
    return value if isinstance(value,str) else None


def strings(value):
    if isinstance(value,str): return [value] if value.strip() else []
    return [v for v in value if isinstance(v,str)] if isinstance(value,list) else []


def metric(label, value=None, *, grade=None, maximum=None, applicability=None):
    value_obj=obj(value)
    return {'label':label, 'value':number(pick(value_obj.get('score'),value_obj.get('value'),value)),
        'grade':text(pick(value_obj.get('grade'),grade)),
        'maximum':number(pick(value_obj.get('maxScore'),value_obj.get('maximum'),maximum)),
        'applicable':value_obj.get('applicable',applicability)}


def presentation(payload, round_type):
    source=deep_camel(obj(payload))
    # PrimeHire helpers return an unwrapped envelope; stored legacy reports may retain data.
    if isinstance(source.get('data'),dict): source=source['data']
    block=obj(source.get('report')) or source
    overall=obj(block.get('overallResult'))
    technical=obj(pick(overall.get('technicalAnalysis'),block.get('technicalProficiency')))
    communication=obj(pick(overall.get('communicationAnalysis'),block.get('communicationAnalysis')))
    presence=obj(pick(overall.get('interviewAnalysis'),block.get('interviewPresence')))
    overview=metric('Overall score',pick(block.get('overallScore'),overall.get('overallScore'),technical.get('overallScore')),
        grade=pick(block.get('overallGrade'),overall.get('overallGrade'),technical.get('overallGrade'),technical.get('grade')),
        maximum=pick(block.get('maxScore'),overall.get('maxScore'),source.get('scoreScale')))
    result={'schemaSupported':round_type in SUPPORTED,'overview':overview,'feedback':[],
        'skillProfile':[],'communication':[],'distribution':[],'questions':[],
        'proctoring':None,'aiSummary':None,'missingSections':[], 'media':{}}
    if round_type not in SUPPORTED:
        result['missingSections']=['Round-specific schema has not been confirmed.']
        return result
    result['feedback']=[
        metric('Technical proficiency',pick(technical.get('overallScore'),technical.get('score'),block.get('technicalProficiencyScore')),
            grade=pick(technical.get('grade'),technical.get('overallGrade'),block.get('technicalProficiencyGrade')),maximum=technical.get('maxScore')),
        metric('Communication',pick(communication.get('overallScore'),communication.get('score')),
            grade=communication.get('grade'),maximum=communication.get('maxScore'))]
    if round_type=='TECHNICAL':
        result['feedback'].append(metric('Interview presence',pick(presence.get('presenceScore'),presence.get('overallScore'),presence.get('score')),
            grade=presence.get('grade'),maximum=presence.get('maxScore')))
    # Confidence and interview presence remain distinct source fields.
    result['skillProfile']=[metric('Technical',pick(technical.get('overallScore'),technical.get('score')),maximum=technical.get('maxScore')),
        metric('Confidence',presence.get('confidenceScore'),maximum=presence.get('maxScore'))]
    for name in ['fluency','grammar','vocabulary','pronunciation']:
        value=metric(name.title(),communication.get(name),maximum=communication.get('maxScore'))
        result['communication'].append(value)
        result['skillProfile'].append(value)
    profile=obj(block.get('skillProfile'))
    for value in result['skillProfile']:
        if value['label'].lower() in profile:
            value.update(metric(value['label'],profile[value['label'].lower()],maximum=profile.get('maxScore')))
    distribution=obj(pick(block.get('scoreDistribution'),overall.get('scoreDistribution')))
    for key in ['technical','communication','presence']:
        result['distribution'].append(metric(key.title(),distribution.get(key),maximum=distribution.get('maxScore')))
    summary=obj(pick(block.get('aiSummary'),overall.get('aiSummary'),source.get('aiSummary')))
    result['aiSummary']={'status':text(summary.get('status')),
        'strengths':strings(summary.get('strengths')),
        'areasForImprovement':strings(pick(summary.get('areasForImprovement'),summary.get('improvements'))),
        'recommendations':strings(summary.get('recommendations'))}
    proctor=obj(pick(source.get('faceapiViolations'),source.get('faceapiAttributes'),source.get('violations'),block.get('proctoring')))
    if proctor:
        result['proctoring']={
            'environment':pick(proctor.get('environment'),proctor.get('environmentStatus')),
            'facesDetected':pick(proctor.get('facesDetected'),proctor.get('faceCount'),proctor.get('multipleFaces')),
            'tabSwitching':pick(proctor.get('tabSwitching'),proctor.get('tabSwitchCount')),
            'flagsDetected':pick(proctor.get('flagsDetected'),proctor.get('flagCount'),proctor.get('flags'))}
    questions=pick(block.get('questionWiseResult'),block.get('questionAnalysis'),[])
    for index,q in enumerate(questions if isinstance(questions,list) else []):
        if not isinstance(q,dict):continue
        analysis=obj(q.get('result'))
        ai=obj(pick(analysis.get('aiAnalysis'),q.get('aiAnalysis')))
        reference=f'q{index+1}'
        url=pick(q.get('videoUrl'),q.get('videoAnswer'))
        if isinstance(url,str) and url: result['media'][reference]=url
        result['questions'].append({
            'reference':reference,'id':text(pick(q.get('id'),q.get('questionId'))),
            'question':text(pick(q.get('question'),q.get('questionText'))),
            'responseReference':pick(q.get('answer'),q.get('response'),q.get('optionId')),
            'correctOptionReference':q.get('correctOptionId'),
            'score':number(pick(q.get('obtainedScore'),q.get('score'))),'maximum':number(q.get('maxScore')),
            'status':text(q.get('status')) or ('Completed' if q.get('isResultGenerated') is True else 'Processing' if q.get('isResultGenerated') is False else None),
            'transcript':text(pick(analysis.get('transcript'),q.get('transcript'))),
            'relevancy':pick(analysis.get('relevancy'),ai.get('relevancy'),q.get('relevancy')),
            'weightage':number(pick(q.get('weightage'),analysis.get('weightage'))),
            'aiAnalysis':pick(text(q.get('aiAnalysis')),text(analysis.get('aiAnalysis')),text(analysis.get('analysis')),text(ai.get('analysis'))),
            'feedback':text(pick(q.get('feedback'),analysis.get('feedback'),q.get('message'))),
            'strengths':strings(pick(q.get('strengths'),analysis.get('strengths'),ai.get('strengths'))),
            'areasForImprovement':strings(pick(q.get('areasForImprovement'),analysis.get('areasForImprovement'),ai.get('areasForImprovement'))),
            'recommendations':strings(pick(q.get('recommendations'),analysis.get('recommendations'),ai.get('recommendations'))),
            'mediaReference':reference if reference in result['media'] else None})
    if overview['value'] is None and overview['grade'] is None: result['missingSections'].append('Overall score / grade')
    if not result['questions']:result['missingSections'].append('Question analysis')
    return result


def generation_status(payload, content, *, report_available=False, submitted=False):
    source=deep_camel(obj(payload))
    source=obj(source.get('data')) or source
    block=obj(source.get('report'))
    status=pick(source.get('reportStatus'),block.get('reportStatus'),block.get('status'))
    mapped=STATUSES.get(str(status or '').upper().replace(' ','_'))
    if mapped:
        return 'Partial' if mapped=='Completed' and content['schemaSupported'] and content['missingSections'] else mapped
    if not payload:return 'Processing' if submitted else 'Not Started'
    pending=any(row['status']=='Processing' for row in content['questions'])
    if pending:return 'Partial' if any(row['status']=='Completed' for row in content['questions']) else 'Processing'
    if report_available:
        # The provider confirms availability; absence of optional metrics is not partial.
        return 'Partial' if content['schemaSupported'] and content['missingSections'] else 'Completed'
    return 'Processing' if submitted else 'Not Started'
