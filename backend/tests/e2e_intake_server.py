"""Module 2 acceptance server: in-memory DB and test-only scanner, no Atlas."""
import asyncio
import os
import sys
import tempfile
from pathlib import Path
from contextlib import asynccontextmanager

folder = tempfile.TemporaryDirectory(prefix="primehire-intake-e2e-")
os.environ.update(RESUME_MODULE_V2_ENABLED="true", MONGODB_DATABASE="primehire_admin_v2",
    STORAGE_DIR=folder.name)
sys.path.insert(0, str(Path(__file__).parent))
import e2e_server as base
from app.config import settings
from app.models.resume_intake import ensure_intake_indexes
from app.services import resume_intake_security
from app.services.resume_intake_jobs import run_intake_workers

from app.services import resume_intake_llm
from app.services.resume_intake_ats import score

async def fixture_ats(db, org, profile, text, job, limits, reference, **kwargs):
    result = score(profile,text,job,limits)
    if profile.get('name','').startswith('Range Candidate '):
        result['overall'] = int(profile['name'].split()[-1])
    result['llmStatus'] = 'not_configured'
    return result

resume_intake_llm.evaluate = fixture_ats  # Synthetic/local scoring only in this isolated test process.
settings.allowed_origins = "http://127.0.0.1:4174"
resume_intake_security.scan = lambda _data: "clean"  # Fixture only, never imported by production.
resume_intake_security.scanner_ready = lambda: True


@asynccontextmanager
async def lifespan(app):
    async with base.lifespan(app):
        await ensure_intake_indexes(base.db)
        worker = asyncio.create_task(run_intake_workers(base.db, concurrency=2, poll_seconds=.1))
        try:
            yield
        finally:
            worker.cancel()
            await asyncio.gather(worker, return_exceptions=True)
            folder.cleanup()


base.app.router.lifespan_context = lifespan
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(base.app, host="127.0.0.1", port=8003)
