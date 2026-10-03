"""Pydantic schemas for resume upload batches and files (extra=forbid)."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any
from pydantic import BaseModel, ConfigDict, Field


class BatchStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    DONE = "done"
    PARTIAL = "partial"  # some files failed; failures listed per file


class FileStatus(str, Enum):
    UPLOADED = "uploaded"
    QUARANTINED = "quarantined"
    PARSED = "parsed"
    FAILED = "failed"


class ResumeFilePublic(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fileId: str
    batchId: str
    fileName: str
    mimeType: str
    sizeBytes: int
    contentHash: str
    status: str
    error: str | None = None
    # Deterministic parse output (Slice A). LLM enrichment lands in Slice B.
    rawTextChars: int = 0
    parsedJson: dict[str, Any] = Field(default_factory=dict)
    createdAt: datetime


class ResumeBatchPublic(BaseModel):
    model_config = ConfigDict(extra="forbid")

    batchId: str
    orgId: str
    jobKey: str
    fileIds: list[str]
    status: str
    counts: dict[str, int]
    failures: list[dict[str, Any]] = Field(default_factory=list)
    consent: dict[str, Any] = Field(default_factory=dict)
    createdBy: str
    createdAt: datetime
    updatedAt: datetime
