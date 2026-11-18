"""Persisted invitation state for the currently linked job assessment."""


def invitation_pipeline(org_id, assessment_id):
    # Legacy unscoped assessments belong to the current link; relinking stamps
    # the old ID first, so they never become invitations for a new assessment.
    same = {"$eq": [{"$ifNull": ["$assessment.assessmentId", assessment_id]}, assessment_id]}
    def any_message(statuses, real=None):
        conditions = [{"$in": ["$$message.status", statuses]}]
        if real is not None:
            conditions.append({"$ne" if real else "$eq": ["$$message.sentVia", "dry_run"]})
        return {"$gt": [{"$size": {"$filter": {"input": "$_invitationMessages", "as": "message", "cond": {"$and": conditions}}}}, 0]}
    failed = {"$or": [any_message(["failed", "dead", "cancelled"]), {"$eq": ["$_currentAssessment.state", "failed"]}, {"$eq": ["$_currentAssessment.status", "failed"]}]}
    sent = {"$or": [any_message(["sent"], real=True), {"$and": [
        {"$eq": [any_message(["sent"], real=False), False]},
        {"$or": [{"$eq": ["$_currentAssessment.state", "email_sent"]}, {"$in": ["$_currentAssessment.status", ["email_sent", "in_progress", "completed", "report_pending"]]}, {"$ne": [{"$ifNull": ["$_currentAssessment.sentAt", None]}, None]}]}
    ]}]}
    pending = {"$or": [any_message(["pending", "sending", "sent"]), {"$in": ["$_currentAssessment.state", ["send_requested", "upstream_pending", "email_queued"]]}, {"$in": ["$_currentAssessment.status", ["send_requested", "upstream_pending", "email_queued"]]}]}
    return [
        {"$addFields": {"_currentAssessment": {"$cond": [same, {"$ifNull": ["$assessment", {}]}, {}]}}},
        {"$lookup": {"from": "email_outbox", "localField": "applicationId", "foreignField": "entityKey", "as": "_invitationMessages"}},
        {"$addFields": {"_invitationMessages": {"$filter": {"input": "$_invitationMessages", "as": "message", "cond": {"$and": [
            {"$eq": ["$$message.orgId", org_id]}, {"$eq": ["$$message.kind", "assessment_invite"]}, {"$eq": ["$$message.entityType", "application"]},
            {"$or": [{"$eq": ["$$message.assessmentId", assessment_id]}, {"$and": [same, {"$eq": [{"$ifNull": ["$$message.assessmentId", None]}, None]}]}]}
        ]}}}}},
        {"$addFields": {"invitationState": {"$cond": [sent, "invited", {"$cond": [failed, "failed", {"$cond": [pending, "pending", "not_invited"]}]}]}}},
        {"$addFields": {"canInvite": {"$and": [
            {"$in": ["$invitationState", ["not_invited", "failed"]]},
            {"$eq": [{"$size": "$_invitationMessages"}, 0]},
            {"$eq": [{"$in": ["$currentStage", ["HIRED", "REJECTED", "WITHDRAWN", "TALENT_POOL"]]}, False]}
        ]}}},
    ]
