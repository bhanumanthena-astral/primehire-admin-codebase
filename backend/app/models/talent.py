"""V2-only indexes for durable recommendation runs and their ranked results."""

INDEXES = {
    "talent_match_runs": [
        ([("orgId", 1), ("runId", 1)], {"unique": True}),
        ([("orgId", 1), ("jobId", 1), ("createdAt", -1)], {}),
        ([("status", 1), ("updatedAt", 1)], {}),
        ([("expiresAt", 1)], {"expireAfterSeconds": 0}),
    ],
    "talent_matches": [
        ([("orgId", 1), ("matchId", 1)], {"unique": True}),
        ([("orgId", 1), ("runId", 1), ("score", -1), ("matchId", 1)], {}),
        ([("expiresAt", 1)], {"expireAfterSeconds": 0}),
    ],
}
