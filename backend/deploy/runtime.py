"""Production-only, loopback-bound entry points for the isolated V2 backend."""
import argparse
import asyncio
from copy import deepcopy
from pathlib import Path

TARGET = 'primehire_admin_v2'


def validate_deployment(config):
    from app.config import validate_settings
    from pymongo.uri_parser import parse_uri
    if not config.is_production or config.mongodb_database != TARGET:
        raise RuntimeError('Oracle deployment requires production and the isolated V2 database.')
    if not config.resume_module_v2_enabled or not config.recruitment_portals_enabled:
        raise RuntimeError('Both V2 feature flags must be enabled.')
    if config.database_backend == 'postgresql':
        from urllib.parse import urlsplit
        try:
            parsed_pg = urlsplit(config.postgres_url)
            valid_pg = (parsed_pg.scheme == 'postgresql' and parsed_pg.hostname == '127.0.0.1'
                and parsed_pg.port == 5432 and parsed_pg.username == 'elitehr_app'
                and parsed_pg.password and parsed_pg.path == '/elitehr_v2')
        except ValueError:
            valid_pg = False
        if not valid_pg:
            raise RuntimeError('POSTGRES_URL must address the authenticated private E2E V2 database.')
    else:
        if not config.mongodb_uri.startswith('mongodb://'):
            raise RuntimeError('Oracle deployment requires the local Oracle-hosted MongoDB, not Atlas.')
        try:
            parsed = parse_uri(config.mongodb_uri)
        except Exception:
            raise RuntimeError('MONGODB_URI is invalid.') from None
        if parsed['nodelist'] != [('127.0.0.1', 27017)] or parsed.get('database') != TARGET:
            raise RuntimeError('MONGODB_URI must address only the loopback V2 database.')
        if not parsed.get('username') or not parsed.get('password'):
            raise RuntimeError('MongoDB authentication is required.')
        if parsed['username'] != 'elitehr_app' or parsed.get('options', {}).get('authSource') != TARGET:
            raise RuntimeError('Use the least-privilege V2 application database account.')
    if config.resume_clamd_host != '127.0.0.1':
        raise RuntimeError('The scanner must be private to the Oracle host.')
    if not config.clamav_enabled:
        raise RuntimeError('Malware scanning must be enabled in production.')
    if not Path(config.storage_dir).is_absolute():
        raise RuntimeError('STORAGE_DIR must be an absolute persistent directory.')
    for name in ('jwt_secret','resume_identity_secret','outbox_encryption_key','zeptomail_api_key'):
        value = getattr(config, name, '')
        if not value.strip() or value.strip().startswith('__'):
            raise RuntimeError(f'{name.upper()} must be configured securely before start.')
    from cryptography.fernet import Fernet
    try:
        Fernet(config.outbox_encryption_key.strip().encode())
    except (ValueError, TypeError):
        raise RuntimeError('OUTBOX_ENCRYPTION_KEY must be a valid Fernet key.') from None
    if config.free_tier_guard_enabled:
        if not config.resume_kafka_enabled or config.resume_worker_concurrency != 1:
            raise RuntimeError('Free profile requires Kafka and exactly one intake lane.')
        if config.resume_kafka_bootstrap_servers != '127.0.0.1:9092':
            raise RuntimeError('Free profile requires the private loopback Kafka broker.')
        for model in (config.openrouter_model, config.resume_ats_model):
            if model and not (model.endswith(':free') or model == 'openrouter/free'):
                raise RuntimeError('Free profile accepts only explicit OpenRouter free models.')
        if config.free_tier_active_resume_limit != 1000:
            raise RuntimeError('Free profile requires a 1000-resume admission limit.')
    validate_settings(config)


def v2_index_specs(specifications):
    """Keep the existing V2 launcher's index compatibility without changing V1."""
    from app.schemas.hiring import Stage
    result = deepcopy(specifications)
    for keys, options in result['candidates']:
        if options.get('name') in {'uniq_interviewId_v2','uniq_responseId_v2'}:
            options['partialFilterExpression'] = {keys[0][0]: {'$type':'string','$gt':''}}
    for _, options in result['applications']:
        if options.get('name') == 'uniq_active_application':
            options['partialFilterExpression'] = {'currentStage': {'$in':[
                stage.value for stage in Stage if stage.value not in {'REJECTED','WITHDRAWN'}]}}
    return result


async def check_dependencies(config):
    import tempfile
    from app.db.mongodb import get_database
    from app.services.resume_intake_security import scanner_ready, scan
    db = get_database(config.mongodb_uri, TARGET)
    await db.command('ping')
    storage = Path(config.storage_dir)
    if not storage.is_dir():
        raise RuntimeError('Persistent storage is not provisioned.')
    with tempfile.TemporaryFile(dir=storage) as probe:
        probe.write(b'readiness')
    if not await asyncio.to_thread(scanner_ready):
        raise RuntimeError('The malware scanner is not ready.')
    if await asyncio.to_thread(scan, b'Elite HR synthetic deployment readiness check') != 'clean':
        raise RuntimeError('The synthetic scan did not succeed.')
    if config.free_tier_guard_enabled:
        from app.services.capacity_guard import require_capacity
        await asyncio.to_thread(require_capacity, config=config)
    if config.resume_kafka_enabled:
        from aiokafka import AIOKafkaProducer
        producer = AIOKafkaProducer(bootstrap_servers=config.resume_kafka_bootstrap_servers,
            request_timeout_ms=15000)
        try:
            await asyncio.wait_for(producer.start(), timeout=20)
        finally:
            await producer.stop()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('role', choices=['api','resume','assessment','recruitment','scheduler','check'])
    parser.add_argument('--env-file', type=Path)
    args = parser.parse_args()
    if args.env_file:
        from dotenv import load_dotenv
        load_dotenv(args.env_file, override=True)
    # Import settings only after the optional private environment file is loaded.
    from app.config import settings
    validate_deployment(settings)
    from app.db import mongodb
    mongodb.INDEXES = v2_index_specs(mongodb.INDEXES)
    if args.role == 'check':
        asyncio.run(check_dependencies(settings))
        print('V2 configuration, private database, storage and scanner: ready')
    elif args.role == 'api':
        import uvicorn
        uvicorn.run('app.main:app', host='127.0.0.1', port=8002, workers=1,
            proxy_headers=True, forwarded_allow_ips='127.0.0.1', server_header=False,
            access_log=False, limit_concurrency=64, backlog=256, timeout_graceful_shutdown=60)
    else:
        db = mongodb.get_database(settings.mongodb_uri, TARGET)
        if args.role == 'resume':
            if settings.resume_kafka_enabled:
                from app.services.resume_kafka import run
                asyncio.run(run(db))
            else:
                from app.services.resume_intake_jobs import supervise_intake_workers
                asyncio.run(supervise_intake_workers(db, concurrency=settings.resume_worker_concurrency))
        elif args.role == 'assessment':
            from app.services.worker import run_forever
            asyncio.run(run_forever(db, poll_seconds=2,
                kinds=['assessment_send','assessment_sync','report_sync']))
        elif args.role == 'recruitment':
            from app.services.recruitment_worker import run
            asyncio.run(run(db))
        else:
            from app.services.worker import run_forever, HANDLERS
            kinds = [kind for kind in HANDLERS if not kind.startswith('resume_intake_')]
            asyncio.run(run_forever(db, kinds=kinds))


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, ValueError) as error:
        # Validation messages contain variable names, never secret values.
        raise SystemExit(str(error)) from None
