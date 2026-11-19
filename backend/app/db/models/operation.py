from datetime import UTC, datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class DocumentOperationLease(Base):
    __tablename__ = "document_operation_leases"
    __table_args__ = (
        CheckConstraint("operation IN ('ANALYSIS','EXTRACTION','EVIDENCE','VERIFICATION','DELETE')",
                        name="ck_document_operation_leases_operation"),
    )

    document_id: Mapped[str] = mapped_column(String(36), ForeignKey("documents.id", ondelete="CASCADE"), primary_key=True)
    owner_id: Mapped[str] = mapped_column(String(36), nullable=False)
    operation: Mapped[str] = mapped_column(String(32), nullable=False)
    heartbeat_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False,
                                                    default=lambda: datetime.now(UTC))
