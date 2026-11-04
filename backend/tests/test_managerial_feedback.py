from tests.test_recruitment import client, create, headers, review
from app.config import settings


async def test_managerial_draft_scope_lock_and_summary_failure(client, db, monkeypatch):
    monkeypatch.setattr(settings, "openrouter_api_key", "")
    tech = await create(client)
    assert (await review(client, db, tech)).status_code == 200
    row = await create(client, round="managerial")
    url = f'/api/recruitment/interviews/{row["interviewId"]}'
    payload = {"expectedRevision": row["revision"], "notes": "Observed clear ownership"}
    assert (await client.post(url + '/evaluation-draft', headers=headers('technical_interviewer'), json=payload)).status_code == 404
    result = await client.post(url + '/evaluation-draft', headers=headers('managerial_interviewer'), json=payload)
    assert result.status_code == 200, result.text
    saved = result.json()
    assert saved['evaluationDraft']['status'] == 'draft'
    assert saved['evaluationDraft']['applicationId'] == row['applicationId']
    assert saved['status'] == 'scheduled'
    assert not saved['review']
    assert (await client.post(url + '/evaluation-draft', headers=headers('managerial_interviewer'), json=payload)).status_code == 409
    assert 'evaluationDraft' not in (await client.get(url, headers=headers())).json()
    submitted = await review(client, db, saved, notes=payload['notes'])
    assert submitted.status_code == 200, submitted.text
    evaluation = submitted.json()['review']
    assert evaluation['notes'] == payload['notes']
    assert evaluation['locked']
    assert evaluation['managerialSummary']['status'] == 'failed'
    assert evaluation['managerialSummary']['evaluationId'] == evaluation['reviewId']
    assert (await client.post(url + '/evaluation-draft', headers=headers('managerial_interviewer'), json={**payload, 'expectedRevision': submitted.json()['revision']})).status_code == 409
    assert (await review(client, db, submitted.json())).status_code == 409
    retry = await client.post(url + '/managerial-summary', headers=headers('managerial_interviewer'), json={})
    assert retry.status_code == 200
    assert retry.json()['review']['decision'] == 'advance'
    hr = await create(client, round='hr')
    assert any(r.get('managerialSummary', {}).get('status') == 'failed' for r in hr['previousReviews'])


async def test_successful_summary_is_idempotent(client, db, monkeypatch):
    from types import SimpleNamespace
    from app.services import managerial_feedback as module
    tech = await create(client)
    assert (await review(client, db, tech)).status_code == 200
    row = await create(client, round='managerial')
    assert (await review(client, db, row)).status_code == 200
    monkeypatch.setattr(settings, 'openrouter_api_key', 'synthetic')
    monkeypatch.setattr(settings, 'resume_ats_model', 'test-model')
    async def allowed(*args, **kwargs): return True, None
    async def record(*args, **kwargs): pass
    monkeypatch.setattr(module, 'breaker_check', allowed)
    monkeypatch.setattr(module, 'bucket_take', allowed)
    monkeypatch.setattr(module, 'breaker_record', record)
    calls = []
    class Response:
        def raise_for_status(self): pass
        def json(self):
            return {'choices': [{'message': {'content': '{"overview":"The manager observed accountability.","strengths":["Clear ownership"],"concerns":[],"hrFollowUps":["Discuss collaboration examples."]}'}}]}
    class Provider:
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def post(self, *args, **kwargs):
            calls.append(kwargs['json'])
            return Response()
    monkeypatch.setattr(module.httpx, 'AsyncClient', lambda **kwargs: Provider())
    user = SimpleNamespace(org_id='default', user_id='managerial_interviewer', role='managerial_interviewer')
    await module.generate_summary(db, user, row['interviewId'])
    query = {'orgId': 'default', 'interviewId': row['interviewId']}
    saved = await db.recruit_reviews.find_one(query)
    assert saved['managerialSummary']['status'] == 'completed'
    assert saved['managerialSummary']['previousReviewIds'] == [tech['interviewId']]
    assert saved['decision'] == 'advance'
    await module.generate_summary(db, user, row['interviewId'])
    assert len(calls) == 1
