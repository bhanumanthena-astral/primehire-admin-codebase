"""Google identity, encrypted grants, short-lived OAuth tickets, and Calendar outbox."""
INDEXES = [
    ('google_identities', [('orgId', 1), ('userId', 1)], {'unique': True}),
    ('google_identities', [('orgId', 1), ('subject', 1)], {'unique': True}),
    ('google_connections', [('orgId', 1), ('userId', 1)], {'unique': True}),
    ('google_oauth_tickets', [('expiresAt', 1)], {'expireAfterSeconds': 0}),
    ('google_calendar_outbox', [('orgId', 1), ('interviewId', 1), ('scheduleRevision', 1), ('action', 1)], {'unique': True}),
    ('google_calendar_outbox', [('status', 1), ('nextAttemptAt', 1)], {}),
    ('google_calendar_usage', [('expiresAt', 1)], {'expireAfterSeconds': 0}),
]


async def upgrade(db):
    for name, keys, options in INDEXES:
        await db[name].create_index(keys, **options)


async def main():
    import argparse
    from app.config import settings
    from app.db.mongodb import get_database
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--dry-run', action='store_true')
    group.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    if args.dry_run:
        print('Google workspace: five collections, seven identity/outbox/TTL indexes; no existing data rewritten.')
    else:
        if settings.mongodb_database != 'primehire_admin_v2':
            raise RuntimeError('Google workspace requires the isolated V2 database.')
        await upgrade(get_database(settings.mongodb_uri, settings.mongodb_database))


if __name__ == '__main__':
    import asyncio
    asyncio.run(main())
