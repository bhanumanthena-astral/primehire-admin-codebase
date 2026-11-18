from tests.test_resume_intake_v2 import client, headers


async def test_lists_all_967_resumes_across_batches(client, db):
    rows = [{"_id": f"resume-{i:04}", "orgId": "default", "jobId": "a",
        "batchId": f"batch-{i // 4}", "rowNumber": i % 4, "fileName": f"resume-{i}.pdf",
        "status": "review_required", "atsState": "done" if i < 590 else "queued" if i < 592 else "pending",
        "profile": {"name": f"Candidate {i}", "email": "private@example.com"},
        "rawText": "private resume text", "storageKey": "private/path", "confirmation": {"secret": True}}
        for i in range(967)]
    await db["resume_intake_items"].insert_many(rows + [
        {**rows[0], "_id": "deleted", "batchId": "deleted-batch", "status": "deleted"},
        {**rows[0], "_id": "other-job", "batchId": "other-batch", "jobId": "b"},
        {**rows[0], "_id": "other-org", "orgId": "other"}])
    url = "/api/resume-intake/jobs/a/items"
    first = await client.get(url, headers=headers())
    assert first.status_code == 200, first.text
    result = first.json()
    assert result["total"] == 967
    assert len(result["items"]) == 25
    assert len({item["batchId"] for item in result["items"]}) > 1
    assert not {"rawText", "storageKey", "confirmation"} & result["items"][0].keys()
    assert "private@example.com" not in first.text
    ids = []
    for skip in range(0, 967, 100):
        response = await client.get(url, params={"skip": skip, "limit": 100}, headers=headers())
        ids.extend(item["itemId"] for item in response.json()["items"])
    assert len(ids) == len(set(ids)) == 967
    ats = await client.get(url, params={"atsOnly": "true"}, headers=headers())
    assert ats.json()["total"] == 592
    search = await client.get(url, params={"q": "resume-966.pdf"}, headers=headers())
    assert search.json()["total"] == 1
    assert search.json()["items"][0]["itemId"] == "resume-0966"
    denied = await client.get(url, headers=headers("viewer"))
    assert denied.status_code in {403, 404}
    other_org = await client.get(url, headers=headers("hr", "other", "other"))
    assert other_org.status_code == 404
    invalid = await client.get(url, params={"status": "invalid"}, headers=headers())
    assert invalid.status_code == 422
