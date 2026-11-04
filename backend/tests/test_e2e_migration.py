"""Migration archive authenticity and source/target safeguards, synthetic data."""
import json
from datetime import datetime, timezone

import pytest
from cryptography.exceptions import InvalidTag
from deploy.e2e.migrate_v2 import combined, decrypt, digest, encrypt, storage_keys


def test_encrypted_snapshot_round_trip_and_tamper_detection(tmp_path):
    source, sealed, restored = (tmp_path/name for name in ['source','sealed','restored'])
    source.write_bytes(b'Synthetic private migration content\n' * 70000)
    key = b'k' * 32
    encrypt(source,sealed,key)
    assert b'Synthetic private migration content' not in sealed.read_bytes()
    decrypt(sealed,restored,key)
    assert restored.read_bytes() == source.read_bytes()
    damaged = bytearray(sealed.read_bytes()); damaged[-25] ^= 1
    sealed.write_bytes(damaged)
    with pytest.raises(InvalidTag): decrypt(sealed,tmp_path/'bad',key)


def test_snapshot_never_overwrites_existing_archive(tmp_path):
    source, sealed = tmp_path/'source', tmp_path/'sealed'
    source.write_bytes(b'Synthetic content'); sealed.write_bytes(b'existing backup')
    with pytest.raises(FileExistsError): encrypt(source,sealed,b'k'*32)
    assert sealed.read_bytes() == b'existing backup'


def test_only_contained_resume_references_are_selected():
    document={'originals':[{'storageKey':'resumes/default/abc.pdf'}],
        'versions':[{'storageKey':'resumes/default/xyz.docx'}],
        'bad':['resumes/../secret','resumes/default/../../secret','resumes/default/bad\\file','https://remote.test/file']}
    assert set(storage_keys(document)) == {'resumes/default/abc.pdf','resumes/default/xyz.docx'}


def test_document_digest_is_stable_across_utc_storage_and_order():
    from app.db.postgres_query import decode, encode
    row={'_id':'stable','score':0,'at':datetime(2026,11,4,tzinfo=timezone.utc)}
    assert digest(row) == digest(decode(encode(row)))
    assert combined(['a','b']) == combined(['b','a'])


async def test_export_refuses_v1_before_creating_files(tmp_path,monkeypatch):
    from app.config import settings
    from deploy.e2e.migrate_v2 import export_snapshot
    monkeypatch.setattr(settings,'mongodb_database','primehire')
    with pytest.raises(RuntimeError,match='isolated V2'):
        await export_snapshot(tmp_path/'snapshot',tmp_path/'key')
    assert list(tmp_path.iterdir()) == []


async def test_import_rejects_public_database_before_connecting(tmp_path):
    from deploy.e2e.migrate_v2 import import_snapshot
    config=tmp_path/'postgres.env'
    config.write_text('POSTGRES_URL=postgresql://synthetic:password@203.0.113.2:5432/elitehr_v2\n')
    with pytest.raises(RuntimeError,match='private E2E'):
        await import_snapshot(tmp_path/'absent',tmp_path/'absent-key',config,tmp_path/'storage')
