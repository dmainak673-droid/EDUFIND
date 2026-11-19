"""Add deterministic claim and citation extraction tables.

Revision ID: 20261119_03
Revises: 20261119_02
Create Date: 2026-11-19
"""
from typing import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "20261119_03"
down_revision: str | None = "20261119_02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "claims",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("document_id", sa.String(length=36), nullable=False),
        sa.Column("page_number", sa.Integer(), nullable=False),
        sa.Column("claim_text", sa.Text(), nullable=False),
        sa.Column("paragraph_context", sa.Text(), nullable=False),
        sa.Column("extraction_method", sa.String(length=32), nullable=False),
        sa.Column("confidence_score", sa.Float(), nullable=False),
        sa.Column("fingerprint", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("page_number > 0", name="ck_claims_page_number_positive"),
        sa.CheckConstraint("confidence_score >= 0 AND confidence_score <= 1", name="ck_claims_confidence_range"),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("document_id", "page_number", "fingerprint", name="uq_claims_document_page_fingerprint"),
    )
    op.create_index("ix_claims_document_page", "claims", ["document_id", "page_number"], unique=False)

    op.create_table(
        "citations",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("document_id", sa.String(length=36), nullable=False),
        sa.Column("citation_key", sa.String(length=160), nullable=True),
        sa.Column("aliases", sa.JSON(), nullable=False),
        sa.Column("raw_reference", sa.Text(), nullable=False),
        sa.Column("authors", sa.JSON(), nullable=False),
        sa.Column("publication_title", sa.String(length=1000), nullable=True),
        sa.Column("publication_year", sa.Integer(), nullable=True),
        sa.Column("doi", sa.String(length=255), nullable=True),
        sa.Column("journal", sa.String(length=500), nullable=True),
        sa.Column("reference_status", sa.String(length=24), nullable=False),
        sa.Column("reference_hash", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "reference_status IN ('BIBLIOGRAPHY', 'UNMATCHED', 'AMBIGUOUS')",
            name="ck_citations_reference_status",
        ),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("document_id", "reference_hash", name="uq_citations_document_reference_hash"),
    )
    op.create_index("ix_citations_document_id", "citations", ["document_id"], unique=False)
    op.create_index("ix_citations_doi", "citations", ["doi"], unique=False)

    op.create_table(
        "citation_mentions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("citation_id", sa.String(length=36), nullable=False),
        sa.Column("page_number", sa.Integer(), nullable=False),
        sa.Column("char_start", sa.Integer(), nullable=False),
        sa.Column("char_end", sa.Integer(), nullable=False),
        sa.Column("mention_text", sa.String(length=500), nullable=False),
        sa.CheckConstraint("page_number > 0", name="ck_citation_mentions_page_number_positive"),
        sa.CheckConstraint("char_start >= 0 AND char_end > char_start", name="ck_citation_mentions_span"),
        sa.ForeignKeyConstraint(["citation_id"], ["citations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "citation_id", "page_number", "char_start", "char_end", name="uq_citation_mentions_occurrence"
        ),
    )
    op.create_index("ix_citation_mentions_page", "citation_mentions", ["page_number"], unique=False)

    op.create_table(
        "claim_citations",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("claim_id", sa.String(length=36), nullable=False),
        sa.Column("citation_id", sa.String(length=36), nullable=False),
        sa.Column("mention_id", sa.String(length=36), nullable=False),
        sa.ForeignKeyConstraint(["claim_id"], ["claims.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["citation_id"], ["citations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["mention_id"], ["citation_mentions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("claim_id", "mention_id", name="uq_claim_citations_claim_mention"),
    )
    op.create_index("ix_claim_citations_citation", "claim_citations", ["citation_id"], unique=False)

    op.create_table(
        "extraction_runs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("document_id", sa.String(length=36), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("claims_count", sa.Integer(), nullable=False),
        sa.Column("citations_count", sa.Integer(), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("status IN ('RUNNING', 'COMPLETED', 'FAILED')", name="ck_extraction_runs_status"),
        sa.CheckConstraint("claims_count >= 0 AND citations_count >= 0", name="ck_extraction_runs_counts"),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("document_id", name="uq_extraction_runs_document"),
    )


def downgrade() -> None:
    op.drop_table("extraction_runs")
    op.drop_index("ix_claim_citations_citation", table_name="claim_citations")
    op.drop_table("claim_citations")
    op.drop_index("ix_citation_mentions_page", table_name="citation_mentions")
    op.drop_table("citation_mentions")
    op.drop_index("ix_citations_doi", table_name="citations")
    op.drop_index("ix_citations_document_id", table_name="citations")
    op.drop_table("citations")
    op.drop_index("ix_claims_document_page", table_name="claims")
    op.drop_table("claims")

