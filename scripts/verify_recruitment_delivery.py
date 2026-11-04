"""One explicitly authorized test email, through an in-memory recruitment outbox.

Reads the single configured recruitment test recipient; never connects to V1/V2
databases and never changes assessment email settings. Do not run routinely.
"""

import asyncio
import json
import sys
from pathlib import Path
from datetime import timedelta

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.config import settings
from app.models.recruitment import now
from app.services import recruitment_worker as worker
import mongomock_motor


async def main():
    recipients = [
        value.strip()
        for value in settings.recruitment_email_test_recipient_allowlist.split(",")
        if value.strip()
    ]
    if len(recipients) != 1 or recipients[0].startswith("@"):
        raise SystemExit("Configure exactly one explicitly authorized test recipient.")
    if not settings.recruitment_zeptomail_api_key:
        raise SystemExit("Recruitment provider credentials are not configured.")
    settings.recruitment_email_dry_run = False
    database = mongomock_motor.AsyncMongoMockClient()["synthetic_delivery_verification"]
    row = {
        "orgId": "synthetic",
        "interviewId": "synthetic-delivery-check",
        "applicationId": "synthetic-application",
        "applicantId": "synthetic-person",
        "interviewerId": "synthetic-interviewer",
        "round": "technical",
        "status": "scheduled",
        "startsAt": now() + timedelta(days=1),
        "endsAt": now() + timedelta(days=1, hours=1),
        "jobTitle": "[TEST ONLY] Recruitment delivery verification",
        "location": "System verification only. No actual interview is scheduled. No action is required.",
        "revision": 1,
        "scheduleRevision": 1,
    }
    await database["recruit_interviews"].insert_one(row)
    await database["applicants"].insert_one(
        {
            "orgId": "synthetic",
            "applicantId": "synthetic-person",
            "name": "Recruitment verification recipient",
            "email": recipients[0],
        }
    )
    message = await worker.enqueue_email(database, row, "candidate")
    pending = await worker.RecruitmentOutbox(database).get(
        message["messageId"], "synthetic", include_body=True
    )
    await worker.deliver(database, pending)
    result = await database["recruit_email_outbox"].find_one(
        {"messageId": message["messageId"]}
    )
    accepted = result.get("status") == "sent" and result.get("sentVia") == "zepto"
    print(
        json.dumps(
            {
                "providerAccepted": accepted,
                "assessmentSettingsUnchanged": settings.email_dry_run,
                "syntheticOutboxOnly": True,
                "failure": result.get("lastError") if not accepted else None,
            }
        )
    )
    if not accepted:
        raise SystemExit(
            "Provider did not accept the verification message. No recipient or payload logged."
        )


if __name__ == "__main__":
    asyncio.run(main())
