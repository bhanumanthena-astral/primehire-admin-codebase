"""Google OAuth/Calendar indexes, isolated to the V2 database."""
async def upgrade(db):
    from app.config import settings
    if settings.mongodb_database == 'primehire_admin_v2':
        from migrations.google_workspace_v2 import upgrade as indexes
        await indexes(db)
