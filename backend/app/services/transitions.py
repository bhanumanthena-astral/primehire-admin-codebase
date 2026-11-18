"""Single stage-transition service (protocol rule: every change goes through here).

Both the HTTP route and the background worker call `transition_application()`
so history + audit stay identical. Permission checks stay at the API layer;
the service enforces the state machine, terminal statuses, and history/audit.
"""

from __future__ import annotations

from typing import Any

from ..models.hiring import (
    ApplicationRepository,
    ApplicationStatus,
    AuditLogRepository,
    Stage,
    StageHistoryRepository,
    can_transition,
)


class TransitionError(Exception):
    """Invalid move (message is safe to surface, stages only, no PII)."""


async def transition_application(
    db: Any,
    *,
    org_id: str,
    application_id: str,
    to_stage: Stage | str,
    actor_user_id: str,
    reason: str,
    is_override: bool = False,
    metadata: dict[str, Any] | None = None,
    ip_address: str = "",
) -> dict[str, Any]:
    target = Stage(to_stage) if isinstance(to_stage, str) else to_stage
    if not (reason or "").strip():
        raise TransitionError("A reason is required for every stage change.")
    repo = ApplicationRepository(db)
    app_doc = await repo.get_by_id(application_id, org_id)
    if not app_doc:
        raise TransitionError("Application not found.")
    from contextlib import nullcontext
    from ..models.recruitment import lease

    async with lease(db, org_id, ["stage-transition:" + application_id]):
        app_doc = await repo.get_by_id(application_id, org_id)
        if not app_doc:
            raise TransitionError("Application not found.")
        claim = (
            lease(db, org_id, ["position-count:" + str(app_doc.get("jobId"))])
            if target == Stage.HIRED or app_doc["currentStage"] == Stage.HIRED.value
            else nullcontext()
        )
        async with claim:
            app_doc = await repo.get_by_id(application_id, org_id)
            if not app_doc:
                raise TransitionError("Application not found.")
            from_stage = Stage(app_doc["currentStage"])
            if not is_override and not can_transition(
                from_stage, target, is_override=False
            ):
                raise TransitionError(
                    f"Invalid stage transition from '{from_stage.value}' to '{target.value}'."
                )
            if target == Stage.HIRED:
                app_status = ApplicationStatus.HIRED.value
            elif target == Stage.REJECTED:
                app_status = ApplicationStatus.REJECTED.value
            elif target == Stage.WITHDRAWN:
                app_status = ApplicationStatus.WITHDRAWN.value
            else:
                app_status = ApplicationStatus.ACTIVE.value
            if target == Stage.REJECTED and from_stage != Stage.REJECTED:
                from .hiring_workflow import prepare_rejection

                await prepare_rejection(db, org_id, app_doc, actor_user_id)
            if target == Stage.HIRED and from_stage != Stage.HIRED and not is_override:
                job = (
                    await db.jobs.find_one(
                        {"orgId": org_id, "jobId": app_doc.get("jobId")}
                    )
                    or {}
                )
                hired = {
                    row.get("applicantId") or row["applicationId"]
                    async for row in db.applications.find(
                        {
                            "orgId": org_id,
                            "jobId": app_doc.get("jobId"),
                            "currentStage": "HIRED",
                        },
                        {"applicantId": 1, "applicationId": 1},
                    )
                }
                if app_doc.get("applicantId") not in hired and len(hired) >= int(
                    job.get("positionsTotal", 1)
                ):
                    raise TransitionError("This job has no remaining positions.")
            updated = await repo.update_stage(
                application_id, target.value, app_status, org_id
            )

            if target == Stage.HIRED or from_stage == Stage.HIRED:
                job_id = app_doc.get("jobId")
                hired_ids = {
                    row.get("applicantId") or row["applicationId"]
                    async for row in db["applications"].find(
                        {"orgId": org_id, "jobId": job_id, "currentStage": "HIRED"},
                        {"applicantId": 1, "applicationId": 1},
                    )
                }
                filled = len(hired_ids)
                await db["jobs"].update_one(
                    {"orgId": org_id, "jobId": job_id},
                    {"$set": {"positionsFilled": filled}},
                )

            history = StageHistoryRepository(db)
            await history.record_transition(
                application_id=application_id,
                from_stage=from_stage.value,
                to_stage=target.value,
                actor_user_id=actor_user_id,
                reason=reason,
                is_override=is_override,
                metadata=metadata or {},
            )
            audit = AuditLogRepository(db)
            await audit.log(
                org_id=org_id,
                actor_user_id=actor_user_id,
                action="stage.override" if is_override else "stage.transition",
                resource_type="application",
                resource_id=application_id,
                details={
                    "fromStage": from_stage.value,
                    "toStage": target.value,
                    "reason": reason,
                    "isOverride": is_override,
                },
                ip_address=ip_address,
            )
            if target == Stage.REJECTED:
                from .hiring_workflow import queue_rejection

                await queue_rejection(db, await repo.get_by_id(application_id, org_id))
            return updated
