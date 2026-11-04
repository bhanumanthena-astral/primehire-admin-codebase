"""One synthetic HR-question request; no live database or mail operations."""

import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
import mongomock_motor
from app.security.deps import CurrentUser
from app.security.roles import get_permissions_for_role
from app.services.recruitment_questions import generate


async def main():
    db = mongomock_motor.AsyncMongoMockClient()["synthetic_hr_question_check"]
    await db["jobs"].insert_one(
        {
            "orgId": "synthetic",
            "jobId": "fixture-job",
            "title": "Backend Engineer",
            "jobRole": "Backend Engineer",
            "jdText": "Build reliable Python and SQL services with ownership and clear communication.",
        }
    )
    await db["applicants"].insert_one(
        {
            "orgId": "synthetic",
            "applicantId": "fixture-person",
            "name": "Synthetic Candidate",
            "email": "synthetic@example.test",
            "profile": {
                "skills": ["Python", "SQL"],
                "experienceYears": 4,
                "summary": "Builds reliable backend services.",
            },
        }
    )
    for round, strength, concern in [
        (
            "technical",
            "Clear Python fundamentals",
            "Limited examples of production debugging",
        ),
        (
            "managerial",
            "Communicates tradeoffs clearly",
            "Needs stronger examples of ownership",
        ),
    ]:
        await db["recruit_reviews"].insert_one(
            {
                "orgId": "synthetic",
                "applicationId": "fixture-app",
                "reviewId": f"fixture-{round}",
                "round": round,
                "strengths": strength,
                "concerns": concern,
                "comments": "Ask for concrete examples and a development plan.",
            }
        )
    user = CurrentUser(
        "synthetic-hr", "synthetic", "hr", get_permissions_for_role("hr"), "synthetic"
    )
    result = await generate(
        db,
        user,
        {
            "interviewId": "fixture-interview",
            "jobId": "fixture-job",
            "applicantId": "fixture-person",
            "applicationId": "fixture-app",
        },
    )
    print(
        json.dumps(
            {
                "questionCount": len(result["questions"]),
                "method": result["method"],
                "sourceCategories": sorted({q["source"] for q in result["questions"]}),
                "auditEvents": await db["llm_runs"].count_documents({}),
                "error": result.get("error"),
            }
        )
    )
    if result["method"] != "llm":
        raise SystemExit(2)


if __name__ == "__main__":
    asyncio.run(main())
