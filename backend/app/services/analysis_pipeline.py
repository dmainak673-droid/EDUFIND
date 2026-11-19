from datetime import UTC, datetime, timedelta
from uuid import uuid4

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db.models.analysis import AnalysisRun, AnalysisStageExecution
from app.db.models.document import Document, DocumentPage
from app.db.models.extraction import Claim, Citation, CitationMention, ExtractionRun
from app.db.models.research import EvidenceRecord, EvidenceRetrievalRun, ResearchSource, SourceIdentifier
from app.db.models.verification import VerificationEvidenceLink, VerificationResult, VerificationRun
from app.services.extraction_persistence import persist_extraction
from app.services.extraction_service import extract_document_content
from app.services.storage import LocalDocumentStorage
from app.services.evidence_retrieval import retrieve_document_evidence
from app.services.verification_service import verify_document
from app.services.operation_lock import (
    OperationOwnershipLost,
    monitor_operation_heartbeat,
    operation_lease_timeout,
    release_operation,
    renew_operation_in_transaction,
)
from app.db.models.operation import DocumentOperationLease

STAGES = ("VALIDATING", "EXTRACTING", "EXTRACTING_CLAIMS", "RETRIEVING_EVIDENCE", "VERIFYING")
ACTIVE = {"QUEUED", *STAGES}
SUCCESS = {"COMPLETED", "COMPLETED_WITH_WARNINGS", "SKIPPED"}
class AnalysisBusyError(RuntimeError):
    """A Phase 3–6 operation already owns this document or analysis."""


class AnalysisExecutionLost(OperationOwnershipLost):
    """A newer analysis execution fenced this worker out."""


def assert_no_active_analysis(db: Session, document_id: str) -> None:
    if db.scalar(select(AnalysisRun.id).where(AnalysisRun.active_document_id == document_id)):
        raise AnalysisBusyError("Unified analysis is already active for this document.")


def create_analysis(db: Session, document_id: str, settings: Settings) -> tuple[AnalysisRun, bool]:
    active = db.scalar(select(AnalysisRun).where(AnalysisRun.active_document_id == document_id))
    if active:
        return active, False
    now = datetime.now(UTC)
    stale_before = now - operation_lease_timeout(settings)
    analysis_id = str(uuid4())
    execution_token = str(uuid4())
    run = AnalysisRun(id=analysis_id, document_id=document_id, active_document_id=document_id,
                      execution_token=execution_token, status="QUEUED", created_at=now, started_at=now)
    lease = db.get(DocumentOperationLease, document_id)
    if lease is None:
        db.add(DocumentOperationLease(document_id=document_id, owner_id=execution_token,
                                      operation="ANALYSIS", heartbeat_at=now))
    elif _aware(lease.heartbeat_at) <= stale_before:
        old_owner, old_operation = lease.owner_id, lease.operation
        claimed = db.execute(update(DocumentOperationLease).where(
            DocumentOperationLease.document_id == document_id,
            DocumentOperationLease.owner_id == old_owner,
            DocumentOperationLease.heartbeat_at <= stale_before,
        ).values(owner_id=execution_token, operation="ANALYSIS", heartbeat_at=now))
        if claimed.rowcount != 1:
            db.rollback()
            raise AnalysisBusyError("Another document operation owns this document.")
        if old_operation == "EXTRACTION":
            _recover_stale_dependency(db, document_id, "EXTRACTING_CLAIMS", stale_before)
        elif old_operation == "EVIDENCE":
            _recover_stale_dependency(db, document_id, "RETRIEVING_EVIDENCE", stale_before)
        elif old_operation == "VERIFICATION":
            _recover_stale_dependency(db, document_id, "VERIFYING", stale_before)
    else:
        raise AnalysisBusyError("Another document operation is already active.")

    # Legacy or lease-less active phase rows can be reclaimed only when their
    # own progress timestamp is stale; a live row rolls back the tentative lease.
    active_phase = _active_phase_run(db, document_id)
    if active_phase is not None and not _recover_or_reject_active_phase(
            db, document_id, active_phase, stale_before, now):
        db.rollback()
        raise AnalysisBusyError(f"A {active_phase} run is still active for this document.")
    run.stages = [AnalysisStageExecution(id=str(uuid4()), stage_key=key, position=index, status="PENDING")
                  for index, key in enumerate(STAGES)]
    db.add(run)
    try:
        db.commit()
    except (IntegrityError, OperationalError):
        db.rollback()
        active = db.scalar(select(AnalysisRun).where(AnalysisRun.active_document_id == document_id))
        if active:
            return active, False
        raise AnalysisBusyError("Another document operation is already active.")
    db.refresh(run)
    try:
        execute_analysis(db, run, settings, execution_token=execution_token)
    except Exception:
        db.rollback()
        release_operation(db, document_id, execution_token)
        raise
    if run.status not in ACTIVE:
        release_operation(db, document_id, execution_token)
    db.refresh(run)
    return run, True


def retry_analysis(db: Session, run: AnalysisRun, settings: Settings) -> AnalysisRun:
    now = datetime.now(UTC)
    stale_before = now - operation_lease_timeout(settings)
    was_active = run.status in ACTIVE
    stored_token = run.execution_token
    old_token = stored_token or run.id  # Previous Phase 6 rows used the analysis ID as owner.
    current = next((stage for stage in run.stages if stage.status == "RUNNING"), None)
    dependency_finished = False
    recover_dependency = False
    if was_active:
        if current is None:
            raise AnalysisBusyError("The analysis is active; retry is not available yet.")
        dependency = _dependent_run(db, run.document_id, current.stage_key, current.output_run_id,
                                    current.started_at)
        if dependency is not None and dependency.status == "RUNNING":
            if _aware(dependency.updated_at) > stale_before:
                raise AnalysisBusyError("The dependent Phase 3–5 operation is still active.")
            recover_dependency = True
        elif dependency is not None:
            dependency_finished = True
        elif _aware(run.updated_at) > stale_before:
            # A dependency may have completed after Phase 6 yielded. Refresh the
            # stage from that persisted run; otherwise this is still a live worker.
            if not _refresh_stage_from_dependency(db, run, current):
                raise AnalysisBusyError("The analysis is still active.")
            dependency_finished = True
        else:
            _recover_stale_dependency(db, run.document_id, current.stage_key, stale_before)
            current.status = "FAILED"
            current.error_code = "INTERRUPTED"
            current.error_message = "Previous execution stopped before this stage completed."
            current.completed_at = now
    elif run.status not in {"FAILED", "COMPLETED_WITH_WARNINGS"}:
        raise ValueError("Only failed or warning analyses can be retried.")

    new_token = str(uuid4())
    lease = db.get(DocumentOperationLease, run.document_id)
    if was_active:
        if lease is None:
            db.add(DocumentOperationLease(document_id=run.document_id, owner_id=new_token,
                                          operation="ANALYSIS", heartbeat_at=now))
        elif lease.owner_id != old_token or lease.operation != "ANALYSIS":
            raise AnalysisBusyError("Another document operation owns this document.")
        else:
            lease_conditions = [
                DocumentOperationLease.document_id == run.document_id,
                DocumentOperationLease.owner_id == old_token,
                DocumentOperationLease.operation == "ANALYSIS",
            ]
            if not dependency_finished:
                lease_conditions.append(DocumentOperationLease.heartbeat_at <= stale_before)
            lease_claim = update(DocumentOperationLease).where(*lease_conditions).values(
                owner_id=new_token, heartbeat_at=now)
            # A completed dependency may be fenced immediately; an active one
            # must first exceed its provider-derived lease window.
            claimed = db.execute(lease_claim)
            if claimed.rowcount != 1:
                db.rollback()
                raise AnalysisBusyError("The analysis lease is still active or owned by another worker.")
    else:
        if lease is None:
            db.add(DocumentOperationLease(document_id=run.document_id, owner_id=new_token,
                                          operation="ANALYSIS", heartbeat_at=now))
        elif lease.owner_id == old_token and lease.operation == "ANALYSIS" \
                and _aware(lease.heartbeat_at) <= stale_before:
            claimed = db.execute(update(DocumentOperationLease).where(
                DocumentOperationLease.document_id == run.document_id,
                DocumentOperationLease.owner_id == old_token,
                DocumentOperationLease.operation == "ANALYSIS",
                DocumentOperationLease.heartbeat_at <= stale_before,
            ).values(owner_id=new_token, heartbeat_at=now))
            if claimed.rowcount != 1:
                db.rollback()
                raise AnalysisBusyError("Another request owns the analysis retry.")
        else:
            raise AnalysisBusyError("Another document operation is already active.")

    # Lease first, then dependent run, then analysis row: this is the same lock
    # order used by live workers and makes stale recovery transactional.
    if recover_dependency:
        _recover_stale_dependency(db, run.document_id, current.stage_key, stale_before)

    # Compare-and-swap the run row. Only one retry can move a terminal or stale
    # active row back to QUEUED; the active_document_id unique key remains claimed.
    condition = [AnalysisRun.id == run.id]
    if was_active:
        condition.extend([AnalysisRun.active_document_id == run.document_id,
                          AnalysisRun.updated_at == run.updated_at])
        if stored_token is None:
            condition.append(AnalysisRun.execution_token.is_(None))
        else:
            condition.append(AnalysisRun.execution_token == stored_token)
        if _aware(run.updated_at) <= stale_before and current and current.status != "FAILED":
            condition.append(AnalysisRun.updated_at <= stale_before)
    else:
        condition.extend([AnalysisRun.status.in_(["FAILED", "COMPLETED_WITH_WARNINGS"]),
                          AnalysisRun.active_document_id.is_(None)])
        if stored_token is None:
            condition.append(AnalysisRun.execution_token.is_(None))
        else:
            condition.append(AnalysisRun.execution_token == stored_token)
    try:
        result = db.execute(update(AnalysisRun).where(*condition).values(
            status="QUEUED", active_document_id=run.document_id, current_stage=None,
            execution_token=new_token,
            error_message=None, retry_count=AnalysisRun.retry_count + 1,
            started_at=now, completed_at=None, updated_at=now,
        ).execution_options(synchronize_session=False))
        if result.rowcount != 1:
            db.rollback()
            raise AnalysisBusyError("Another request claimed this analysis retry.")
    except (IntegrityError, OperationalError) as exc:
        db.rollback()
        raise AnalysisBusyError("Another request owns the analysis retry.") from exc

    db.refresh(run)
    if was_active and current and current.status in SUCCESS:
        current_position = current.position + 1
        first = next((i for i, stage in enumerate(run.stages)
                      if i >= current_position and stage.status not in SUCCESS), len(STAGES))
        if first == len(STAGES):
            first = current_position
    else:
        first = next((i for i, stage in enumerate(run.stages) if stage.status not in SUCCESS), len(STAGES))
        if first == len(STAGES):
            first = next((i for i, stage in enumerate(run.stages)
                          if stage.status == "COMPLETED_WITH_WARNINGS"), STAGES.index("RETRIEVING_EVIDENCE"))
    for stage in run.stages[first:]:
        stage.status = "PENDING"
        stage.error_code = stage.error_message = None
        stage.started_at = stage.completed_at = None
    try:
        db.commit()
    except (IntegrityError, OperationalError) as exc:
        db.rollback()
        raise AnalysisBusyError("Another request claimed this analysis retry.") from exc
    db.refresh(run)
    execute_analysis(db, run, settings, start_at=first, execution_token=new_token)
    db.refresh(run)
    if run.status not in ACTIVE:
        release_operation(db, run.document_id, new_token)
    return run


def execute_analysis(db: Session, run: AnalysisRun, settings: Settings, start_at: int = 0,
                     execution_token: str | None = None) -> None:
    execution_token = execution_token or run.execution_token
    if not execution_token:
        raise AnalysisExecutionLost("Analysis execution has no ownership token.")
    for position, stage in enumerate(run.stages):
        if position < start_at and stage.status in SUCCESS:
            continue
        run.current_stage = stage.stage_key
        run.status = stage.stage_key
        stage.status = "RUNNING"
        stage.attempts += 1
        stage.started_at = datetime.now(UTC)
        stage.completed_at = None
        stage.error_code = stage.error_message = None
        _update_progress(run)
        _assert_analysis_owner(db, run.id, run.document_id, execution_token, settings)
        db.commit()
        try:
            state = _execute_stage(db, run, stage, settings)
            _assert_analysis_owner(db, run.id, run.document_id, execution_token, settings)
            stage.status = state
            if stage.stage_key == "EXTRACTING_CLAIMS":
                output = db.scalar(select(ExtractionRun).where(ExtractionRun.document_id == run.document_id))
                stage.output_run_id = stage.output_run_id or (output.id if output else None)
            elif stage.stage_key == "RETRIEVING_EVIDENCE":
                output = db.scalar(select(EvidenceRetrievalRun).where(EvidenceRetrievalRun.document_id == run.document_id))
                stage.output_run_id = stage.output_run_id or (output.id if output else None)
            elif stage.stage_key == "VERIFYING":
                output = db.scalar(select(VerificationRun).where(VerificationRun.document_id == run.document_id)
                                    .order_by(VerificationRun.started_at.desc(), VerificationRun.id.desc()))
                stage.output_run_id = stage.output_run_id or (output.id if output else None)
            if state == "RUNNING":
                stage.status = "RUNNING"
                stage.completed_at = None
                _heartbeat(db, run, settings)
                db.commit()
                return
            if state not in {"COMPLETED", "COMPLETED_WITH_WARNINGS", "FAILED", "SKIPPED"}:
                raise ValueError(f"Unsupported {stage.stage_key} result state.")
            if state == "FAILED":
                stage.error_code = "STAGE_FAILED"
                stage.error_message = "This stage could not complete; retry the analysis to resume."
                run.error_message = stage.error_message
                # Retrieval failures are non-fatal. Earlier stage failures stop the pipeline.
                if stage.stage_key != "RETRIEVING_EVIDENCE":
                    for later in run.stages[position + 1:]:
                        later.status = "SKIPPED"
                        later.completed_at = datetime.now(UTC)
                    break
        except AnalysisExecutionLost:
            db.rollback()
            raise
        except Exception as exc:
            db.rollback()
            _assert_analysis_owner(db, run.id, run.document_id, execution_token, settings)
            stage = db.get(AnalysisStageExecution, stage.id)
            run = db.get(AnalysisRun, run.id)
            if stage.stage_key == "EXTRACTING_CLAIMS":
                output = db.scalar(select(ExtractionRun).where(ExtractionRun.document_id == run.document_id))
                stage.output_run_id = output.id if output else None
            elif stage.stage_key == "RETRIEVING_EVIDENCE":
                output = db.scalar(select(EvidenceRetrievalRun).where(EvidenceRetrievalRun.document_id == run.document_id))
                stage.output_run_id = output.id if output else None
            elif stage.stage_key == "VERIFYING":
                output = db.scalar(select(VerificationRun).where(VerificationRun.document_id == run.document_id)
                                    .order_by(VerificationRun.started_at.desc(), VerificationRun.id.desc()))
                stage.output_run_id = output.id if output else None
            stage.status = "FAILED"
            stage.error_code = type(exc).__name__[:48]
            stage.error_message = _safe_error(stage.stage_key, exc)
            stage.completed_at = datetime.now(UTC)
            run.error_message = stage.error_message
            if stage.stage_key != "RETRIEVING_EVIDENCE":
                for later in run.stages[position + 1:]:
                    later.status = "SKIPPED"
                    later.completed_at = datetime.now(UTC)
                break
        stage.completed_at = stage.completed_at or datetime.now(UTC)
        _assert_analysis_owner(db, run.id, run.document_id, execution_token, settings)
        db.commit()

    _assert_analysis_owner(db, run.id, run.document_id, execution_token, settings)
    no_claims = _claim_count(db, run.document_id) == 0
    run.warning_count = sum(
        stage.status == "COMPLETED_WITH_WARNINGS" or (stage.stage_key == "RETRIEVING_EVIDENCE" and stage.status == "FAILED")
        for stage in run.stages
    ) + int(no_claims and not any(stage.status == "COMPLETED_WITH_WARNINGS" for stage in run.stages))
    if no_claims and run.stages[-1].status == "PENDING":
        run.stages[-1].status = "SKIPPED"
        run.stages[-1].completed_at = datetime.now(UTC)
    failed_required = any(s.status == "FAILED" and s.stage_key != "RETRIEVING_EVIDENCE" for s in run.stages)
    run.status = "FAILED" if failed_required else ("COMPLETED_WITH_WARNINGS" if run.warning_count else "COMPLETED")
    run.active_document_id = None
    run.current_stage = None
    run.completed_at = datetime.now(UTC)
    _snapshot_results(db, run)
    _update_progress(run)
    db.commit()


def _execute_stage(db: Session, analysis: AnalysisRun, stage: AnalysisStageExecution, settings: Settings) -> str:
    document_id, key = analysis.document_id, stage.stage_key
    document = db.get(Document, document_id)
    if document is None:
        raise LookupError("Document not found.")
    if key == "VALIDATING":
        storage = LocalDocumentStorage(settings.upload_dir)
        if not storage.document_path(document.stored_filename).is_file():
            raise FileNotFoundError("Uploaded PDF is missing from document storage.")
        count = db.scalar(select(func.count()).select_from(DocumentPage).where(DocumentPage.document_id == document_id)) or 0
        if count != document.page_count or count == 0:
            raise ValueError("Stored PDF page extraction is incomplete.")
        return "COMPLETED"
    if key == "EXTRACTING":
        if document.extraction_status == "OCR_REQUIRED":
            raise ValueError("No extractable PDF text is available; OCR is not implemented.")
        if not db.scalar(select(func.count()).select_from(DocumentPage).where(DocumentPage.document_id == document_id)):
            raise ValueError("No extracted PDF pages are available.")
        return "COMPLETED"
    if key == "EXTRACTING_CLAIMS":
        run = db.scalar(select(ExtractionRun).where(ExtractionRun.document_id == document_id))
        if run and run.status == "COMPLETED":
            return "COMPLETED"
        if run and run.status == "RUNNING":
            stage.output_run_id = run.id
            return "RUNNING"
        if run is None:
            run = ExtractionRun(id=str(uuid4()), document_id=document_id, status="RUNNING", started_at=datetime.now(UTC))
            db.add(run)
        else:
            run.status, run.error_message, run.completed_at = "RUNNING", None, None
            run.started_at = datetime.now(UTC)
        _assert_analysis_owner(db, analysis.id, document_id, analysis.execution_token, settings)
        db.commit()
        try:
            pages = db.scalars(select(DocumentPage).where(DocumentPage.document_id == document_id)
                               .order_by(DocumentPage.page_number)).all()
            db.commit()
            with monitor_operation_heartbeat(db, document_id, analysis.execution_token, "ANALYSIS", settings,
                                             analysis_id=analysis.id, stage_key="EXTRACTING_CLAIMS"):
                extraction = extract_document_content(pages, heartbeat=lambda: _heartbeat(db, analysis, settings))
            _assert_analysis_owner(db, analysis.id, document_id, analysis.execution_token, settings)
            claims, citations = persist_extraction(db, document_id, extraction)
            run.status, run.claims_count, run.citations_count = "COMPLETED", claims, citations
            run.completed_at = datetime.now(UTC)
            run.error_message = None
            _assert_analysis_owner(db, analysis.id, document_id, analysis.execution_token, settings)
            db.commit()
            return "COMPLETED_WITH_WARNINGS" if claims == 0 else "COMPLETED"
        except AnalysisExecutionLost:
            db.rollback()
            raise
        except Exception:
            db.rollback()
            _assert_analysis_owner(db, analysis.id, document_id, analysis.execution_token, settings)
            failed = db.scalar(select(ExtractionRun).where(ExtractionRun.document_id == document_id))
            if failed:
                failed.status, failed.error_message, failed.completed_at = "FAILED", "Extraction failed. The request may be retried.", datetime.now(UTC)
                db.commit()
            raise
    if key == "RETRIEVING_EVIDENCE":
        evidence_run = retrieve_document_evidence(db, document_id, settings,
                                                  heartbeat=lambda: _heartbeat(db, analysis, settings),
                                                  ownership_check=lambda: _assert_analysis_owner(
                                                      db, analysis.id, document_id, analysis.execution_token, settings),
                                                  provider_heartbeat=lambda: monitor_operation_heartbeat(
                                                      db, document_id, analysis.execution_token, "ANALYSIS", settings,
                                                      analysis_id=analysis.id, stage_key="RETRIEVING_EVIDENCE"))
        stage.output_run_id = evidence_run.id
        if evidence_run.status == "RUNNING":
            return "RUNNING"
        if evidence_run.status == "FAILED":
            return "FAILED"
        if evidence_run.status == "PARTIAL":
            return "COMPLETED_WITH_WARNINGS"
        if evidence_run.status == "COMPLETED":
            return "COMPLETED"
        raise ValueError("Evidence retrieval returned an unsupported status.")
    if key == "VERIFYING":
        if _claim_count(db, document_id) == 0:
            return "SKIPPED"
        if stage.output_run_id:
            prior = db.get(VerificationRun, stage.output_run_id)
            if prior and prior.status in {"COMPLETED", "PARTIAL"}:
                return "COMPLETED_WITH_WARNINGS" if prior.status == "PARTIAL" else "COMPLETED"
        run = verify_document(db, document_id, settings,
                              heartbeat=lambda: _heartbeat(db, analysis, settings),
                              provider_heartbeat=lambda: monitor_operation_heartbeat(
                                  db, document_id, analysis.execution_token, "ANALYSIS", settings,
                                  analysis_id=analysis.id, stage_key="VERIFYING"),
                              ownership_check=lambda: _assert_analysis_owner(
                                  db, analysis.id, document_id, analysis.execution_token, settings))
        stage.output_run_id = run.id
        if run.status == "RUNNING":
            return "RUNNING"
        if run.status == "FAILED":
            return "FAILED"
        if run.status == "PARTIAL":
            return "COMPLETED_WITH_WARNINGS"
        if run.status == "COMPLETED":
            return "COMPLETED"
        raise ValueError("Verification returned an unsupported status.")
    raise ValueError("Unknown analysis stage.")


def _claim_count(db: Session, document_id: str) -> int:
    return db.scalar(select(func.count()).select_from(Claim).where(Claim.document_id == document_id)) or 0


def _active_phase_run(db: Session, document_id: str) -> str | None:
    extraction = db.scalar(select(ExtractionRun).where(
        ExtractionRun.document_id == document_id, ExtractionRun.status == "RUNNING"))
    if extraction:
        return "claim/citation extraction"
    evidence = db.scalar(select(EvidenceRetrievalRun).where(
        EvidenceRetrievalRun.document_id == document_id, EvidenceRetrievalRun.status == "RUNNING"))
    if evidence:
        return "evidence retrieval"
    verification = db.scalar(select(VerificationRun).where(
        VerificationRun.active_document_id == document_id, VerificationRun.status == "RUNNING"))
    if verification:
        return "verification"
    return None


def _recover_or_reject_active_phase(db: Session, document_id: str, phase: str,
                                   cutoff: datetime, now: datetime) -> bool:
    if phase == "claim/citation extraction":
        query = select(ExtractionRun).where(ExtractionRun.document_id == document_id,
                                             ExtractionRun.status == "RUNNING")
        model = ExtractionRun
        values = dict(status="FAILED", error_message="Extraction was interrupted and can be retried.",
                      completed_at=now, updated_at=now)
    elif phase == "evidence retrieval":
        query = select(EvidenceRetrievalRun).where(EvidenceRetrievalRun.document_id == document_id,
                                                    EvidenceRetrievalRun.status == "RUNNING")
        model = EvidenceRetrievalRun
        values = dict(status="FAILED", error_message="Evidence retrieval was interrupted and can be retried.",
                      completed_at=now, updated_at=now)
    elif phase == "verification":
        query = select(VerificationRun).where(VerificationRun.active_document_id == document_id,
                                               VerificationRun.status == "RUNNING")
        model = VerificationRun
        values = dict(status="FAILED", active_document_id=None,
                      error_message="Verification was interrupted; completed results were preserved.",
                      completed_at=now, updated_at=now)
    else:
        return False
    dependency = db.scalar(query)
    if dependency is None or _aware(dependency.updated_at) > cutoff:
        return False
    changed = db.execute(update(model).where(
        model.id == dependency.id,
        model.status == "RUNNING",
        model.updated_at <= cutoff,
    ).values(**values).execution_options(synchronize_session=False))
    return changed.rowcount == 1


def _dependent_run(db: Session, document_id: str, stage_key: str, output_run_id: str | None,
                   stage_started_at: datetime | None = None):
    if stage_key == "EXTRACTING_CLAIMS":
        return db.get(ExtractionRun, output_run_id) if output_run_id else db.scalar(
            select(ExtractionRun).where(ExtractionRun.document_id == document_id))
    if stage_key == "RETRIEVING_EVIDENCE":
        return db.get(EvidenceRetrievalRun, output_run_id) if output_run_id else db.scalar(
            select(EvidenceRetrievalRun).where(EvidenceRetrievalRun.document_id == document_id))
    if stage_key == "VERIFYING":
        if output_run_id:
            return db.get(VerificationRun, output_run_id)
        query = select(VerificationRun).where(VerificationRun.document_id == document_id)
        if stage_started_at is not None:
            query = query.where(VerificationRun.started_at >= stage_started_at)
        return db.scalar(query.order_by(VerificationRun.started_at.desc(), VerificationRun.id.desc()))
    return None


def _recover_stale_dependency(db: Session, document_id: str, stage_key: str, cutoff: datetime) -> None:
    now = datetime.now(UTC)
    if stage_key == "EXTRACTING_CLAIMS":
        statement = update(ExtractionRun).where(
            ExtractionRun.document_id == document_id, ExtractionRun.status == "RUNNING",
            ExtractionRun.updated_at <= cutoff,
        ).values(status="FAILED", error_message="Extraction was interrupted and can be retried.",
                 completed_at=now, updated_at=now)
    elif stage_key == "RETRIEVING_EVIDENCE":
        statement = update(EvidenceRetrievalRun).where(
            EvidenceRetrievalRun.document_id == document_id, EvidenceRetrievalRun.status == "RUNNING",
            EvidenceRetrievalRun.updated_at <= cutoff,
        ).values(status="FAILED", error_message="Evidence retrieval was interrupted and can be retried.",
                 completed_at=now, updated_at=now)
    elif stage_key == "VERIFYING":
        # Conditional UPDATE is the recovery claim. Concurrent retry workers can
        # only release active_document_id once; persisted result rows are untouched.
        statement = update(VerificationRun).where(
            VerificationRun.active_document_id == document_id, VerificationRun.status == "RUNNING",
            VerificationRun.updated_at <= cutoff,
        ).values(status="FAILED", active_document_id=None,
                 error_message="Verification was interrupted; completed claim results were preserved.",
                 completed_at=now, updated_at=now)
    else:
        return
    db.execute(statement.execution_options(synchronize_session=False))


def _refresh_stage_from_dependency(db: Session, run: AnalysisRun, stage: AnalysisStageExecution) -> bool:
    dependency = _dependent_run(db, run.document_id, stage.stage_key, stage.output_run_id,
                                stage.started_at)
    if dependency is None or dependency.status == "RUNNING":
        return False
    if stage.stage_key == "EXTRACTING_CLAIMS":
        if dependency.status == "COMPLETED":
            stage.status = "COMPLETED_WITH_WARNINGS" if dependency.claims_count == 0 else "COMPLETED"
        elif dependency.status == "FAILED":
            stage.status = "FAILED"
        else:
            return False
    elif stage.stage_key == "RETRIEVING_EVIDENCE":
        stage.status = {"COMPLETED": "COMPLETED", "PARTIAL": "COMPLETED_WITH_WARNINGS",
                        "FAILED": "FAILED"}.get(dependency.status, "FAILED")
    elif stage.stage_key == "VERIFYING":
        stage.status = {"COMPLETED": "COMPLETED", "PARTIAL": "COMPLETED_WITH_WARNINGS",
                        "FAILED": "FAILED"}.get(dependency.status, "FAILED")
    else:
        return False
    stage.completed_at = dependency.completed_at or datetime.now(UTC)
    return True


def _assert_analysis_owner(db: Session, analysis_id: str, document_id: str,
                           execution_token: str | None, settings: Settings) -> None:
    if not execution_token:
        db.rollback()
        raise AnalysisExecutionLost("Analysis execution ownership was lost.")
    now = datetime.now(UTC)
    try:
        # Keep lock order consistent with lease takeover: lease, then run.
        renew_operation_in_transaction(db, document_id, execution_token, settings)
    except OperationOwnershipLost as exc:
        raise AnalysisExecutionLost(str(exc)) from exc
    claimed = db.execute(update(AnalysisRun).where(
        AnalysisRun.id == analysis_id,
        AnalysisRun.document_id == document_id,
        AnalysisRun.active_document_id == document_id,
        AnalysisRun.execution_token == execution_token,
        AnalysisRun.status.in_(ACTIVE),
    ).values(updated_at=now).execution_options(synchronize_session=False))
    if claimed.rowcount != 1:
        db.rollback()
        raise AnalysisExecutionLost("Analysis execution ownership was lost.")


def _heartbeat(db: Session, analysis: AnalysisRun, settings: Settings) -> None:
    _assert_analysis_owner(db, analysis.id, analysis.document_id, analysis.execution_token, settings)
    now = datetime.now(UTC)
    # Keep the Phase 3–5 run heartbeat fresh as well. Retry recovery examines
    # these rows independently so it can distinguish a live dependency from an
    # interrupted one after the analysis worker yields or exits.
    if analysis.current_stage == "EXTRACTING_CLAIMS":
        db.execute(update(ExtractionRun).where(
            ExtractionRun.document_id == analysis.document_id,
            ExtractionRun.status == "RUNNING",
        ).values(updated_at=now))
    elif analysis.current_stage == "RETRIEVING_EVIDENCE":
        db.execute(update(EvidenceRetrievalRun).where(
            EvidenceRetrievalRun.document_id == analysis.document_id,
            EvidenceRetrievalRun.status == "RUNNING",
        ).values(updated_at=now))
    elif analysis.current_stage == "VERIFYING":
        db.execute(update(VerificationRun).where(
            VerificationRun.active_document_id == analysis.document_id,
            VerificationRun.status == "RUNNING",
        ).values(updated_at=now))
    db.commit()


def _snapshot_results(db: Session, run: AnalysisRun) -> None:
    run.claims_detected = _claim_count(db, run.document_id)
    run.citations_identified = db.scalar(select(func.count()).select_from(Citation).where(Citation.document_id == run.document_id)) or 0
    run.evidence_records = db.scalar(select(func.count()).select_from(EvidenceRecord).join(Claim, Claim.id == EvidenceRecord.claim_id)
                                     .where(Claim.document_id == run.document_id)) or 0
    stage = next((stage for stage in run.stages if stage.stage_key == "VERIFYING"), None)
    results = db.scalars(select(VerificationResult).where(VerificationResult.run_id == stage.output_run_id)).all() if stage and stage.output_run_id else []
    run.verification_results = len(results)
    counts: dict[str, int] = {}
    for result in results:
        counts[result.verdict] = counts.get(result.verdict, 0) + 1
    run.verdict_counts = counts
    details = []
    for result in results:
        claim = db.get(Claim, result.claim_id)
        evidence_snapshots = []
        links = db.scalars(select(VerificationEvidenceLink).where(
            VerificationEvidenceLink.result_id == result.id).order_by(VerificationEvidenceLink.id)).all()
        links_by_evidence = {link.evidence_record_id: link for link in links}
        claim_evidence = db.scalars(select(EvidenceRecord).where(
            EvidenceRecord.claim_id == result.claim_id).order_by(EvidenceRecord.retrieved_at,
                                                                  EvidenceRecord.id)).all()
        for evidence in claim_evidence:
            link = links_by_evidence.get(evidence.id)
            citation = db.get(Citation, evidence.citation_id)
            mention = db.get(CitationMention, evidence.mention_id) if evidence.mention_id else None
            source = db.get(ResearchSource, evidence.source_id) if evidence.source_id else None
            identifiers = db.scalars(select(SourceIdentifier).where(
                SourceIdentifier.source_id == source.id).order_by(SourceIdentifier.provider,
                                                                    SourceIdentifier.identifier)).all() if source else []
            provider = next((item.provider for item in identifiers if item.provider in {"Crossref", "OpenAlex"}), None)
            evidence_snapshots.append({
                "evidence_id": evidence.id,
                "relation": link.relation if link else "NOT_ASSESSED",
                "excerpt": link.excerpt if link else "",
                "rationale": link.rationale if link else "Evidence record was not cited by this assessment.",
                "evidence_availability": evidence.availability,
                "citation_id": citation.id if citation else evidence.citation_id,
                "citation_title": citation.publication_title if citation else None,
                "citation_authors": citation.authors if citation else [],
                "citation_year": citation.publication_year if citation else None,
                "citation_journal": citation.journal if citation else None,
                "citation_doi": citation.doi if citation else None,
                "raw_reference": citation.raw_reference if citation else "",
                "citation_mention_page_number": mention.page_number if mention else None,
                "citation_mention_text": mention.mention_text if mention else None,
                "source_id": source.id if source else None,
                "source_title": source.title if source else None,
                "source_doi": source.doi if source else None,
                "source_provider": provider,
                "source_authors": source.authors if source else [],
                "source_journal": source.journal if source else None,
                "source_year": source.publication_year if source else None,
                "source_identifiers": [{"provider": item.provider, "identifier": item.identifier}
                                       for item in identifiers],
                "source_url": evidence.source_url,
            })
        details.append({
            "claim_id": result.claim_id,
            "original_claim": result.original_claim,
            "claim_page_number": claim.page_number if claim else None,
            "claim_context": claim.paragraph_context if claim else None,
            "verdict": result.verdict,
            "explanation": result.explanation,
            "confidence_score": result.confidence_score,
            "evidence_availability": result.evidence_availability,
            "limitations": result.limitations,
            "evidence": evidence_snapshots,
            "model_identifier": result.model_identifier,
            "prompt_version": result.prompt_version,
            "verified_at": result.verified_at.isoformat(),
        })
    run.verdict_details = details


def _update_progress(run: AnalysisRun) -> None:
    run.progress_percent = int(100 * sum(s.status in {"COMPLETED", "COMPLETED_WITH_WARNINGS"} for s in run.stages) / len(STAGES))


def _aware(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value


def _safe_error(stage: str, exc: Exception) -> str:
    if stage == "EXTRACTING":
        return "PDF text is unavailable or incomplete; OCR is not implemented."
    if stage == "VALIDATING":
        return "Document validation failed; verify the uploaded file and stored pages."
    return "This stage could not complete; retry the analysis to resume."
