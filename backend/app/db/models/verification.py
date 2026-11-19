from datetime import UTC, datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.db.models.extraction import Claim


def utcnow() -> datetime:
    return datetime.now(UTC)


class VerificationRun(Base):
    __tablename__ = "verification_runs"
    __table_args__ = (
        CheckConstraint("status IN ('RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED')", name="ck_verification_runs_status"),
        CheckConstraint("run_type IN ('CLAIM', 'DOCUMENT')", name="ck_verification_runs_type"),
        CheckConstraint("total_claims >= 0 AND processed_claims >= 0 AND failed_claims >= 0", name="ck_verification_runs_counts"),
        CheckConstraint("processed_claims <= total_claims AND failed_claims <= total_claims", name="ck_verification_runs_count_bounds"),
        CheckConstraint("(status = 'RUNNING' AND active_document_id IS NOT NULL) OR (status != 'RUNNING' AND active_document_id IS NULL)", name="ck_verification_runs_active_key"),
        UniqueConstraint("active_document_id", name="uq_verification_runs_active_document"),
        Index("ix_verification_runs_document_started", "document_id", "started_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    document_id: Mapped[str] = mapped_column(String(36), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False)
    requested_claim_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("claims.id", ondelete="SET NULL"))
    active_document_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("documents.id", ondelete="CASCADE"))
    run_type: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    total_claims: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    processed_claims: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failed_claims: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_message: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)

    results: Mapped[list["VerificationResult"]] = relationship(back_populates="run", cascade="all, delete-orphan", passive_deletes=True)


class VerificationResult(Base):
    __tablename__ = "verification_results"
    __table_args__ = (
        CheckConstraint("verdict IN ('SUPPORTED', 'CONTRADICTED', 'PARTIALLY_SUPPORTED', 'INSUFFICIENT_EVIDENCE', 'UNVERIFIABLE')", name="ck_verification_results_verdict"),
        CheckConstraint("confidence_score >= 0 AND confidence_score <= 1", name="ck_verification_results_confidence"),
        CheckConstraint("evidence_availability IN ('FULL_TEXT', 'ABSTRACT', 'METADATA_ONLY', 'NONE')", name="ck_verification_results_evidence_availability"),
        UniqueConstraint("run_id", "claim_id", name="uq_verification_results_run_claim"),
        Index("ix_verification_results_claim_verified", "claim_id", "verified_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    run_id: Mapped[str] = mapped_column(String(36), ForeignKey("verification_runs.id", ondelete="CASCADE"), nullable=False)
    claim_id: Mapped[str] = mapped_column(String(36), ForeignKey("claims.id", ondelete="CASCADE"), nullable=False)
    original_claim: Mapped[str] = mapped_column(Text, nullable=False)
    verdict: Mapped[str] = mapped_column(String(32), nullable=False)
    explanation: Mapped[str] = mapped_column(Text, nullable=False)
    confidence_score: Mapped[float] = mapped_column(nullable=False)
    evidence_availability: Mapped[str] = mapped_column(String(20), nullable=False)
    limitations: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    model_identifier: Mapped[str] = mapped_column(String(120), nullable=False)
    prompt_version: Mapped[str] = mapped_column(String(40), nullable=False)
    verified_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)

    run: Mapped[VerificationRun] = relationship(back_populates="results")
    claim: Mapped[Claim] = relationship()
    evidence_links: Mapped[list["VerificationEvidenceLink"]] = relationship(back_populates="result", cascade="all, delete-orphan", passive_deletes=True)


class VerificationEvidenceLink(Base):
    __tablename__ = "verification_evidence_links"
    __table_args__ = (
        CheckConstraint("relation IN ('DIRECT_SUPPORT', 'INDIRECT_SUPPORT', 'PARTIAL_SUPPORT', 'CONTRADICTORY', 'IRRELEVANT')", name="ck_verification_evidence_links_relation"),
        UniqueConstraint("result_id", "evidence_record_id", name="uq_verification_evidence_result_record"),
        Index("ix_verification_evidence_record", "evidence_record_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    result_id: Mapped[str] = mapped_column(String(36), ForeignKey("verification_results.id", ondelete="CASCADE"), nullable=False)
    evidence_record_id: Mapped[str] = mapped_column(String(36), ForeignKey("evidence_records.id", ondelete="CASCADE"), nullable=False)
    relation: Mapped[str] = mapped_column(String(24), nullable=False)
    excerpt: Mapped[str] = mapped_column(Text, nullable=False)
    rationale: Mapped[str] = mapped_column(Text, nullable=False)

    result: Mapped[VerificationResult] = relationship(back_populates="evidence_links")
