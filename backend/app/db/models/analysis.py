from datetime import UTC, datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


def utcnow() -> datetime:
    return datetime.now(UTC)


class AnalysisRun(Base):
    __tablename__ = "analysis_runs"
    __table_args__ = (
        CheckConstraint("status IN ('QUEUED','VALIDATING','EXTRACTING','EXTRACTING_CLAIMS','RETRIEVING_EVIDENCE','VERIFYING','COMPLETED','COMPLETED_WITH_WARNINGS','FAILED')", name="ck_analysis_runs_status"),
        CheckConstraint("progress_percent >= 0 AND progress_percent <= 100", name="ck_analysis_runs_progress"),
        CheckConstraint("(status IN ('QUEUED','VALIDATING','EXTRACTING','EXTRACTING_CLAIMS','RETRIEVING_EVIDENCE','VERIFYING') AND active_document_id IS NOT NULL) OR (status NOT IN ('QUEUED','VALIDATING','EXTRACTING','EXTRACTING_CLAIMS','RETRIEVING_EVIDENCE','VERIFYING') AND active_document_id IS NULL)", name="ck_analysis_runs_active_key"),
        UniqueConstraint("active_document_id", name="uq_analysis_runs_active_document"),
        Index("ix_analysis_runs_document_created", "document_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    execution_token: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    document_id: Mapped[str] = mapped_column(String(36), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False)
    active_document_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("documents.id", ondelete="CASCADE"))
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    current_stage: Mapped[str | None] = mapped_column(String(32))
    progress_percent: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    warning_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    claims_detected: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    citations_identified: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    evidence_records: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    verification_results: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    verdict_counts: Mapped[dict[str, int]] = mapped_column(JSON, nullable=False, default=dict)
    verdict_details: Mapped[list[dict[str, object]]] = mapped_column(JSON, nullable=False, default=list)
    error_message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)
    stages: Mapped[list["AnalysisStageExecution"]] = relationship(back_populates="analysis", cascade="all, delete-orphan", order_by="AnalysisStageExecution.position")


class AnalysisStageExecution(Base):
    __tablename__ = "analysis_stage_executions"
    __table_args__ = (
        CheckConstraint("status IN ('PENDING','RUNNING','COMPLETED','COMPLETED_WITH_WARNINGS','FAILED','SKIPPED')", name="ck_analysis_stage_status"),
        CheckConstraint("attempts >= 0 AND position >= 0", name="ck_analysis_stage_counts"),
        UniqueConstraint("analysis_id", "stage_key", name="uq_analysis_stage_key"),
        Index("ix_analysis_stage_analysis_position", "analysis_id", "position"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    analysis_id: Mapped[str] = mapped_column(String(36), ForeignKey("analysis_runs.id", ondelete="CASCADE"), nullable=False)
    stage_key: Mapped[str] = mapped_column(String(32), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="PENDING")
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    output_run_id: Mapped[str | None] = mapped_column(String(36))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error_code: Mapped[str | None] = mapped_column(String(48))
    error_message: Mapped[str | None] = mapped_column(Text)
    analysis: Mapped[AnalysisRun] = relationship(back_populates="stages")
