from datetime import UTC, datetime, timedelta
from contextlib import contextmanager
from threading import Event, Thread
from uuid import UUID, uuid4

from fastapi import Depends, HTTPException
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session, sessionmaker

from app.api.deps import get_request_settings
from app.core.config import Settings, get_settings
from app.db.models.document import Document
from app.db.models.analysis import AnalysisRun
from app.db.models.extraction import ExtractionRun
from app.db.models.operation import DocumentOperationLease
from app.db.models.research import EvidenceRetrievalRun
from app.db.session import get_db
from app.db.models.verification import VerificationRun

class OperationOwnershipLost(RuntimeError):
    """The caller's lease expired or was transferred to another worker."""


def operation_lease_timeout(settings: Settings | None = None) -> timedelta:
    """Bound one provider work unit plus a fixed 60s scheduling/DB margin.

    Retrieval issues at most two sequential provider requests per citation.
    Gemini issues one bounded request per claim with its configured retries.
    The stage callbacks renew between work units; this limit protects a single
    maximum-duration provider work unit without using a guessed long timeout.
    """
    settings = settings or get_settings()
    # Retry-After is capped at three seconds per retry in ResearchHttp.
    research_retry_delays = 3.0 * settings.research_retry_attempts
    research_request = (settings.research_http_timeout_seconds *
                        (settings.research_retry_attempts + 1) + research_retry_delays)
    gemini_retry_delays = sum(min(2.0, 0.25 * (2**attempt))
                              for attempt in range(settings.gemini_retry_attempts))
    gemini_request = (settings.gemini_timeout_seconds *
                      (settings.gemini_retry_attempts + 1) + gemini_retry_delays)
    worst_work_unit = max(2 * research_request, gemini_request)
    return timedelta(seconds=worst_work_unit + 60.0)


def acquire_operation(db: Session, document_id: str, owner_id: str, operation: str,
                      settings: Settings | None = None) -> bool:
    existing = db.get(DocumentOperationLease, document_id)
    if existing is None:
        db.add(DocumentOperationLease(document_id=document_id, owner_id=owner_id, operation=operation,
                                      heartbeat_at=datetime.now(UTC)))
        try:
            db.commit()
            return True
        except IntegrityError:
            db.rollback()
        except OperationalError:
            db.rollback()
            return False
    now = datetime.now(UTC)
    cutoff = now - operation_lease_timeout(settings)
    lease = db.get(DocumentOperationLease, document_id)
    if lease is None or _aware(lease.heartbeat_at) > cutoff:
        return False
    if lease.operation == "ANALYSIS" and db.scalar(select(AnalysisRun.id).where(
            AnalysisRun.active_document_id == document_id)) is not None:
        return False
    # Claim the expired lease first. Every worker fences writes in lease-then-run
    # order, so takeover uses the same lock order and avoids transaction inversion.
    result = db.execute(update(DocumentOperationLease).where(
        DocumentOperationLease.document_id == document_id,
        DocumentOperationLease.owner_id == lease.owner_id,
        DocumentOperationLease.heartbeat_at <= cutoff,
    ).values(owner_id=owner_id, operation=operation, heartbeat_at=now).execution_options(synchronize_session=False))
    if result.rowcount != 1:
        db.rollback()
        return False
    # Recover the old run in the same transaction as ownership transfer.
    # Completed verification results are kept.
    if lease.operation == "EXTRACTION":
        db.execute(update(ExtractionRun).where(ExtractionRun.document_id == document_id,
            ExtractionRun.status == "RUNNING").values(status="FAILED",
            error_message="Extraction was interrupted and can be retried.", completed_at=now, updated_at=now))
    elif lease.operation == "EVIDENCE":
        db.execute(update(EvidenceRetrievalRun).where(EvidenceRetrievalRun.document_id == document_id,
            EvidenceRetrievalRun.status == "RUNNING").values(status="FAILED",
            error_message="Evidence retrieval was interrupted and can be retried.", completed_at=now, updated_at=now))
    elif lease.operation == "VERIFICATION":
        db.execute(update(VerificationRun).where(VerificationRun.active_document_id == document_id,
            VerificationRun.status == "RUNNING").values(status="FAILED", active_document_id=None,
            error_message="Verification was interrupted; completed claim results were preserved.",
            completed_at=now, updated_at=now))
    db.commit()
    return True


def renew_operation_in_transaction(db: Session, document_id: str, owner_id: str,
                                   settings: Settings | None = None) -> None:
    now = datetime.now(UTC)
    result = db.execute(update(DocumentOperationLease).where(
        DocumentOperationLease.document_id == document_id,
        DocumentOperationLease.owner_id == owner_id,
        DocumentOperationLease.heartbeat_at > now - operation_lease_timeout(settings),
    ).values(heartbeat_at=now).execution_options(synchronize_session=False))
    if result.rowcount != 1:
        db.rollback()
        raise OperationOwnershipLost("Document operation lease was lost or expired.")


def heartbeat_operation(db: Session, document_id: str, owner_id: str,
                        settings: Settings | None = None) -> None:
    renew_operation_in_transaction(db, document_id, owner_id, settings)
    db.commit()


@contextmanager
def monitor_operation_heartbeat(db: Session, document_id: str, owner_id: str, operation: str,
                                settings: Settings, *, analysis_id: str | None = None,
                                stage_key: str | None = None):
    """Renew a lease on a separate DB session while a provider call blocks.

    The expiry window is derived from provider timeouts/retries; this monitor
    keeps live calls fresh even when a single network call exceeds an ordinary
    heartbeat interval. Any ownership loss is surfaced when the call returns.
    """
    stop = Event()
    lost: list[BaseException] = []
    factory = sessionmaker(bind=db.get_bind(), autoflush=False, expire_on_commit=False)
    interval = min(30.0, max(0.05, operation_lease_timeout(settings).total_seconds() / 3.0))

    def run_monitor() -> None:
        while not stop.wait(interval):
            heartbeat_db = factory()
            try:
                now = datetime.now(UTC)
                cutoff = now - operation_lease_timeout(settings)
                result = heartbeat_db.execute(update(DocumentOperationLease).where(
                    DocumentOperationLease.document_id == document_id,
                    DocumentOperationLease.owner_id == owner_id,
                    DocumentOperationLease.heartbeat_at > cutoff,
                ).values(heartbeat_at=now))
                if result.rowcount != 1:
                    raise OperationOwnershipLost("Document operation lease was lost or expired.")
                if operation == "ANALYSIS":
                    analysis = heartbeat_db.execute(update(AnalysisRun).where(
                        AnalysisRun.id == analysis_id,
                        AnalysisRun.document_id == document_id,
                        AnalysisRun.execution_token == owner_id,
                        AnalysisRun.active_document_id == document_id,
                        AnalysisRun.status.in_(["QUEUED", "VALIDATING", "EXTRACTING", "EXTRACTING_CLAIMS", "RETRIEVING_EVIDENCE", "VERIFYING"]),
                    ).values(updated_at=now))
                    if analysis.rowcount != 1:
                        raise OperationOwnershipLost("Analysis execution ownership was lost.")
                    if stage_key == "EXTRACTING_CLAIMS":
                        heartbeat_db.execute(update(ExtractionRun).where(
                            ExtractionRun.document_id == document_id, ExtractionRun.status == "RUNNING",
                        ).values(updated_at=now))
                    elif stage_key == "RETRIEVING_EVIDENCE":
                        heartbeat_db.execute(update(EvidenceRetrievalRun).where(
                            EvidenceRetrievalRun.document_id == document_id, EvidenceRetrievalRun.status == "RUNNING",
                        ).values(updated_at=now))
                    elif stage_key == "VERIFYING":
                        heartbeat_db.execute(update(VerificationRun).where(
                            VerificationRun.active_document_id == document_id, VerificationRun.status == "RUNNING",
                        ).values(updated_at=now))
                if operation == "EXTRACTION":
                    heartbeat_db.execute(update(ExtractionRun).where(
                        ExtractionRun.document_id == document_id, ExtractionRun.status == "RUNNING",
                    ).values(updated_at=now))
                elif operation == "EVIDENCE":
                    heartbeat_db.execute(update(EvidenceRetrievalRun).where(
                        EvidenceRetrievalRun.document_id == document_id, EvidenceRetrievalRun.status == "RUNNING",
                    ).values(updated_at=now))
                elif operation == "VERIFICATION":
                    heartbeat_db.execute(update(VerificationRun).where(
                        VerificationRun.active_document_id == document_id, VerificationRun.status == "RUNNING",
                    ).values(updated_at=now))
                heartbeat_db.commit()
            except BaseException as exc:
                heartbeat_db.rollback()
                lost.append(exc)
                stop.set()
            finally:
                heartbeat_db.close()

    thread = Thread(target=run_monitor, name=f"edufind-lease-{operation.lower()}", daemon=True)
    thread.start()
    try:
        yield
    finally:
        stop.set()
        thread.join(timeout=max(2.0, interval + 1.0))
    if lost:
        raise OperationOwnershipLost("Operation ownership was lost during provider execution.") from lost[0]


def release_operation(db: Session, document_id: str, owner_id: str) -> None:
    db.query(DocumentOperationLease).filter(
        DocumentOperationLease.document_id == document_id,
        DocumentOperationLease.owner_id == owner_id,
    ).delete(synchronize_session=False)
    db.commit()


def operation_guard(operation: str):
    def dependency(document_id: str, db: Session = Depends(get_db),
                   settings: Settings = Depends(get_request_settings)):
        try:
            canonical_id = str(UUID(document_id))
        except (ValueError, AttributeError):
            yield None
            return
        document = db.get(Document, canonical_id)
        if document is None:
            # Route-level UUID validation retains its existing response contract.
            yield None
            return
        token = str(uuid4())
        if not acquire_operation(db, document.id, token, operation, settings):
            raise HTTPException(status_code=409, detail="Another document analysis operation is active.")
        try:
            yield token
        finally:
            release_operation(db, document.id, token)
    return dependency


def _aware(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value
