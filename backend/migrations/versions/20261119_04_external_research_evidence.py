"""Add scholarly source cache, matching, and evidence retrieval.

Revision ID: 20261119_04
Revises: 20261119_03
"""
from typing import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "20261119_04"
down_revision: str | None = "20261119_03"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "research_sources",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("doi", sa.String(255), nullable=True),
        sa.Column("title", sa.String(2000)),
        sa.Column("normalized_title", sa.String(2000)),
        sa.Column("authors", sa.JSON(), nullable=False),
        sa.Column("journal", sa.String(1000)),
        sa.Column("publication_date", sa.String(40)),
        sa.Column("publication_year", sa.Integer()),
        sa.Column("publication_type", sa.String(120)),
        sa.Column("abstract", sa.Text()),
        sa.Column("metadata_status", sa.String(20), nullable=False),
        sa.Column("provider_payload", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("metadata_status IN ('METADATA', 'ABSTRACT', 'UNAVAILABLE')", name="ck_research_sources_metadata_status"),
        sa.UniqueConstraint("doi", name="uq_research_sources_doi"),
    )
    op.create_index("ix_research_sources_title", "research_sources", ["normalized_title"])
    op.create_table(
        "source_identifiers",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("source_id", sa.String(36), sa.ForeignKey("research_sources.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider", sa.String(24), nullable=False),
        sa.Column("identifier", sa.String(500), nullable=False),
        sa.UniqueConstraint("provider", "identifier", name="uq_source_identifiers_provider_identifier"),
    )
    op.create_index("ix_source_identifiers_source", "source_identifiers", ["source_id"])
    op.create_table(
        "source_matches",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("citation_id", sa.String(36), sa.ForeignKey("citations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_id", sa.String(36), sa.ForeignKey("research_sources.id", ondelete="CASCADE"), nullable=True),
        sa.Column("score", sa.Float(), nullable=False),
        sa.Column("matching_method", sa.String(100), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("score >= 0 AND score <= 1", name="ck_source_matches_score"),
        sa.CheckConstraint("status IN ('MATCHED', 'POSSIBLE', 'UNMATCHED')", name="ck_source_matches_status"),
        sa.UniqueConstraint("citation_id", "source_id", name="uq_source_matches_citation_source"),
    )
    op.create_index("ix_source_matches_citation", "source_matches", ["citation_id"])
    op.create_table(
        "evidence_retrieval_runs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("document_id", sa.String(36), sa.ForeignKey("documents.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("citations_processed", sa.Integer(), nullable=False),
        sa.Column("sources_matched", sa.Integer(), nullable=False),
        sa.Column("error_message", sa.Text()),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("status IN ('RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED')", name="ck_evidence_runs_status"),
        sa.UniqueConstraint("document_id", name="uq_evidence_runs_document"),
    )
    op.create_table(
        "evidence_records",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("claim_id", sa.String(36), sa.ForeignKey("claims.id", ondelete="CASCADE"), nullable=False),
        sa.Column("citation_id", sa.String(36), sa.ForeignKey("citations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_id", sa.String(36), sa.ForeignKey("research_sources.id", ondelete="CASCADE"), nullable=True),
        sa.Column("mention_id", sa.String(36), sa.ForeignKey("citation_mentions.id", ondelete="SET NULL"), nullable=True),
        sa.Column("availability", sa.String(20), nullable=False),
        sa.Column("retrieved_text", sa.Text()),
        sa.Column("source_url", sa.String(2000)),
        sa.Column("retrieved_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("availability IN ('METADATA_ONLY', 'ABSTRACT', 'UNAVAILABLE')", name="ck_evidence_records_availability"),
        sa.UniqueConstraint("claim_id", "citation_id", "source_id", name="uq_evidence_claim_citation_source"),
    )
    op.create_index("ix_evidence_records_claim", "evidence_records", ["claim_id"])
    op.create_index("ix_evidence_records_citation", "evidence_records", ["citation_id"])


def downgrade() -> None:
    op.drop_index("ix_evidence_records_citation", table_name="evidence_records")
    op.drop_index("ix_evidence_records_claim", table_name="evidence_records")
    op.drop_table("evidence_records")
    op.drop_table("evidence_retrieval_runs")
    op.drop_index("ix_source_matches_citation", table_name="source_matches")
    op.drop_table("source_matches")
    op.drop_index("ix_source_identifiers_source", table_name="source_identifiers")
    op.drop_table("source_identifiers")
    op.drop_index("ix_research_sources_title", table_name="research_sources")
    op.drop_table("research_sources")
