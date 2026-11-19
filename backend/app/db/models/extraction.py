from datetime import UTC, datetime
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Claim(Base):
    __tablename__ = "claims"
    __table_args__ = (
        CheckConstraint("page_number > 0", name="ck_claims_page_number_positive"),
        CheckConstraint("confidence_score >= 0 AND confidence_score <= 1", name="ck_claims_confidence_range"),
        UniqueConstraint("document_id", "page_number", "fingerprint", name="uq_claims_document_page_fingerprint"),
        Index("ix_claims_document_page", "document_id", "page_number"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    document_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False
    )
    page_number: Mapped[int] = mapped_column(Integer, nullable=False)
    claim_text: Mapped[str] = mapped_column(Text, nullable=False)
    paragraph_context: Mapped[str] = mapped_column(Text, nullable=False)
    extraction_method: Mapped[str] = mapped_column(String(32), nullable=False, default="RULE_BASED")
    confidence_score: Mapped[float] = mapped_column(nullable=False)
    fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC))

    document: Mapped["Document"] = relationship(back_populates="claims")
    citation_links: Mapped[list["ClaimCitation"]] = relationship(
        back_populates="claim", cascade="all, delete-orphan", passive_deletes=True
    )


class Citation(Base):
    __tablename__ = "citations"
    __table_args__ = (
        CheckConstraint(
            "reference_status IN ('BIBLIOGRAPHY', 'UNMATCHED', 'AMBIGUOUS')",
            name="ck_citations_reference_status",
        ),
        UniqueConstraint("document_id", "reference_hash", name="uq_citations_document_reference_hash"),
        Index("ix_citations_document_id", "document_id"),
        Index("ix_citations_doi", "doi"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    document_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False
    )
    citation_key: Mapped[str | None] = mapped_column(String(160), nullable=True)
    aliases: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    raw_reference: Mapped[str] = mapped_column(Text, nullable=False)
    authors: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    publication_title: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    publication_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    doi: Mapped[str | None] = mapped_column(String(255), nullable=True)
    journal: Mapped[str | None] = mapped_column(String(500), nullable=True)
    reference_status: Mapped[str] = mapped_column(String(24), nullable=False)
    reference_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC))

    document: Mapped["Document"] = relationship(back_populates="citations")
    mentions: Mapped[list["CitationMention"]] = relationship(
        back_populates="citation", cascade="all, delete-orphan", passive_deletes=True
    )
    claim_links: Mapped[list["ClaimCitation"]] = relationship(
        back_populates="citation", cascade="all, delete-orphan", passive_deletes=True
    )


class CitationMention(Base):
    __tablename__ = "citation_mentions"
    __table_args__ = (
        CheckConstraint("page_number > 0", name="ck_citation_mentions_page_number_positive"),
        CheckConstraint("char_start >= 0 AND char_end > char_start", name="ck_citation_mentions_span"),
        UniqueConstraint("citation_id", "page_number", "char_start", "char_end", name="uq_citation_mentions_occurrence"),
        Index("ix_citation_mentions_page", "page_number"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    citation_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("citations.id", ondelete="CASCADE"), nullable=False
    )
    page_number: Mapped[int] = mapped_column(Integer, nullable=False)
    char_start: Mapped[int] = mapped_column(Integer, nullable=False)
    char_end: Mapped[int] = mapped_column(Integer, nullable=False)
    mention_text: Mapped[str] = mapped_column(String(500), nullable=False)

    citation: Mapped[Citation] = relationship(back_populates="mentions")
    claim_links: Mapped[list["ClaimCitation"]] = relationship(back_populates="mention")


class ClaimCitation(Base):
    __tablename__ = "claim_citations"
    __table_args__ = (
        UniqueConstraint("claim_id", "mention_id", name="uq_claim_citations_claim_mention"),
        Index("ix_claim_citations_citation", "citation_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    claim_id: Mapped[str] = mapped_column(String(36), ForeignKey("claims.id", ondelete="CASCADE"), nullable=False)
    citation_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("citations.id", ondelete="CASCADE"), nullable=False
    )
    mention_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("citation_mentions.id", ondelete="CASCADE"), nullable=False
    )

    claim: Mapped[Claim] = relationship(back_populates="citation_links")
    citation: Mapped[Citation] = relationship(back_populates="claim_links")
    mention: Mapped[CitationMention] = relationship(back_populates="claim_links")


class ExtractionRun(Base):
    __tablename__ = "extraction_runs"
    __table_args__ = (
        CheckConstraint("status IN ('RUNNING', 'COMPLETED', 'FAILED')", name="ck_extraction_runs_status"),
        CheckConstraint("claims_count >= 0 AND citations_count >= 0", name="ck_extraction_runs_counts"),
        UniqueConstraint("document_id", name="uq_extraction_runs_document"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    document_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    claims_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    citations_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC), onupdate=lambda: datetime.now(UTC)
    )

    document: Mapped["Document"] = relationship(back_populates="extraction_run")

