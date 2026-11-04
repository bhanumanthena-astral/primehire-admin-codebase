"""Start the isolated V2 backend with MongoDB-compatible index filters.

Existing CRUD, shared index definitions and V1 databases are left unchanged.
"""
import sys
from pathlib import Path
from copy import deepcopy

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.config import settings
from app.db import mongodb
from app.schemas.hiring import Stage

TARGET = "primehire_admin_v2"


def main():
    if settings.mongodb_database != TARGET:
        raise SystemExit(f"Refusing to start: V2 must use {TARGET}.")
    if not settings.has_mongo:
        raise SystemExit("V2 requires a persistent configured database connection.")
    settings.resume_module_v2_enabled = True
    settings.recruitment_portals_enabled = True
    from v2_local_tools import configure_local_tools
    configure_local_tools(settings)
    # Keep assessment publication on the current form's provider account.
    # No secret is copied to another file or applied to the V1 process.
    from dotenv import dotenv_values
    from app.services.assessment_management import configure_publication
    form_settings = dotenv_values(Path(__file__).resolve().parents[1] / '.env')
    configure_publication(
        form_settings.get('BACKEND_URL') or settings.primehire_base_url,
        form_settings.get('PRIMEHIRE_ACCESS_KEY') or settings.primehire_access_key,
        form_settings.get('PRIMEHIRE_SECRET_KEY') or settings.primehire_secret_key,
    )

    specifications = deepcopy(mongodb.INDEXES)
    for keys, options in specifications["candidates"]:
        if options.get("name") in {"uniq_interviewId_v2", "uniq_responseId_v2"}:
            options["partialFilterExpression"] = {keys[0][0]: {"$type": "string", "$gt": ""}}
    for _, options in specifications["applications"]:
        if options.get("name") == "uniq_active_application":
            options["partialFilterExpression"] = {
                "currentStage": {"$in": [s.value for s in Stage if s.value not in {"REJECTED", "WITHDRAWN"}]}
            }
    # Override only this process. Migration 002 imports the same in-memory
    # definitions; no shared schema/CRUD source file is edited.
    mongodb.INDEXES = specifications
    import uvicorn
    uvicorn.run("app.main:app", host="127.0.0.1", port=8002)


if __name__ == "__main__":
    main()
