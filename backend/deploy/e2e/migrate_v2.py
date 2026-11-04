"""Encrypted, read-only V2 snapshot and verified PostgreSQL import.

No secrets or candidate values are printed. SQL import refuses a nonempty
target. The source MongoDB and V1 are never written by this tool.
"""
from __future__ import annotations
import argparse
import asyncio
import hashlib
import io
import json
import os
import tarfile
import tempfile
from pathlib import Path, PurePosixPath

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

TARGET = 'primehire_admin_v2'
MAGIC = b'ELITEHR-PG-V1\n'


def digest(document):
    from app.db.postgres_query import encode
    data = json.dumps(encode(document), sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode()
    return hashlib.sha256(data).hexdigest()


def combined(hashes):
    return hashlib.sha256('\n'.join(sorted(hashes)).encode()).hexdigest()


def storage_keys(value):
    if isinstance(value, dict):
        for child in value.values(): yield from storage_keys(child)
    elif isinstance(value, list):
        for child in value: yield from storage_keys(child)
    elif isinstance(value, str) and value.startswith('resumes/'):
        parts = PurePosixPath(value).parts
        if len(parts) == 3 and not any(p in {'.', '..', ''} for p in parts) and '\\' not in value:
            yield value


def encrypt(source, target, key):
    nonce = os.urandom(12)
    cipher = Cipher(algorithms.AES(key), modes.GCM(nonce)).encryptor()
    cipher.authenticate_additional_data(MAGIC)
    with source.open('rb') as reader, target.open('xb') as writer:
        writer.write(MAGIC + nonce)
        while chunk := reader.read(1024 * 1024): writer.write(cipher.update(chunk))
        writer.write(cipher.finalize())
        writer.write(cipher.tag)
    target.chmod(0o600)


def decrypt(source, target, key):
    length = source.stat().st_size
    with source.open('rb') as reader:
        if reader.read(len(MAGIC)) != MAGIC: raise RuntimeError('Invalid migration snapshot')
        nonce = reader.read(12)
        reader.seek(-16, 2)
        tag = reader.read(16)
        reader.seek(len(MAGIC) + 12)
        cipher = Cipher(algorithms.AES(key), modes.GCM(nonce, tag)).decryptor()
        cipher.authenticate_additional_data(MAGIC)
        remaining = length - len(MAGIC) - 12 - 16
        with target.open('xb') as writer:
            while remaining:
                chunk = reader.read(min(1024 * 1024, remaining))
                if not chunk: raise RuntimeError('Truncated migration snapshot')
                remaining -= len(chunk)
                writer.write(cipher.update(chunk))
            writer.write(cipher.finalize())
    target.chmod(0o600)


def archive_bytes(archive, name, data):
    member = tarfile.TarInfo(name)
    member.size = len(data)
    member.mode = 0o600
    archive.addfile(member, io.BytesIO(data))


async def export_snapshot(output, key_file):
    from app.config import settings
    from app.db.postgres_query import encode, identifier
    from motor.motor_asyncio import AsyncIOMotorClient
    from dotenv import dotenv_values
    if settings.mongodb_database != TARGET or not settings.mongodb_uri:
        raise RuntimeError('Export requires the existing isolated V2 MongoDB configuration')
    if output.exists() or key_file.exists():
        raise RuntimeError('Choose fresh snapshot and key paths; existing backups are never overwritten')
    client = AsyncIOMotorClient(settings.mongodb_uri, serverSelectionTimeoutMS=5000)
    database = client[TARGET]
    storage = settings.resolved_storage_dir.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    key_file.parent.mkdir(parents=True, exist_ok=True)
    key = os.urandom(32)
    with key_file.open('xb') as stream: stream.write(key)
    key_file.chmod(0o600)
    manifest = {'version': 1, 'database': TARGET, 'collections': {}, 'files': {}, 'missingFiles': []}
    try:
        with tempfile.TemporaryDirectory(prefix='elitehr-v2-', dir=output.parent) as temporary:
            base = Path(temporary)
            payload = base/'snapshot.tar.gz'
            references = set()
            with tarfile.open(payload, 'w:gz') as archive:
                for name in sorted(await database.list_collection_names()):
                    identifier(name)
                    records = base/(name + '.jsonl')
                    hashes, count = [], 0
                    with records.open('wb') as stream:
                        async for document in database[name].find({}).sort('_id', 1):
                            stream.write(json.dumps(encode(document), sort_keys=True, ensure_ascii=False, allow_nan=False).encode() + b'\n')
                            hashes.append(digest(document))
                            references.update(storage_keys(document))
                            count += 1
                    indices = await database[name].index_information()
                    safe_indexes = {k: {field: value for field, value in spec.items() if field in {'key', 'unique', 'sparse', 'expireAfterSeconds', 'partialFilterExpression'}} for k, spec in indices.items() if k != '_id_'}
                    manifest['collections'][name] = {'count': count, 'sha256': combined(hashes), 'indexes': safe_indexes}
                    archive.add(records, 'collections/' + name + '.jsonl')
                for reference in sorted(references):
                    path = storage / reference
                    if path.is_symlink() or not path.resolve().is_relative_to(storage):
                        raise RuntimeError('Unsafe V2 storage reference')
                    if not path.is_file():
                        manifest['missingFiles'].append(reference)
                        continue
                    manifest['files'][reference] = hashlib.sha256(path.read_bytes()).hexdigest()
                    archive.add(path, 'storage/' + reference)
                values = settings.model_dump()
                # Use the same provider account as the running V2 launcher.
                form = dotenv_values(Path(__file__).resolve().parents[3]/'.env')
                for root_key, setting in [('BACKEND_URL','primehire_base_url'),('PRIMEHIRE_ACCESS_KEY','primehire_access_key'),('PRIMEHIRE_SECRET_KEY','primehire_secret_key')]:
                    if form.get(root_key): values[setting] = form[root_key]
                if not values.get('zeptomail_api_key') and form.get('ZEPTOMAIL_API_KEY'):
                    values['zeptomail_api_key'] = form['ZEPTOMAIL_API_KEY']
                archive_bytes(archive, 'private-settings.json', json.dumps(values).encode())
                archive_bytes(archive, 'manifest.json', json.dumps(manifest, sort_keys=True).encode())
            encrypt(payload, output, key)
    finally:
        client.close()
    print(json.dumps({'snapshot': output.name, 'collections': len(manifest['collections']),
        'documents': sum(v['count'] for v in manifest['collections'].values()),
        'files': len(manifest['files']), 'missingFileReferences': len(manifest['missingFiles']),
        'sha256': hashlib.sha256(output.read_bytes()).hexdigest()}))


async def import_snapshot(snapshot, key_file, env_file, storage_dir, *, validation=False):
    from dotenv import dotenv_values
    from app.db.postgres import PostgresDatabase
    from app.db.postgres_query import decode, identifier
    values = dotenv_values(env_file)
    uri = values.get('POSTGRES_URL','')
    from urllib.parse import urlsplit, urlunsplit
    parsed = urlsplit(uri)
    if parsed.hostname != '127.0.0.1' or parsed.path != '/elitehr_v2':
        raise RuntimeError('Import requires the dedicated private E2E PostgreSQL target')
    if validation:
        uri = urlunsplit(parsed._replace(path='/elitehr_v2_validation'))
    database = PostgresDatabase(uri, TARGET, 'migration_check' if validation else 'elitehr')
    try:
        for name in await database.list_collection_names():
            if await database[name].count_documents({}):
                raise RuntimeError('Target is not empty; refusing to overwrite data')
        storage_dir.mkdir(parents=True, exist_ok=True)
        if any(storage_dir.iterdir()):
            raise RuntimeError('Target storage is not empty; refusing to overwrite files')
        with tempfile.TemporaryDirectory(prefix='elitehr-import-') as temporary:
            payload = Path(temporary)/'snapshot.tar.gz'
            decrypt(snapshot, payload, key_file.read_bytes())
            with tarfile.open(payload,'r:gz') as archive:
                manifest = json.load(archive.extractfile('manifest.json'))
                if manifest.get('database') != TARGET or manifest.get('version') != 1:
                    raise RuntimeError('Snapshot does not contain isolated V2 data')
                expected = {'manifest.json','private-settings.json'} | {'collections/'+name+'.jsonl' for name in manifest['collections']} | {'storage/'+name for name in manifest['files']}
                if {m.name for m in archive.getmembers()} != expected or any(not m.isfile() for m in archive.getmembers()):
                    raise RuntimeError('Unexpected snapshot members')
                for name, metadata in manifest['collections'].items():
                    identifier(name)
                    hashes = []
                    for line in archive.extractfile('collections/'+name+'.jsonl'):
                        document = decode(json.loads(line))
                        hashes.append(digest(document))
                        await database[name].insert_one(document)
                    if len(hashes) != metadata['count'] or combined(hashes) != metadata['sha256']:
                        raise RuntimeError('Snapshot document verification failed')
                    actual = [digest(row) async for row in database[name].find({})]
                    if combined(actual) != metadata['sha256']:
                        raise RuntimeError('PostgreSQL round-trip verification failed')
                for reference, expected_hash in manifest['files'].items():
                    parts = PurePosixPath(reference).parts
                    if len(parts) != 3 or parts[0] != 'resumes' or any(p in {'.','..'} for p in parts):
                        raise RuntimeError('Unsafe archive storage path')
                    destination = storage_dir.joinpath(*parts)
                    if not destination.resolve().is_relative_to(storage_dir.resolve()):
                        raise RuntimeError('Storage path escapes the private directory')
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    data = archive.extractfile('storage/'+reference).read()
                    if hashlib.sha256(data).hexdigest() != expected_hash:
                        raise RuntimeError('Snapshot file checksum mismatch')
                    with destination.open('xb') as stream: stream.write(data)
                    destination.chmod(0o600)
                for name, metadata in manifest['collections'].items():
                    for index_name, spec in metadata['indexes'].items():
                        options = {k:v for k,v in spec.items() if k != 'key'}
                        await database[name].create_index(spec['key'], name=index_name, **options)
                if not validation:
                    private = json.load(archive.extractfile('private-settings.json'))
                    # Preserve effective local keys, including existing fallbacks.
                    # The local intake HMAC falls back to JWT_SECRET; candidate
                    # link encryption falls back to the recruitment outbox key.
                    private['resume_identity_secret'] = private.get('resume_identity_secret') or private.get('jwt_secret','')
                    private['outbox_encryption_key'] = private.get('outbox_encryption_key') or private.get('recruitment_outbox_encryption_key','')
                    private.update(env='production',debug=False,database_backend='postgresql',mongodb_uri='',
                        mongodb_database=TARGET,postgres_url=values['POSTGRES_URL'],postgres_schema='elitehr',
                        storage_dir=str(storage_dir),resume_module_v2_enabled=True,recruitment_portals_enabled=True,
                        free_tier_guard_enabled=False,resume_kafka_enabled=False,resume_worker_concurrency=1,
                        resume_ocr_tessdata='/usr/share/tesseract-ocr/5/tessdata',resume_doc_converter='/usr/bin/antiword',
                        resume_clamd_host='127.0.0.1',resume_clamd_port=3310,clamav_enabled=True,
                        allowed_origins='http://localhost:18080,http://127.0.0.1:18080,http://localhost:3000,http://127.0.0.1:3000',
                        google_oauth_enabled=False, email_dry_run=False, recruitment_email_dry_run=True,
                        llm_fake_provider='off',migration_secret='')
                    target = env_file.parent/'backend.env'
                    def text(value):
                        if value is None: return ''
                        return str(value).lower() if isinstance(value,bool) else str(value)
                    # dotenv double-quoted values preserve backslashes/newlines.
                    content = ''.join(key.upper()+'='+json.dumps(text(value))+'\n' for key,value in private.items())
                    with target.open('x') as stream: stream.write(content)
                    target.chmod(0o640)
                    import grp
                    os.chown(target,0,grp.getgrnam('elitehr').gr_gid)
                report = {'verified': True, 'validation': validation, 'collections': len(manifest['collections']),
                    'documents': sum(v['count'] for v in manifest['collections'].values()),
                    'files': len(manifest['files']), 'missingFileReferences': len(manifest['missingFiles'])}
                report_path = env_file.parent/('migration-validation.json' if validation else 'migration-verified.json')
                report_path.write_text(json.dumps(report),encoding='utf-8')
                report_path.chmod(0o600)
                print(json.dumps(report))
    finally:
        database.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=['export','import'])
    parser.add_argument('--snapshot',required=True,type=Path)
    parser.add_argument('--key-file',required=True,type=Path)
    parser.add_argument('--env-file',type=Path,default=Path('/etc/elitehr/postgres.env'))
    parser.add_argument('--storage-dir',type=Path,default=Path('/var/lib/elitehr/storage'))
    parser.add_argument('--validation',action='store_true')
    args=parser.parse_args()
    if args.action=='export': asyncio.run(export_snapshot(args.snapshot,args.key_file))
    else: asyncio.run(import_snapshot(args.snapshot,args.key_file,args.env_file,args.storage_dir,validation=args.validation))


if __name__=='__main__':
    main()
