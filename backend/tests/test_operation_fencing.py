from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Barrier, Event
from time import sleep
from uuid import uuid4

import pytest
from sqlalchemy import func, select, update

from app.core.config import Settings
from app.db.models.analysis import AnalysisRun, AnalysisStageExecution
from app.db.models.document import Document, DocumentPage
from app.db.models.extraction import Citation, Claim, ExtractionRun
from app.db.models.operation import DocumentOperationLease
from app.db.models.research import EvidenceRetrievalRun
from app.db.models.verification import VerificationResult, VerificationRun
from app.services.analysis_pipeline import (
    AnalysisBusyError,
    AnalysisExecutionLost,
    STAGES,
    _assert_analysis_owner,
    retry_analysis,
)
from app.services.operation_lock import (
    OperationOwnershipLost,
    acquire_operation,
    heartbeat_operation,
    operation_lease_timeout,
    release_operation,
)
import app.services.analysis_pipeline as pipeline
import app.services.operation_lock as operation_lock
import app.api.routes.extraction as extraction_routes
import app.api.routes.evidence as evidence_routes
import app.api.routes.verification as verification_routes


def _seed_document(api, *, citation=False):
    document_id, claim_id = str(uuid4()), str(uuid4())
    stored_filename = f"{uuid4()}.pdf"
    Path(api.settings.upload_dir, stored_filename).write_bytes(b"%PDF-1.7 fixture")
    with api.session_factory() as db:
        db.add(Document(id=document_id, original_filename="fixture.pdf", stored_filename=stored_filename,
            title="Fixture", authors=[], pdf_metadata={}, file_size=16, mime_type="application/pdf",
            page_count=1, extraction_status="EXTRACTED"))
        db.add(DocumentPage(document_id=document_id, page_number=1, extracted_text="A measured result."))
        db.add(Claim(id=claim_id, document_id=document_id, page_number=1, claim_text="A measured result.",
            paragraph_context="A measured result.", extraction_method="RULE_BASED", confidence_score=.8,
            fingerprint="c" * 64))
        db.add(ExtractionRun(id=str(uuid4()), document_id=document_id, status="COMPLETED",
                             claims_count=1, citations_count=int(citation)))
        if citation:
            db.add(Citation(id=str(uuid4()), document_id=document_id, citation_key="Ref", aliases=["Ref"],
                raw_reference="Author. Study.", authors=["Author"], publication_title="Study",
                publication_year=2024, doi="10.1234/test", journal="Journal",
                reference_status="BIBLIOGRAPHY", reference_hash="d" * 64))
        db.commit()
    return document_id, claim_id


def _seed_stale_analysis(api, document_id, *, token=None):
    old = datetime.now(UTC) - timedelta(hours=1)
    analysis_id = str(uuid4())
    token = token or str(uuid4())
    with api.session_factory() as db:
        run = AnalysisRun(id=analysis_id, document_id=document_id, active_document_id=document_id,
            execution_token=token, status="VALIDATING", current_stage="VALIDATING",
            created_at=old, started_at=old, updated_at=old)
        run.stages = [AnalysisStageExecution(id=str(uuid4()), stage_key=key, position=index,
            status=("RUNNING" if index == 0 else "PENDING"), attempts=1 if index == 0 else 0,
            started_at=old if index == 0 else None) for index, key in enumerate(STAGES)]
        db.add(run)
        db.add(DocumentOperationLease(document_id=document_id, owner_id=token,
            operation="ANALYSIS", heartbeat_at=old))
        db.commit()
    return analysis_id, token


def test_retry_fences_old_analysis_worker_and_finalizer(api, monkeypatch):
    document_id, _ = _seed_document(api)
    analysis_id, old_token = _seed_stale_analysis(api, document_id)
    entered, resume = Event(), Event()

    def blocked_stage(db, analysis, stage, settings):
        entered.set()
        assert resume.wait(5)
        return "FAILED"

    monkeypatch.setattr(pipeline, "_execute_stage", blocked_stage)
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(lambda: _retry_in_session(api, analysis_id))
        assert entered.wait(5)
        with api.session_factory() as db:
            current = db.get(AnalysisRun, analysis_id)
            assert current.execution_token != old_token
            new_token = current.execution_token
            with pytest.raises(AnalysisExecutionLost):
                _assert_analysis_owner(db, analysis_id, document_id, old_token, api.settings)
            with pytest.raises(AnalysisExecutionLost):
                pipeline.execute_analysis(db, current, api.settings, execution_token=old_token)
            # An old execution cannot remove a replacement's lease.
            release_operation(db, document_id, old_token)
            lease = db.get(DocumentOperationLease, document_id)
            assert lease.owner_id == new_token
        resume.set()
        assert future.result(timeout=10).status == "FAILED"

    with api.session_factory() as db:
        final = db.get(AnalysisRun, analysis_id)
        assert final.execution_token != old_token
        assert final.status == "FAILED"


def _retry_in_session(api, analysis_id):
    with api.session_factory() as db:
        run = db.get(AnalysisRun, analysis_id)
        return retry_analysis(db, run, api.settings)


def test_two_simultaneous_terminal_retries_have_one_owner(api, monkeypatch):
    document_id, _ = _seed_document(api)
    analysis_id = str(uuid4())
    with api.session_factory() as db:
        run = AnalysisRun(id=analysis_id, document_id=document_id, status="FAILED",
            created_at=datetime.now(UTC), completed_at=datetime.now(UTC))
        run.stages = [AnalysisStageExecution(id=str(uuid4()), stage_key=key, position=i, status="PENDING")
                      for i, key in enumerate(STAGES)]
        db.add(run)
        db.commit()

    ready, resume = Barrier(2), Event()
    entered = Event()

    def blocking_stage(db, analysis, stage, settings):
        entered.set()
        assert resume.wait(5)
        return "FAILED"

    monkeypatch.setattr(pipeline, "_execute_stage", blocking_stage)

    def compete():
        with api.session_factory() as db:
            loaded = db.get(AnalysisRun, analysis_id)
            ready.wait(5)
            try:
                return retry_analysis(db, loaded, api.settings).status
            except AnalysisBusyError:
                return "BUSY"

    with ThreadPoolExecutor(max_workers=2) as pool:
        first, second = pool.submit(compete), pool.submit(compete)
        assert entered.wait(5)
        # The loser must return without waiting for the stage owner.
        completed, _ = wait((first, second), timeout=5, return_when=FIRST_COMPLETED)
        assert completed
        assert next(iter(completed)).result(timeout=1) == "BUSY"
        resume.set()
        outcomes = [first.result(timeout=10), second.result(timeout=10)]
    assert outcomes.count("BUSY") == 1
    assert sum(value != "BUSY" for value in outcomes) == 1


def test_claim_verification_uses_a_unique_owner_token(api, monkeypatch):
    document_id, claim_id = _seed_document(api)
    tokens = []
    original_acquire = verification_routes.acquire_operation

    def capture(db, doc_id, owner, operation, settings=None):
        tokens.append(owner)
        return original_acquire(db, doc_id, owner, operation, settings)

    def completed_verification(db, claim_id, settings, **kwargs):
        claim = db.get(Claim, claim_id)
        now = datetime.now(UTC)
        run = VerificationRun(id=str(uuid4()), document_id=claim.document_id, run_type="CLAIM",
            requested_claim_id=claim.id, status="COMPLETED", total_claims=1, processed_claims=1,
            failed_claims=0, started_at=now, completed_at=now)
        db.add(run)
        db.commit()
        return run

    monkeypatch.setattr(verification_routes, "acquire_operation", capture)
    monkeypatch.setattr(verification_routes, "verify_claim", completed_verification)
    assert api.client.post(f"/api/claims/{claim_id}/verify").status_code == 200
    assert api.client.post(f"/api/claims/{claim_id}/verify").status_code == 200
    assert len(tokens) == 2 and tokens[0] != tokens[1]
    assert all(token != document_id for token in tokens)


def test_expired_lease_takeover_and_old_owner_cannot_renew_or_release(api):
    document_id, _ = _seed_document(api)
    old_token, new_token = str(uuid4()), str(uuid4())
    stale = datetime.now(UTC) - operation_lease_timeout(api.settings) - timedelta(seconds=1)
    with api.session_factory() as db:
        extraction_run = db.scalar(select(ExtractionRun).where(
            ExtractionRun.document_id == document_id
        ))
        assert extraction_run is not None
        extraction_run.status = "RUNNING"
        extraction_run.updated_at = stale
        db.add(DocumentOperationLease(document_id=document_id, owner_id=old_token,
            operation="EXTRACTION", heartbeat_at=stale))
        db.commit()
        assert acquire_operation(db, document_id, new_token, "EXTRACTION", api.settings)
        with pytest.raises(OperationOwnershipLost):
            heartbeat_operation(db, document_id, old_token, api.settings)
        release_operation(db, document_id, old_token)
        assert db.get(DocumentOperationLease, document_id).owner_id == new_token
        assert db.scalar(select(ExtractionRun).where(ExtractionRun.document_id == document_id)).status == "FAILED"


def test_terminal_analysis_crash_left_lease_can_be_reclaimed(api, monkeypatch):
    from types import SimpleNamespace

    document_id, _ = _seed_document(api)
    old_token = str(uuid4())
    stale = datetime.now(UTC) - operation_lease_timeout(api.settings) - timedelta(seconds=1)
    with api.session_factory() as db:
        db.add(AnalysisRun(id=str(uuid4()), document_id=document_id, execution_token=old_token,
            status="COMPLETED", progress_percent=100, created_at=stale, completed_at=stale,
            updated_at=stale))
        db.add(DocumentOperationLease(document_id=document_id, owner_id=old_token,
            operation="ANALYSIS", heartbeat_at=stale))
        db.commit()

    def complete_retrieval(db, doc_id, settings, **kwargs):
        run = EvidenceRetrievalRun(id=str(uuid4()), document_id=doc_id, status="COMPLETED",
            citations_processed=0, sources_matched=0, started_at=datetime.now(UTC),
            completed_at=datetime.now(UTC))
        db.add(run)
        db.commit()
        return run

    monkeypatch.setattr(pipeline, "retrieve_document_evidence", complete_retrieval)
    monkeypatch.setattr(pipeline, "verify_document", lambda db, doc_id, settings, **kwargs:
                        SimpleNamespace(id=str(uuid4()), status="COMPLETED"))
    response = api.client.post(f"/api/documents/{document_id}/analyze")
    assert response.status_code == 200
    assert response.json()["analysisId"]


def test_current_lease_renews_and_provider_monitor_survives_old_threshold(api, monkeypatch):
    from app.services import operation_lock as lock_module

    max_settings = Settings(_env_file=None, gemini_timeout_seconds=180, gemini_retry_attempts=3,
        research_http_timeout_seconds=60, research_retry_attempts=5)
    assert operation_lease_timeout(max_settings) > timedelta(minutes=10)
    document_id, _ = _seed_document(api)
    token = str(uuid4())
    with api.session_factory() as db:
        assert acquire_operation(db, document_id, token, "VERIFICATION", api.settings)
        old_threshold = timedelta(milliseconds=150)
        monkeypatch.setattr(lock_module, "operation_lease_timeout", lambda settings=None: old_threshold)
        with lock_module.monitor_operation_heartbeat(db, document_id, token, "VERIFICATION", api.settings):
            sleep(.45)
        heartbeat_operation(db, document_id, token, api.settings)
        assert db.get(DocumentOperationLease, document_id).owner_id == token


def test_late_extraction_worker_cannot_fail_replacement_run(api, monkeypatch):
    document_id, _ = _seed_document(api)
    replacement = str(uuid4())
    with api.session_factory() as db:
        run = db.scalar(select(ExtractionRun).where(ExtractionRun.document_id == document_id))
        run.status = "FAILED"
        db.commit()

    def stale_extraction(pages, heartbeat=None):
        with api.session_factory() as rival:
            lease = rival.get(DocumentOperationLease, document_id)
            stale = datetime.now(UTC) - operation_lease_timeout(api.settings) - timedelta(seconds=1)
            rival.execute(update(DocumentOperationLease).where(
                DocumentOperationLease.document_id == document_id).values(heartbeat_at=stale))
            rival.commit()
            assert acquire_operation(rival, document_id, replacement, "EXTRACTION", api.settings)
            run = rival.scalar(select(ExtractionRun).where(ExtractionRun.document_id == document_id))
            run.status = "RUNNING"
            rival.commit()
            assert lease.owner_id != replacement
        heartbeat()

    monkeypatch.setattr(extraction_routes, "extract_document_content", stale_extraction)
    response = api.client.post(f"/api/documents/{document_id}/extract")
    assert response.status_code == 409
    with api.session_factory() as db:
        assert db.get(DocumentOperationLease, document_id).owner_id == replacement
        assert db.scalar(select(ExtractionRun).where(ExtractionRun.document_id == document_id)).status == "RUNNING"


def test_late_retrieval_worker_and_exception_cannot_fail_replacement_run(api, monkeypatch):
    document_id, _ = _seed_document(api, citation=True)
    replacement = str(uuid4())
    with api.session_factory() as db:
        db.add(EvidenceRetrievalRun(id=str(uuid4()), document_id=document_id, status="FAILED",
            citations_processed=0, sources_matched=0, started_at=datetime.now(UTC)))
        db.commit()

    def stale_retrieval(db, doc_id, settings, **kwargs):
        db.commit()
        with api.session_factory() as rival:
            stale = datetime.now(UTC) - operation_lease_timeout(api.settings) - timedelta(seconds=1)
            rival.execute(update(DocumentOperationLease).where(
                DocumentOperationLease.document_id == document_id).values(heartbeat_at=stale))
            rival.commit()
            assert acquire_operation(rival, document_id, replacement, "EVIDENCE", api.settings)
            run = rival.scalar(select(EvidenceRetrievalRun).where(EvidenceRetrievalRun.document_id == document_id))
            run.status = "RUNNING"
            rival.commit()
        # Simulate the old worker's exception path after it discovers takeover.
        kwargs["ownership_check"]()
        raise RuntimeError("late worker should not reach this point")

    monkeypatch.setattr(evidence_routes, "retrieve_document_evidence", stale_retrieval)
    response = api.client.post(f"/api/documents/{document_id}/retrieve-evidence")
    assert response.status_code == 409
    with api.session_factory() as db:
        assert db.get(DocumentOperationLease, document_id).owner_id == replacement
        assert db.scalar(select(EvidenceRetrievalRun).where(
            EvidenceRetrievalRun.document_id == document_id)).status == "RUNNING"


def test_phase4_service_stops_before_mutating_after_lease_transfer(api):
    from app.services import evidence_retrieval

    document_id, _ = _seed_document(api, citation=True)
    old_token, new_token = str(uuid4()), str(uuid4())
    now = datetime.now(UTC)
    with api.session_factory() as db:
        db.add(EvidenceRetrievalRun(id=str(uuid4()), document_id=document_id, status="FAILED",
            citations_processed=0, sources_matched=0, started_at=now))
        db.add(DocumentOperationLease(document_id=document_id, owner_id=old_token,
            operation="EVIDENCE", heartbeat_at=now))
        db.commit()

    checks = 0
    with api.session_factory() as db:
        def check_owner():
            nonlocal checks
            checks += 1
            if checks == 1:
                operation_lock.renew_operation_in_transaction(db, document_id, old_token, api.settings)
                return
            stale = datetime.now(UTC) - operation_lease_timeout(api.settings) - timedelta(seconds=1)
            db.execute(update(DocumentOperationLease).where(
                DocumentOperationLease.document_id == document_id).values(heartbeat_at=stale))
            db.commit()
            assert acquire_operation(db, document_id, new_token, "EVIDENCE", api.settings)
            replacement = db.scalar(select(EvidenceRetrievalRun).where(
                EvidenceRetrievalRun.document_id == document_id))
            replacement.status = "RUNNING"
            db.commit()
            operation_lock.renew_operation_in_transaction(db, document_id, old_token, api.settings)

        class UnusedHttp:
            def close(self):
                pass

        with pytest.raises(OperationOwnershipLost):
            evidence_retrieval.retrieve_document_evidence(db, document_id, api.settings,
                http=UnusedHttp(), ownership_check=check_owner)
        assert checks == 2
        assert db.get(DocumentOperationLease, document_id).owner_id == new_token
        assert db.scalar(select(EvidenceRetrievalRun).where(
            EvidenceRetrievalRun.document_id == document_id)).status == "RUNNING"


def test_stale_verification_worker_cannot_commit_result_after_recovery(api, monkeypatch):
    from app.services import verification_service

    document_id, claim_id = _seed_document(api)
    entered, resume = Event(), Event()

    class BlockingProvider:
        def assess(self, payload):
            entered.set()
            assert resume.wait(5)
            return object()

    def validated(claim, run_id, model, assessment, records, record_map, all_records, omitted):
        result = VerificationResult(id=str(uuid4()), run_id=run_id, claim_id=claim.id,
            original_claim=claim.claim_text, verdict="SUPPORTED", explanation="test",
            confidence_score=.8, evidence_availability="ABSTRACT", limitations=[],
            model_identifier="mock", prompt_version="test", verified_at=datetime.now(UTC))
        return result, []

    monkeypatch.setattr(verification_service, "_validated_result", validated)
    with api.session_factory() as db:
        claim = db.get(Claim, claim_id)
        # Citation is needed to satisfy the evidence record's FK.
        citation = Citation(id=str(uuid4()), document_id=document_id, citation_key="R", aliases=["R"],
            raw_reference="Ref", authors=[], publication_title="Ref", publication_year=2020,
            doi=None, journal=None, reference_status="BIBLIOGRAPHY", reference_hash="e" * 64)
        db.add(citation)
        db.flush()
        from app.db.models.research import EvidenceRecord
        db.add(EvidenceRecord(id=str(uuid4()), claim_id=claim.id, citation_id=citation.id,
            availability="ABSTRACT", retrieved_text="Supporting text", retrieved_at=datetime.now(UTC)))
        db.commit()

    def worker():
        with api.session_factory() as db:
            from app.services.verification_service import verify_document
            return verify_document(db, document_id, api.settings, provider=BlockingProvider())

    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(worker)
        assert entered.wait(5)
        with api.session_factory() as db:
            run = db.scalar(select(VerificationRun).where(
                VerificationRun.document_id == document_id, VerificationRun.status == "RUNNING"))
            db.execute(update(VerificationRun).where(VerificationRun.id == run.id).values(
                status="FAILED", active_document_id=None, error_message="recovered",
                completed_at=datetime.now(UTC)))
            db.commit()
            run_id = run.id
        resume.set()
        from app.services.verification_service import VerificationOwnershipLost
        with pytest.raises(VerificationOwnershipLost):
            future.result(timeout=10)
    with api.session_factory() as db:
        assert db.get(VerificationRun, run_id).status == "FAILED"
        assert db.scalar(select(func.count()).select_from(VerificationResult).where(
            VerificationResult.run_id == run_id)) == 0
