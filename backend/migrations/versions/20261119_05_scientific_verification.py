"""Add persisted AI scientific claim verification.

Revision ID: 20261119_05
Revises: 20261119_04
"""
from typing import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "20261119_05"
down_revision: str | None = "20261119_04"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "verification_runs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("document_id", sa.String(36), sa.ForeignKey("documents.id", ondelete="CASCADE"), nullable=False),
        sa.Column("requested_claim_id", sa.String(36), sa.ForeignKey("claims.id", ondelete="SET NULL")),
        sa.Column("active_document_id", sa.String(36), sa.ForeignKey("documents.id", ondelete="CASCADE")),
        sa.Column("run_type", sa.String(16), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("total_claims", sa.Integer(), nullable=False),
        sa.Column("processed_claims", sa.Integer(), nullable=False),
        sa.Column("failed_claims", sa.Integer(), nullable=False),
        sa.Column("error_message", sa.Text()),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("status IN ('RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED')", name="ck_verification_runs_status"),
        sa.CheckConstraint("run_type IN ('CLAIM', 'DOCUMENT')", name="ck_verification_runs_type"),
        sa.CheckConstraint("total_claims >= 0 AND processed_claims >= 0 AND failed_claims >= 0", name="ck_verification_runs_counts"),
        sa.CheckConstraint("processed_claims <= total_claims AND failed_claims <= total_claims", name="ck_verification_runs_count_bounds"),
        sa.CheckConstraint("(status = 'RUNNING' AND active_document_id IS NOT NULL) OR (status != 'RUNNING' AND active_document_id IS NULL)", name="ck_verification_runs_active_key"),
        sa.UniqueConstraint("active_document_id", name="uq_verification_runs_active_document"),
    )
    op.create_index("ix_verification_runs_document_started", "verification_runs", ["document_id", "started_at"])

    op.create_table(
        "verification_results",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("run_id", sa.String(36), sa.ForeignKey("verification_runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("claim_id", sa.String(36), sa.ForeignKey("claims.id", ondelete="CASCADE"), nullable=False),
        sa.Column("original_claim", sa.Text(), nullable=False),
        sa.Column("verdict", sa.String(32), nullable=False),
        sa.Column("explanation", sa.Text(), nullable=False),
        sa.Column("confidence_score", sa.Float(), nullable=False),
        sa.Column("evidence_availability", sa.String(20), nullable=False),
        sa.Column("limitations", sa.JSON(), nullable=False),
        sa.Column("model_identifier", sa.String(120), nullable=False),
        sa.Column("prompt_version", sa.String(40), nullable=False),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("verdict IN ('SUPPORTED', 'CONTRADICTED', 'PARTIALLY_SUPPORTED', 'INSUFFICIENT_EVIDENCE', 'UNVERIFIABLE')", name="ck_verification_results_verdict"),
        sa.CheckConstraint("confidence_score >= 0 AND confidence_score <= 1", name="ck_verification_results_confidence"),
        sa.CheckConstraint("evidence_availability IN ('FULL_TEXT', 'ABSTRACT', 'METADATA_ONLY', 'NONE')", name="ck_verification_results_evidence_availability"),
        sa.UniqueConstraint("run_id", "claim_id", name="uq_verification_results_run_claim"),
    )
    op.create_index("ix_verification_results_claim_verified", "verification_results", ["claim_id", "verified_at"])

    op.create_table(
        "verification_evidence_links",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("result_id", sa.String(36), sa.ForeignKey("verification_results.id", ondelete="CASCADE"), nullable=False),
        sa.Column("evidence_record_id", sa.String(36), sa.ForeignKey("evidence_records.id", ondelete="CASCADE"), nullable=False),
        sa.Column("relation", sa.String(24), nullable=False),
        sa.Column("excerpt", sa.Text(), nullable=False),
        sa.Column("rationale", sa.Text(), nullable=False),
        sa.CheckConstraint("relation IN ('DIRECT_SUPPORT', 'INDIRECT_SUPPORT', 'PARTIAL_SUPPORT', 'CONTRADICTORY', 'IRRELEVANT')", name="ck_verification_evidence_links_relation"),
        sa.UniqueConstraint("result_id", "evidence_record_id", name="uq_verification_evidence_result_record"),
    )
    op.create_index("ix_verification_evidence_record", "verification_evidence_links", ["evidence_record_id"])


def downgrade() -> None:
    op.drop_index("ix_verification_evidence_record", table_name="verification_evidence_links")
    op.drop_table("verification_evidence_links")
    op.drop_index("ix_verification_results_claim_verified", table_name="verification_results")
    op.drop_table("verification_results")
    op.drop_index("ix_verification_runs_document_started", table_name="verification_runs")
    op.drop_table("verification_runs")
