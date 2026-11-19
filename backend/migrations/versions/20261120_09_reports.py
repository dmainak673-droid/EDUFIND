"""Persist generated analysis reports."""
from typing import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "20261120_09"
down_revision: str | None = "20261120_08"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "reports",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("analysis_id", sa.String(length=36), nullable=False),
        sa.Column("filename", sa.String(length=64), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("file_size > 0", name="ck_reports_file_size_positive"),
        sa.ForeignKeyConstraint(["analysis_id"], ["analysis_runs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("filename"),
    )
    op.create_index("ix_reports_analysis_created", "reports", ["analysis_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_reports_analysis_created", table_name="reports")
    op.drop_table("reports")
