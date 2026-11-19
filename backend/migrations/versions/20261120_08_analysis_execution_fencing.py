"""Add unique execution ownership tokens to analysis runs."""
from typing import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "20261120_08"
down_revision: str | None = "20261119_07"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("analysis_runs", sa.Column("execution_token", sa.String(36), nullable=True))
    op.create_index("ix_analysis_runs_execution_token", "analysis_runs", ["execution_token"])


def downgrade() -> None:
    op.drop_index("ix_analysis_runs_execution_token", table_name="analysis_runs")
    op.drop_column("analysis_runs", "execution_token")
