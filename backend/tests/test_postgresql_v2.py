"""Real SQL semantics, concurrency, identity preservation and fail-closed queries."""
import asyncio
import copy
import os
from datetime import datetime, timedelta, timezone

import mongomock_motor
import pytest
from bson import ObjectId
from pymongo.errors import DuplicateKeyError

from app.db.postgres import apply_update
from app.db.postgres_query import Query, decode, encode, identifier


def test_codec_preserves_ids_dates_binary_and_encrypted_fields():
    row = {'_id': ObjectId(), 'at': datetime(2026, 11, 4, 12, 0, tzinfo=timezone.utc),
           'nested': [{'score': 0, 'ciphertext': 'unchanged-encrypted-value', 'data': b'abc'}]}
    result = decode(encode(row))
    assert result['_id'] == row['_id']
    assert result['at'] == row['at'].replace(tzinfo=None)
    assert result['nested'] == row['nested']


def test_sql_parameters_do_not_embed_query_values():
    query = Query('elitehr')
    value = "sensitive@example.test' OR true --"
    statement = query.match({'orgId': 'org-a', '$or': [{'email': value}, {'name': {'$regex': value, '$options': 'i'}}]})
    assert value not in statement
    assert len(query.params) >= 3
    with pytest.raises(ValueError): identifier('elitehr; DROP DATABASE postgres')
    with pytest.raises(NotImplementedError): query.match({'$where': 'true'})
    with pytest.raises(NotImplementedError): query.pipeline('SELECT doc,_ord FROM x', [{'$out': 'y'}])


def test_updates_do_not_mutate_inputs_or_replace_identity():
    row = {'_id': 'a', 'revision': 1, 'nested': {'keep': 2}}
    changed = apply_update(row, {'$set': {'nested.score': 0}, '$inc': {'revision': 1}})
    assert row == {'_id': 'a', 'revision': 1, 'nested': {'keep': 2}}
    assert changed['nested'] == {'keep': 2, 'score': 0}
    assert changed['revision'] == 2
    with pytest.raises(ValueError): apply_update(row, {'$set': {'_id': 'b'}})
    with pytest.raises(NotImplementedError): apply_update(row, {'$unsupported': {'x': 1}})


def test_dotted_array_updates_preserve_questions_and_positions():
    original = {'_id': 'q', 'questions': [{'question': 'First', 'asked': False}, {'question': 'Second'}]}
    changed = apply_update(original, {'$set': {'questions.0.asked': True, 'questions.1.answer': 'Saved'}})
    assert changed['questions'] == [{'question': 'First', 'asked': True}, {'question': 'Second', 'answer': 'Saved'}]
    assert original['questions'][0]['asked'] is False
    removed = apply_update(changed, {'$unset': {'questions.0': ''}})
    assert removed['questions'] == [None, {'question': 'Second', 'answer': 'Saved'}]


async def test_sql_dotted_array_update_preserves_other_questions(pg):
    await pg.question_sets.insert_one({'_id': 'q', 'questions': [{'asked': False}, {'question': 'Keep'}]})
    await pg.question_sets.update_one({'_id': 'q'}, {'$set': {'questions.0.asked': True}})
    saved = await pg.question_sets.find_one({'_id': 'q'})
    assert saved['questions'] == [{'asked': True}, {'question': 'Keep'}]


async def test_sql_transaction_rolls_back_and_pool_remains_usable(pg):
    from psycopg import sql
    await pg.rollback_probe.insert_one({'_id': 'stable', 'value': 'original'})
    table = sql.SQL('{}.{}').format(sql.Identifier(pg.schema), sql.Identifier('rollback_probe'))
    with pytest.raises(RuntimeError, match='synthetic rollback'):
        with pg.pool.connection() as connection:
            connection.execute(sql.SQL("UPDATE {} SET doc=jsonb_set(doc, '{{value}}', '\"changed\"'::jsonb)").format(table))
            raise RuntimeError('synthetic rollback')
    assert (await pg.rollback_probe.find_one({'_id': 'stable'}))['value'] == 'original'
    assert (await pg.rollback_probe.update_one({'_id': 'stable'}, {'$set': {'value': 'committed'}})).modified_count == 1


@pytest.fixture
def pg(db):
    if not os.environ.get('ELITEHR_TEST_POSTGRES_ENV'):
        pytest.skip('Explicit private PostgreSQL validation environment required')
    return db


@pytest.fixture
async def stores(pg):
    mock = mongomock_motor.AsyncMongoMockClient()['testdb']
    rows = [
        {'_id': '1', 'orgId': 'a', 'name': 'Ankit Test', 'email': None, 'skills': ['Python', 'SQL'], 'score': 0, 'profile': {'education': 'BTech'}, 'revision': 1},
        {'_id': '2', 'orgId': 'a', 'name': 'Other Test', 'skills': ['React'], 'score': 71, 'revision': 1},
        {'_id': '3', 'orgId': 'b', 'name': 'Ankit Elsewhere', 'email': 'test@example.test', 'score': 99, 'revision': 1},
    ]
    for database in [pg, mock]:
        await database.people.insert_many(copy.deepcopy(rows))
    return pg, mock


@pytest.mark.parametrize('query', [
    {'orgId': 'a'}, {'score': 0}, {'email': None}, {'email': {'$ne': None}},
    {'email': {'$exists': False}}, {'email': {'$type': 'string'}},
    {'score': {'$gte': 60, '$lte': 80}}, {'skills': {'$in': ['Python']}},
    {'skills': {'$regex': 'python', '$options': 'i'}},
    {'$and': [{'orgId': 'a'}, {'$or': [{'name': {'$regex': 'ankit', '$options': 'i'}}, {'score': 71}]}]},
    {'score': {'$nin': [99]}}, {'skills': {'$size': 1}},
])
async def test_query_and_projection_match_reference(stores, query):
    pg, mock = stores
    projection = {'_id': 1, 'name': 1, 'score': 1, 'profile.education': 1}
    actual = await pg.people.find(query, projection).sort('_id', 1).to_list(50)
    expected = await mock.people.find(query, projection).sort('_id', 1).to_list(50)
    assert actual == expected


async def test_sql_join_scope_filter_group_facet_and_nulls(pg):
    await pg.applications.insert_many([
        {'_id': 'a', 'orgId': 'one', 'applicationId': 'app-a', 'jobId': 'j', 'currentStage': 'HR_ROUND', 'assessment': {'score': 0}},
        {'_id': 'b', 'orgId': 'one', 'applicationId': 'app-b', 'jobId': 'j', 'currentStage': 'HR_ROUND'},
    ])
    await pg.recruit_interviews.insert_many([
        {'_id': 'i1', 'orgId': 'other', 'applicationId': 'app-a', 'status': 'scheduled'},
        {'_id': 'i2', 'orgId': 'one', 'applicationId': 'app-b', 'status': 'scheduled'},
    ])
    from app.services.recruitment import pending_scheduling_pipeline
    rows = await pg.applications.aggregate([{'$match': {'orgId': 'one'}}, *pending_scheduling_pipeline('one', 'hr')]).to_list(50)
    assert [row['applicationId'] for row in rows] == ['app-a']
    from app.services.job_pipeline import pipeline_counts, pipeline_details
    counts = await pipeline_counts(pg, 'one', ['j'])
    assert counts['j']['assessmentsCompleted'] == 1
    assert counts['j']['hr'] == 2
    details = await pipeline_details(pg, 'one', 'j', 'assessmentsCompleted')
    assert details['total'] == 1
    assert details['items'][0]['assessment']['score'] == 0


async def test_conditional_claim_and_revision_are_atomic(pg):
    await pg.jobs.insert_one({'_id': 'job', 'revision': 1, 'status': 'pending'})
    results = await asyncio.gather(*[pg.jobs.find_one_and_update(
        {'_id': 'job', 'revision': 1, 'status': 'pending'},
        {'$set': {'status': 'running', 'owner': str(i)}, '$inc': {'revision': 1}}, return_document=True)
        for i in range(20)])
    assert sum(result is not None for result in results) == 1
    assert (await pg.jobs.find_one({'_id': 'job'}))['revision'] == 2


async def test_assessment_sync_cooldown_handles_dates_and_legacy_strings(pg):
    cutoff=datetime.now(timezone.utc)
    before=cutoff-timedelta(minutes=2)
    await pg.applications.insert_many([
        {'_id':'date','assessment':{'syncedAt':before}},
        {'_id':'text','assessment':{'syncedAt':before.isoformat()}},
        {'_id':'future','assessment':{'syncedAt':cutoff+timedelta(minutes=2)}},
    ])
    rows=await pg.applications.find({'$or':[
        {'assessment.syncedAt':{'$type':'date','$lte':cutoff}},
        {'assessment.syncedAt':{'$type':'string','$lte':cutoff.isoformat()}},
    ]}).sort('_id',1).to_list(10)
    assert [row['_id'] for row in rows]==['date','text']


async def test_partial_uniqueness_upsert_and_explicit_null(pg):
    await pg.people.create_index([('orgId', 1), ('email', 1)], unique=True)
    await pg.people.insert_one({'_id': '1', 'orgId': 'a', 'email': None})
    with pytest.raises(DuplicateKeyError):
        await pg.people.insert_one({'_id': '2', 'orgId': 'a'})
    await pg.assignments.create_index([('orgId', 1), ('applicationId', 1)], unique=True,
        partialFilterExpression={'active': True})
    await pg.assignments.insert_one({'_id': 'old', 'orgId': 'a', 'applicationId': 'app', 'active': False})
    await pg.assignments.insert_one({'_id': 'new', 'orgId': 'a', 'applicationId': 'app', 'active': True})
    with pytest.raises(DuplicateKeyError):
        await pg.assignments.insert_one({'_id': 'duplicate', 'orgId': 'a', 'applicationId': 'app', 'active': True})
    first = await pg.leases.find_one_and_update({'_id': 'lease', 'owner': 'a'}, {'$set': {'owner': 'a'}}, upsert=True, return_document=True)
    assert first['owner'] == 'a'
    with pytest.raises(DuplicateKeyError):
        await pg.leases.find_one_and_update({'_id': 'lease', 'owner': 'b'}, {'$set': {'owner': 'b'}}, upsert=True)
    result = await pg.applicants.update_one({'applicantId':'stable'},
        {'$setOnInsert':{'_id':'stable-candidate','name':'Synthetic Candidate'}}, upsert=True)
    assert result.upserted_id == 'stable-candidate'
    assert await pg.applicants.find_one({'applicantId':'stable'},{'_id':1}) == {'_id':'stable-candidate'}


async def test_iteration_does_not_skip_mutated_records(pg):
    await pg.jobs.insert_many([{'_id': str(i), 'status': 'pending'} for i in range(270)])
    count = 0
    async for row in pg.jobs.find({'status': 'pending'}):
        await pg.jobs.update_one({'_id': row['_id']}, {'$set': {'status': 'done'}})
        count += 1
    assert count == 270
    assert await pg.jobs.count_documents({'status': 'done'}) == 270


async def test_expiry_cleanup_does_not_hold_locks_during_iteration(pg):
    stamp=datetime.now(timezone.utc)
    await pg.leases.create_index('expiresAt',expireAfterSeconds=0)
    await pg.leases.insert_many([
        {'_id':'expired','expiresAt':stamp-timedelta(minutes=1)},
        {'_id':'live','expiresAt':stamp+timedelta(minutes=5)},
    ])
    seen=[]
    async for row in pg.leases.find({}):
        seen.append(row['_id'])
        await asyncio.wait_for(pg.leases.update_one({'_id':'expired'},
            {'$set':{'expiresAt':stamp+timedelta(minutes=5)}},upsert=True),timeout=2)
    assert seen == ['live']
    assert await pg.leases.count_documents({}) == 2


async def test_all_v2_index_migrations_apply_to_postgres(pg, monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, 'resume_module_v2_enabled', True)
    monkeypatch.setattr(settings, 'mongodb_database', 'primehire_admin_v2')
    pg.name = 'primehire_admin_v2'
    from migrations.postgresql_v2 import upgrade
    report = await upgrade(pg, dry_run=True)
    assert report['status'] == 'pending'
    assert await pg.list_collection_names() == []
    assert (await upgrade(pg))['status'] == 'applied'
    from migrations.runner import run_migrations
    await run_migrations(pg)
    from migrations.resume_intake_v2 import upgrade as intake
    from migrations.recruitment_v2 import upgrade as recruitment
    from migrations.talent_v2 import upgrade as talent
    from migrations.assessment_management_v2 import upgrade as assessments
    from migrations.candidate_management_v2 import upgrade as candidates
    from migrations.reporting_v2 import upgrade as reporting
    from migrations.google_workspace_v2 import upgrade as google
    for migration in [intake, recruitment, talent, assessments, candidates, reporting, google]:
        await migration(pg)
    assert 'uniq_userId' in await pg.users.index_information()
