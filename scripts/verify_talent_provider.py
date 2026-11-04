"""One synthetic talent comparison; no live database or candidate data."""

import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
import mongomock_motor
from app.services.talent import advise


async def main():
    db = mongomock_motor.AsyncMongoMockClient()["synthetic_talent_provider"]
    user = type("SyntheticUser", (), {"org_id": "synthetic"})()
    result = await advise(
        db,
        user,
        {
            "title": "Backend Engineer",
            "keywords": ["Python", "SQL"],
            "jdText": "Build Python APIs, test services and collaborate with product teams.",
            "minExperienceYears": 2,
        },
        {
            "assessment": {"score": 84},
            "talentPool": {"reason": "Previous joining window did not align"},
        },
        {
            "skills": ["Python", "SQL"],
            "experienceYears": 4,
            "summary": "Builds backend APIs and writes service tests.",
            "education": ["B.Tech"],
        },
        [
            {
                "round": "technical",
                "decision": "advance",
                "strengths": "Clear Python examples",
                "concerns": "Limited distributed architecture examples",
                "comments": "Good fundamentals; verify architecture depth",
            },
            {
                "round": "managerial",
                "decision": "advance",
                "strengths": "Strong ownership",
                "concerns": "Develop cross-team communication",
                "comments": "Suitable for guided backend delivery",
            },
        ],
        "synthetic-talent-comparison",
    )
    print(
        json.dumps(
            {
                "method": result["method"],
                "providerStatus": result["providerStatus"],
                "scoreValid": 0 <= result["score"] <= 100,
                "auditCount": await db["llm_runs"].count_documents({}),
                "syntheticOnly": True,
            }
        )
    )


if __name__ == "__main__":
    asyncio.run(main())
