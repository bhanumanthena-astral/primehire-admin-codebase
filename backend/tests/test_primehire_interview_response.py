"""Provider response envelopes select only the requested candidate."""
import pytest
from app.services.primehire_api import parse_interview_record

@pytest.mark.parametrize('envelope', [
    lambda row: {'data': {'interview':row}},
    lambda row: {'data': {'interviews':[row]}},
    lambda row: {'data': {'candidates':[row]}},
    lambda row: {'data':[row]},
    lambda row: [row],
])
def test_single_and_batch_shapes(envelope):
    row={'interview_id':'int-1','candidate_id':'cand-1','interview_link':'https://example.test/interview/1','password':'code'}
    result=parse_interview_record(envelope(row),'cand-1')
    assert result['interviewId']=='int-1'
    assert result['link']=='https://example.test/interview/1'
    assert result['password']=='code'


def test_selects_matching_candidate_and_rejects_ambiguous_or_mismatched():
    one={'candidate_id':'one','interview_id':'i-one','url':'https://example.test/one'}
    two={'candidate_id':'two','interview_id':'i-two','url':'https://example.test/two'}
    assert parse_interview_record({'data':{'interviews':[one,two]}},'two')['interviewId']=='i-two'
    assert parse_interview_record({'data':[one]},'two') is None
    assert parse_interview_record({'data':[one,two]}) is None
    assert parse_interview_record({'data':{'message':'scheduled'}},'one') is None
