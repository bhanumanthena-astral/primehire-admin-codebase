"""Synthetic isolated browser server for recruitment. Never import in production."""

import asyncio
import os
import sys
from pathlib import Path
from datetime import timedelta
from contextlib import asynccontextmanager

sys.path.insert(0, str(Path(__file__).parent))
os.environ.update(
    RECRUITMENT_PORTALS_ENABLED="true",
    MONGODB_DATABASE="primehire_admin_v2",
    RESUME_ATS_MODEL="",
)
import e2e_server as base
from app.config import settings
from app.models.user import UserRepository
from app.security.passwords import hash_password
from app.models.recruitment import now
from migrations.recruitment_v2 import upgrade
from migrations.talent_v2 import upgrade as upgrade_talent
from app.services.recruitment_worker import tick
from app.services.recruitment import schedule
from app.schemas.recruitment import Schedule
from app.security.deps import CurrentUser
from app.security.roles import get_permissions_for_role
from cryptography.fernet import Fernet

settings.recruitment_portals_enabled = True
settings.allowed_origins = "http://127.0.0.1:4175"
settings.outbox_encryption_key = Fernet.generate_key().decode()
settings.recruitment_outbox_encryption_key = ""
settings.recruitment_email_dry_run = True
settings.recruitment_zeptomail_api_key = ""
settings.openrouter_api_key = ""
settings.openrouter_model = ""
settings.resume_ats_model = ""


@asynccontextmanager
async def lifespan(app):
    async with base.lifespan(app):
        await upgrade(base.db)
        await upgrade_talent(base.db)
        for role, name in [
            ("technical_interviewer", "Rahul Demo"),
            ("managerial_interviewer", "Srinivas Demo"),
        ]:
            await UserRepository(base.db).create(
                {
                    "userId": f"browser-{role}",
                    "orgId": "default",
                    "role": role,
                    "name": name,
                    "email": f"{role}@example.com",
                    "isActive": True,
                    "passwordHash": hash_password("Browser-test-only-2026!"),
                }
            )
        await base.db["jobs"].insert_one(
            {
                "jobId": "recruit-job",
                "orgId": "default",
                "title": "Recruitment Platform Engineer",
                "assigneeUserId": "browser-recruiter",
                "positionsTotal": 3,
                "positionsFilled": 0,
                "lifecycleStatus": "OPEN",
                "createdAt": now(),
                "jdHtml": "<p>Build robust Python services and collaborate with product teams.</p>",
            }
        )
        for i in range(7):
            await base.db["applicants"].insert_one(
                {
                    "orgId": "default",
                    "applicantId": f"recruit-person{i}",
                    "name": f"Interview Candidate {i}",
                    "email": f"interview{i}@example.test",
                    "phone": "9876543210",
                    "profile": {
                        "skills": ["Python", "SQL"],
                        "experienceYears": 4,
                        "summary": "Builds reliable backend services.",
                    },
                    "createdAt": now(),
                    "consent": {"given": True},
                }
            )
            await base.db["applications"].insert_one(
                {
                    "orgId": "default",
                    "applicationId": f"recruit-app{i}",
                    "applicantId": f"recruit-person{i}",
                    "jobId": "recruit-job",
                    "currentStage": "ASSESSMENT_COMPLETED",
                    "assessment": {"score": 84, "status": "completed"},
                    "createdAt": now(),
                }
            )
        actor = CurrentUser(
            "browser-admin",
            "default",
            "super_admin",
            get_permissions_for_role("super_admin"),
            "fixture",
        )
        await base.db['jobs'].insert_one({'orgId':'default','jobId':'previous-browser-job','jobKey':'TALENT-BROWSER-SOURCE','requestKey':'talent-browser-source','title':'Previous Backend Role',
            'assigneeUserId':'browser-recruiter','lifecycleStatus':'CLOSED','createdAt':now()-timedelta(days=45)})
        await base.db['applications'].insert_one({'orgId':'default','applicationId':'previous-browser-app',
            'jobId':'previous-browser-job','applicantId':'recruit-person6','currentStage':'REJECTED',
            'assessment':{'score':86,'status':'completed'},'createdAt':now()-timedelta(days=40),
            'talentPool':{'inPool':True,'recontactFlag':'eligible','rejectedAtStage':'HR_ROUND','reason':'Joining availability did not match the earlier role'}})
        await base.db['recruit_reviews'].insert_one({'orgId':'default','reviewId':'previous-browser-review',
            'applicationId':'previous-browser-app','round':'technical','decision':'advance','strengths':'Strong Python service design',
            'concerns':'Discuss scalability examples','comments':'Candidate could fit future backend roles',
            'createdAt':now()-timedelta(days=35),'applied':True})
        # Candidate 6 has no application for the new job until human talent reuse.
        await base.db['applications'].delete_one({'applicationId':'recruit-app6'})
        for i, round in [(1, "technical"), (2, "managerial"), (3, "hr")]:
            interviewer = f'browser-{ "hr" if round=="hr" else round+"_interviewer"}'
            row = await schedule(
                base.db,
                actor,
                Schedule(
                    applicationId=f"recruit-app{i}",
                    round=round,
                    interviewerId=interviewer,
                    startsAt=now() + timedelta(days=i),
                    endsAt=now() + timedelta(days=i, hours=1),
                    meetingLink="https://meet.google.com/test-only",
                    reason="Browser fixture scheduling",
                    overrideReason="Fixture establishes the appropriate round context",
                ),
            )
            await base.db["recruit_interviews"].update_one(
                {"interviewId": row["interviewId"]},
                {
                    "$set": {
                        "startsAt": now() - timedelta(hours=2 + i),
                        "endsAt": now() - timedelta(hours=1 + i),
                    }
                },
            )

        async def worker():
            while True:
                await tick(base.db)
                await asyncio.sleep(0.5)

        task = asyncio.create_task(worker())
        try:
            yield
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)


base.app.router.lifespan_context = lifespan
if __name__ == "__main__":
    import uvicorn

    uvicorn.run(base.app, host="127.0.0.1", port=8004)
