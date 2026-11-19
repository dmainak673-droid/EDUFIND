"""Add document and page-level extraction tables.

Revision ID: 20261119_02
Revises:
Create Date: 2026-11-19
"""
from typing import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "20261119_02"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "documents",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("original_filename", sa.String(length=255), nullable=False),
        sa.Column("stored_filename", sa.String(length=40), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("authors", sa.JSON(), nullable=False),
        sa.Column("pdf_metadata", sa.JSON(), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=False),
        sa.Column("mime_type", sa.String(length=100), nullable=False),
        sa.Column("page_count", sa.Integer(), nullable=False),
        sa.Column("extraction_status", sa.String(length=24), nullable=False),
        sa.Column("extraction_warning", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("file_size > 0", name="ck_documents_file_size_positive"),
        sa.CheckConstraint("page_count >= 0", name="ck_documents_page_count_nonnegative"),
        sa.CheckConstraint(
            "extraction_status IN ('EXTRACTED', 'PARTIAL', 'OCR_REQUIRED')",
            name="ck_documents_extraction_status",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("stored_filename"),
    )
    op.create_index("ix_documents_created_at", "documents", ["created_at"], unique=False)
    op.create_table(
        "document_pages",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("document_id", sa.String(length=36), nullable=False),
        sa.Column("page_number", sa.Integer(), nullable=False),
        sa.Column("extracted_text", sa.Text(), nullable=False),
        sa.CheckConstraint("page_number > 0", name="ck_document_pages_page_number_positive"),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("document_id", "page_number", name="uq_document_pages_document_page"),
    )
    op.create_index("ix_document_pages_document_id", "document_pages", ["document_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_document_pages_document_id", table_name="document_pages")
    op.drop_table("document_pages")
    op.drop_index("ix_documents_created_at", table_name="documents")
    op.drop_table("documents")

