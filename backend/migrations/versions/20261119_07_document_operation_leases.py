"""Add cross-phase document operation leases."""
from typing import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "20261119_07"
down_revision: str | None = "20261119_06"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "document_operation_leases",
        sa.Column("document_id", sa.String(36), sa.ForeignKey("documents.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("owner_id", sa.String(36), nullable=False),
        sa.Column("operation", sa.String(32), nullable=False),
        sa.Column("heartbeat_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("operation IN ('ANALYSIS','EXTRACTION','EVIDENCE','VERIFICATION','DELETE')",
                           name="ck_document_operation_leases_operation"),
    )


def downgrade() -> None:
    op.drop_table("document_operation_leases")
