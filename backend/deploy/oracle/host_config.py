"""Initialize credentials on a NEW, dedicated Oracle V2 host. Never print secrets."""
import argparse
import json
import os
import secrets
from pathlib import Path
from urllib.parse import quote


def private_write(path, text, mode=0o600):
    if path.exists():
        raise RuntimeError('Refusing to overwrite existing private configuration')
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    with os.fdopen(descriptor, 'w', encoding='utf-8') as stream:
        stream.write(text)


def initialize(directory, template):
    from pymongo import MongoClient
    from pymongo.errors import OperationFailure
    directory.mkdir(mode=0o750, parents=True, exist_ok=True)
    credentials_path = directory/'mongo-private.json'
    if not credentials_path.exists():
        private_write(credentials_path, json.dumps({name:secrets.token_urlsafe(48)
            for name in ['adminPassword','appPassword','backupPassword']}))
    credentials = json.loads(credentials_path.read_text(encoding='utf-8'))
    root = MongoClient('127.0.0.1',27017,username='elitehr_admin',
        password=credentials['adminPassword'],authSource='admin',serverSelectionTimeoutMS=10000)
    try:
        try:
            root.admin.command('ping')
        except OperationFailure as error:
            if error.code not in (13, 18):
                raise
            # MongoDB's localhost exception permits only initial administrator creation.
            with MongoClient('127.0.0.1',27017,serverSelectionTimeoutMS=10000) as initial:
                initial.admin.command('createUser','elitehr_admin',pwd=credentials['adminPassword'],
                    roles=[{'role':'root','db':'admin'}])
            root.close()
            root = MongoClient('127.0.0.1',27017,username='elitehr_admin',
                password=credentials['adminPassword'],authSource='admin',serverSelectionTimeoutMS=10000)
            root.admin.command('ping')
        names = set(root.list_database_names())
        if names - {'admin','local','config','primehire_admin_v2'}:
            raise RuntimeError('This MongoDB instance is not dedicated to V2; initialization refused.')
        for database, username, password, roles in [
            ('primehire_admin_v2','elitehr_app',credentials['appPassword'],[{'role':'readWrite','db':'primehire_admin_v2'}]),
            ('admin','elitehr_backup',credentials['backupPassword'],[{'role':'backup','db':'admin'}]),
        ]:
            if not root[database].command('usersInfo',username)['users']:
                root[database].command('createUser',username,pwd=password,roles=roles)
        uri = 'mongodb://elitehr_app:'+quote(credentials['appPassword'],safe='')+'@127.0.0.1:27017/primehire_admin_v2?authSource=primehire_admin_v2'
        with MongoClient(uri,serverSelectionTimeoutMS=10000) as app:
            app.admin.command('ping')
        if not (directory/'backend.env').exists():
            text = template.read_text(encoding='utf-8').replace('__PROVISIONED_LOCALLY__',uri)
            private_write(directory/'backend.env',text,0o640)
        if not (directory/'mongo-backup.yml').exists():
            backup_uri = 'mongodb://elitehr_backup:'+quote(credentials['backupPassword'],safe='')+'@127.0.0.1:27017/?authSource=admin'
            private_write(directory/'mongo-backup.yml','uri: '+json.dumps(backup_uri)+'\n')
        if not (directory/'backup.passphrase').exists():
            private_write(directory/'backup.passphrase',secrets.token_urlsafe(64)+'\n')
    finally:
        root.close()


if __name__ == '__main__':
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('--directory',type=Path,default=Path('/etc/elitehr'))
    cli.add_argument('--template',type=Path,required=True)
    args = cli.parse_args()
    if not hasattr(os,'geteuid') or os.geteuid()!=0:
        raise SystemExit('Run only as root on the new dedicated Oracle host.')
    try:
        initialize(args.directory,args.template)
    except Exception as error:
        raise SystemExit('Private MongoDB initialization failed: '+type(error).__name__) from None
    print('Private V2 database users and configuration prepared; application services remain stopped.')
