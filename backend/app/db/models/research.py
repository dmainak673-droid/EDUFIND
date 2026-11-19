from datetime import UTC, datetime
from typing import Any

from sqlalchemy import CheckConstraint, DateTime, Float, ForeignKey, Index, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.db.models.extraction import Citation, CitationMention, Claim


def utcnow() -> datetime:
    return datetime.now(UTC)


class ResearchSource(Base):
    __tablename__ = "research_sources"
    __table_args__ = (
        CheckConstraint("metadata_status IN ('METADATA', 'ABSTRACT', 'UNAVAILABLE')", name="ck_research_sources_metadata_status"),
        Index("ix_research_sources_title", "normalized_title"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    doi: Mapped[str | None] = mapped_column(String(255), unique=True)
    title: Mapped[str | None] = mapped_column(String(2000))
    normalized_title: Mapped[str | None] = mapped_column(String(2000))
    authors: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False, default=list)
    journal: Mapped[str | None] = mapped_column(String(1000))
    publication_date: Mapped[str | None] = mapped_column(String(40))
    publication_year: Mapped[int | None] = mapped_column(Integer)
    publication_type: Mapped[str | None] = mapped_column(String(120))
    abstract: Mapped[str | None] = mapped_column(Text)
    metadata_status: Mapped[str] = mapped_column(String(20), nullable=False)
    provider_payload: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)

    identifiers: Mapped[list["SourceIdentifier"]] = relationship(back_populates="source", cascade="all, delete-orphan", passive_deletes=True)
    matches: Mapped[list["SourceMatch"]] = relationship(back_populates="source", cascade="all, delete-orphan", passive_deletes=True)
    evidence_records: Mapped[list["EvidenceRecord"]] = relationship(back_populates="source", cascade="all, delete-orphan", passive_deletes=True)


class SourceIdentifier(Base):
    __tablename__ = "source_identifiers"
    __table_args__ = (UniqueConstraint("provider", "identifier", name="uq_source_identifiers_provider_identifier"), Index("ix_source_identifiers_source", "source_id"))

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source_id: Mapped[str] = mapped_column(String(36), ForeignKey("research_sources.id", ondelete="CASCADE"), nullable=False)
    provider: Mapped[str] = mapped_column(String(24), nullable=False)
    identifier: Mapped[str] = mapped_column(String(500), nullable=False)
    source: Mapped[ResearchSource] = relationship(back_populates="identifiers")


class SourceMatch(Base):
    __tablename__ = "source_matches"
    __table_args__ = (
        CheckConstraint("score >= 0 AND score <= 1", name="ck_source_matches_score"),
        CheckConstraint("status IN ('MATCHED', 'POSSIBLE', 'UNMATCHED')", name="ck_source_matches_status"),
        UniqueConstraint("citation_id", "source_id", name="uq_source_matches_citation_source"),
        Index("ix_source_matches_citation", "citation_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    citation_id: Mapped[str] = mapped_column(String(36), ForeignKey("citations.id", ondelete="CASCADE"), nullable=False)
    source_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("research_sources.id", ondelete="CASCADE"), nullable=True)
    score: Mapped[float] = mapped_column(Float, nullable=False)
    matching_method: Mapped[str] = mapped_column(String(100), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    source: Mapped[ResearchSource | None] = relationship(back_populates="matches")


class EvidenceRetrievalRun(Base):
    __tablename__ = "evidence_retrieval_runs"
    __table_args__ = (
        CheckConstraint("status IN ('RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED')", name="ck_evidence_runs_status"),
        UniqueConstraint("document_id", name="uq_evidence_runs_document"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    document_id: Mapped[str] = mapped_column(String(36), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    citations_processed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    sources_matched: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_message: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)


class EvidenceRecord(Base):
    __tablename__ = "evidence_records"
    __table_args__ = (
        CheckConstraint("availability IN ('METADATA_ONLY', 'ABSTRACT', 'UNAVAILABLE')", name="ck_evidence_records_availability"),
        UniqueConstraint("claim_id", "citation_id", "source_id", name="uq_evidence_claim_citation_source"),
        Index("ix_evidence_records_claim", "claim_id"),
        Index("ix_evidence_records_citation", "citation_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    claim_id: Mapped[str] = mapped_column(String(36), ForeignKey("claims.id", ondelete="CASCADE"), nullable=False)
    citation_id: Mapped[str] = mapped_column(String(36), ForeignKey("citations.id", ondelete="CASCADE"), nullable=False)
    source_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("research_sources.id", ondelete="CASCADE"), nullable=True)
    mention_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("citation_mentions.id", ondelete="SET NULL"), nullable=True)
    availability: Mapped[str] = mapped_column(String(20), nullable=False)
    retrieved_text: Mapped[str | None] = mapped_column(Text)
    source_url: Mapped[str | None] = mapped_column(String(2000))
    retrieved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    claim: Mapped[Claim] = relationship()
    citation: Mapped[Citation] = relationship()
    source: Mapped[ResearchSource | None] = relationship(back_populates="evidence_records")
