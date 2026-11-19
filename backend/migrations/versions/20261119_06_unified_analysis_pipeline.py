"""Add persisted unified scientific analysis orchestration."""
from typing import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "20261119_06"
down_revision: str | None = "20261119_05"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "analysis_runs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("document_id", sa.String(36), sa.ForeignKey("documents.id", ondelete="CASCADE"), nullable=False),
        sa.Column("active_document_id", sa.String(36), sa.ForeignKey("documents.id", ondelete="CASCADE")),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("current_stage", sa.String(32)),
        sa.Column("progress_percent", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("retry_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("warning_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("claims_detected", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("citations_identified", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("evidence_records", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("verification_results", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("verdict_counts", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("verdict_details", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("error_message", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("status IN ('QUEUED','VALIDATING','EXTRACTING','EXTRACTING_CLAIMS','RETRIEVING_EVIDENCE','VERIFYING','COMPLETED','COMPLETED_WITH_WARNINGS','FAILED')", name="ck_analysis_runs_status"),
        sa.CheckConstraint("progress_percent >= 0 AND progress_percent <= 100", name="ck_analysis_runs_progress"),
        sa.CheckConstraint("(status IN ('QUEUED','VALIDATING','EXTRACTING','EXTRACTING_CLAIMS','RETRIEVING_EVIDENCE','VERIFYING') AND active_document_id IS NOT NULL) OR (status NOT IN ('QUEUED','VALIDATING','EXTRACTING','EXTRACTING_CLAIMS','RETRIEVING_EVIDENCE','VERIFYING') AND active_document_id IS NULL)", name="ck_analysis_runs_active_key"),
        sa.UniqueConstraint("active_document_id", name="uq_analysis_runs_active_document"),
    )
    op.create_index("ix_analysis_runs_document_created", "analysis_runs", ["document_id", "created_at"])
    op.create_table(
        "analysis_stage_executions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("analysis_id", sa.String(36), sa.ForeignKey("analysis_runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("stage_key", sa.String(32), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("output_run_id", sa.String(36)),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.Column("error_code", sa.String(48)),
        sa.Column("error_message", sa.Text()),
        sa.CheckConstraint("status IN ('PENDING','RUNNING','COMPLETED','COMPLETED_WITH_WARNINGS','FAILED','SKIPPED')", name="ck_analysis_stage_status"),
        sa.CheckConstraint("attempts >= 0 AND position >= 0", name="ck_analysis_stage_counts"),
        sa.UniqueConstraint("analysis_id", "stage_key", name="uq_analysis_stage_key"),
    )
    op.create_index("ix_analysis_stage_analysis_position", "analysis_stage_executions", ["analysis_id", "position"])


def downgrade() -> None:
    op.drop_index("ix_analysis_stage_analysis_position", table_name="analysis_stage_executions")
    op.drop_table("analysis_stage_executions")
    op.drop_index("ix_analysis_runs_document_created", table_name="analysis_runs")
    op.drop_table("analysis_runs")
