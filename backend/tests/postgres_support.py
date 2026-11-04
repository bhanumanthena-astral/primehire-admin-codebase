"""Explicit real-PostgreSQL test fixture; never accepts a production database."""
import os
import uuid
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

from dotenv import dotenv_values
from psycopg import sql


def validation_database():
    from app.db.postgres import PostgresDatabase
    path = os.environ.get('ELITEHR_TEST_POSTGRES_ENV', '')
    if not path:
        return None
    values = dotenv_values(Path(path))
    parsed = urlsplit(values.get('POSTGRES_URL', ''))
    if parsed.hostname not in {'127.0.0.1', 'localhost'} or parsed.path not in {'/elitehr_v2', '/elitehr_v2_validation'}:
        raise RuntimeError('Tests require the explicit loopback E2E validation database')
    uri = urlunsplit(parsed._replace(path='/elitehr_v2_validation'))
    return PostgresDatabase(uri, 'testdb', 'test_' + uuid.uuid4().hex)


def dispose(database):
    # The schema name is generated above; never accept an externally supplied
    # schema or run DROP against the deployed application's elitehr schema.
    if not database.schema.startswith('test_') or len(database.schema) != 37:
        raise RuntimeError('Refusing to clean a non-test schema')
    with database.pool.connection() as connection:
        connection.execute(sql.SQL('DROP SCHEMA IF EXISTS {} CASCADE').format(sql.Identifier(database.schema)))
    database.close()
