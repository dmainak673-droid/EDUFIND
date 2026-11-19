from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Event
from types import SimpleNamespace
from uuid import uuid4

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, func, inspect, select, update
import pytest

import app.services.analysis_pipeline as pipeline
from app.db.models.analysis import AnalysisRun, AnalysisStageExecution
from app.db.models.document import Document, DocumentPage
from app.db.models.extraction import Claim, Citation, CitationMention, ExtractionRun
from app.db.models.operation import DocumentOperationLease
from app.db.models.research import EvidenceRecord, EvidenceRetrievalRun, ResearchSource, SourceIdentifier
from app.db.models.verification import VerificationEvidenceLink, VerificationResult, VerificationRun


def _seed_document(api, *, claim=True):
    document_id = str(uuid4())
    stored_filename = f"{uuid4()}.pdf"
    Path(api.settings.upload_dir, stored_filename).write_bytes(b"%PDF-1.7 test fixture")
    with api.session_factory() as db:
        db.add(Document(id=document_id, original_filename="fixture.pdf", stored_filename=stored_filename,
            title="Fixture", authors=[], pdf_metadata={}, file_size=22, mime_type="application/pdf",
            page_count=1, extraction_status="EXTRACTED"))
        db.add(DocumentPage(document_id=document_id, page_number=1,
                            extracted_text="The treatment reduced the measured outcome by twenty percent."))
        if claim:
            db.add(Claim(id=str(uuid4()), document_id=document_id, page_number=1,
                claim_text="The treatment reduced the measured outcome by twenty percent.",
                paragraph_context="The treatment reduced the measured outcome by twenty percent.",
                extraction_method="RULE_BASED", confidence_score=.8, fingerprint="a" * 64))
        db.add(ExtractionRun(id=str(uuid4()), document_id=document_id, status="COMPLETED",
                             claims_count=int(claim), citations_count=0))
        db.commit()
    return document_id


def _retrieval(status):
    def run(db, document_id, settings, http=None, heartbeat=None, ownership_check=None,
            provider_heartbeat=None):
        row = db.scalar(select(EvidenceRetrievalRun).where(EvidenceRetrievalRun.document_id == document_id))
        if row is None:
            row = EvidenceRetrievalRun(id=str(uuid4()), document_id=document_id, status=status,
                citations_processed=0, sources_matched=0, started_at=datetime.now(UTC),
                completed_at=None if status == "RUNNING" else datetime.now(UTC))
            db.add(row)
        else:
            row.status = status
        db.commit()
        if heartbeat:
            heartbeat()
        return row
    return run


def _verification(status):
    def run(db, document_id, settings, provider=None, heartbeat=None, provider_heartbeat=None,
            ownership_check=None):
        row = VerificationRun(id=str(uuid4()), document_id=document_id, active_document_id=(document_id if status == "RUNNING" else None),
            run_type="DOCUMENT", status=status, total_claims=1, processed_claims=0, failed_claims=0,
            started_at=datetime.now(UTC), completed_at=None if status == "RUNNING" else datetime.now(UTC))
        db.add(row)
        db.commit()
        if heartbeat:
            heartbeat()
        return row
    return run


def _verification_insufficient(db, document_id, settings, provider=None, heartbeat=None,
                               provider_heartbeat=None, ownership_check=None):
    claim = db.scalar(select(Claim).where(Claim.document_id == document_id))
    row = VerificationRun(id=str(uuid4()), document_id=document_id, run_type="DOCUMENT", status="COMPLETED",
        total_claims=1, processed_claims=1, failed_claims=0, started_at=datetime.now(UTC), completed_at=datetime.now(UTC))
    db.add(row)
    db.flush()
    db.add(VerificationResult(id=str(uuid4()), run_id=row.id, claim_id=claim.id,
        original_claim=claim.claim_text, verdict="INSUFFICIENT_EVIDENCE",
        explanation="No assessable evidence was available; assessment abstained.", confidence_score=0,
        evidence_availability="NONE", limitations=["No abstract or full text"],
        model_identifier="rule-based-no-evidence", prompt_version="phase5-test", verified_at=datetime.now(UTC)))
    db.commit()
    if heartbeat:
        heartbeat()
    return row


def test_successful_complete_pipeline_uses_mocked_phase_services(api, monkeypatch):
    document_id = _seed_document(api)
    monkeypatch.setattr(pipeline, "retrieve_document_evidence", _retrieval("COMPLETED"))
    monkeypatch.setattr(pipeline, "verify_document", _verification("COMPLETED"))
    response = api.client.post(f"/api/documents/{document_id}/analyze")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "COMPLETED"
    assert [stage["status"] for stage in body["stages"]] == ["COMPLETED"] * 5


def test_running_retrieval_keeps_analysis_active(api, monkeypatch):
    document_id = _seed_document(api)
    monkeypatch.setattr(pipeline, "retrieve_document_evidence", _retrieval("RUNNING"))
    response = api.client.post(f"/api/documents/{document_id}/analyze")
    assert response.status_code == 202
    assert response.json()["status"] == "RETRIEVING_EVIDENCE"
    assert response.json()["stages"][3]["status"] == "RUNNING"
    assert response.json()["stages"][4]["status"] == "PENDING"


def test_running_verification_keeps_analysis_active(api, monkeypatch):
    document_id = _seed_document(api)
    monkeypatch.setattr(pipeline, "retrieve_document_evidence", _retrieval("COMPLETED"))
    monkeypatch.setattr(pipeline, "verify_document", _verification("RUNNING"))
    response = api.client.post(f"/api/documents/{document_id}/analyze")
    assert response.status_code == 202
    assert response.json()["status"] == "VERIFYING"
    assert response.json()["stages"][4]["status"] == "RUNNING"
    assert response.json()["completedAt"] is None


def test_stale_verification_is_failed_atomically_and_results_are_preserved(api, monkeypatch):
    document_id = _seed_document(api)
    analysis_id, verification_id, claim_id = str(uuid4()), str(uuid4()), None
    old = datetime.now(UTC) - timedelta(minutes=20)
    with api.session_factory() as db:
        claim = db.scalar(select(Claim).where(Claim.document_id == document_id))
        claim_id = claim.id
        db.add(VerificationRun(id=verification_id, document_id=document_id, active_document_id=document_id,
            run_type="DOCUMENT", status="RUNNING", total_claims=1, processed_claims=1,
            failed_claims=0, started_at=old, updated_at=old))
        db.flush()
        db.add(VerificationResult(id=str(uuid4()), run_id=verification_id, claim_id=claim_id,
            original_claim=claim.claim_text, verdict="INSUFFICIENT_EVIDENCE", explanation="Abstained.",
            confidence_score=0, evidence_availability="NONE", limitations=["No evidence"],
            model_identifier="rule-based-no-evidence", prompt_version="test", verified_at=old))
        run = AnalysisRun(id=analysis_id, document_id=document_id, active_document_id=document_id,
            status="VERIFYING", current_stage="VERIFYING", created_at=old, started_at=old, updated_at=old)
        run.stages = [AnalysisStageExecution(id=str(uuid4()), stage_key=key, position=i,
            status=("RUNNING" if key == "VERIFYING" else "COMPLETED"), attempts=1,
            started_at=old, completed_at=None if key == "VERIFYING" else old,
            output_run_id=verification_id if key == "VERIFYING" else None)
            for i, key in enumerate(pipeline.STAGES)]
        db.add(run)
        db.add(DocumentOperationLease(document_id=document_id, owner_id=analysis_id,
            operation="ANALYSIS", heartbeat_at=old))
        db.commit()
    monkeypatch.setattr(pipeline, "verify_document", _verification("COMPLETED"))
    response = api.client.post(f"/api/analyses/{analysis_id}/retry")
    assert response.status_code == 200
    with api.session_factory() as db:
        old_run = db.get(VerificationRun, verification_id)
        assert old_run.status == "FAILED" and old_run.active_document_id is None
        assert db.scalar(select(func.count()).select_from(VerificationResult).where(
            VerificationResult.run_id == verification_id)) == 1
        assert db.get(AnalysisRun, analysis_id).status == "COMPLETED"


def test_concurrent_retry_has_one_owner(api, monkeypatch):
    document_id = _seed_document(api, claim=False)
    analysis_id = str(uuid4())
    with api.session_factory() as db:
        run = AnalysisRun(id=analysis_id, document_id=document_id, status="FAILED",
            active_document_id=None, created_at=datetime.now(UTC), completed_at=datetime.now(UTC))
        run.stages = [AnalysisStageExecution(id=str(uuid4()), stage_key=key, position=i, status="PENDING")
                      for i, key in enumerate(pipeline.STAGES)]
        db.add(run)
        db.commit()
    entered, resume = Event(), Event()
    def blocking_stage(db, analysis, stage, settings):
        entered.set()
        assert resume.wait(5)
        return "FAILED"
    monkeypatch.setattr(pipeline, "_execute_stage", blocking_stage)
    with ThreadPoolExecutor(max_workers=1) as pool:
        first = pool.submit(api.client.post, f"/api/analyses/{analysis_id}/retry")
        assert entered.wait(5)
        second = api.client.post(f"/api/analyses/{analysis_id}/retry")
        resume.set()
        assert first.result(timeout=10).status_code == 200
    assert second.status_code == 409


@pytest.mark.parametrize("path", ["extract", "retrieve-evidence", "verify"])
def test_active_analysis_blocks_standalone_phase3_to_phase5_endpoints(api, monkeypatch, path):
    document_id = _seed_document(api)
    monkeypatch.setattr(pipeline, "retrieve_document_evidence", _retrieval("RUNNING"))
    active = api.client.post(f"/api/documents/{document_id}/analyze")
    assert active.status_code == 202
    assert api.client.post(f"/api/documents/{document_id}/{path}").status_code == 409


@pytest.mark.parametrize("phase", ["EXTRACTION", "EVIDENCE", "VERIFICATION"])
def test_analysis_conflicts_with_preexisting_active_phase_run(api, phase):
    document_id = _seed_document(api)
    with api.session_factory() as db:
        if phase == "EXTRACTION":
            extraction = db.scalar(select(ExtractionRun).where(ExtractionRun.document_id == document_id))
            extraction.status = "RUNNING"
        elif phase == "EVIDENCE":
            db.add(EvidenceRetrievalRun(id=str(uuid4()), document_id=document_id, status="RUNNING"))
        else:
            db.add(VerificationRun(id=str(uuid4()), document_id=document_id, active_document_id=document_id,
                run_type="DOCUMENT", status="RUNNING", total_claims=1, processed_claims=0, failed_claims=0))
        db.commit()
    response = api.client.post(f"/api/documents/{document_id}/analyze")
    assert response.status_code == 409


def test_pipeline_heartbeat_refreshes_analysis_and_operation_lease(api, monkeypatch):
    document_id = _seed_document(api, claim=False)
    def heartbeat_retrieval(db, document_id, settings, http=None, heartbeat=None,
                            ownership_check=None, provider_heartbeat=None):
        old = datetime.now(UTC) - timedelta(minutes=2)
        row = EvidenceRetrievalRun(id=str(uuid4()), document_id=document_id, status="RUNNING",
            citations_processed=0, sources_matched=0, started_at=old, updated_at=old)
        db.add(row)
        db.commit()
        db.execute(update(DocumentOperationLease).where(
            DocumentOperationLease.document_id == document_id).values(heartbeat_at=old))
        db.execute(update(AnalysisRun).where(
            AnalysisRun.active_document_id == document_id).values(updated_at=old))
        db.commit()
        heartbeat()
        lease = db.get(DocumentOperationLease, document_id)
        analysis = db.scalar(select(AnalysisRun).where(AnalysisRun.document_id == document_id))
        row = db.get(EvidenceRetrievalRun, row.id)
        assert lease.heartbeat_at > old
        assert analysis.updated_at > old
        assert row.updated_at > old
        row.status, row.completed_at = "COMPLETED", datetime.now(UTC)
        db.commit()
        return row
    monkeypatch.setattr(pipeline, "retrieve_document_evidence", heartbeat_retrieval)
    response = api.client.post(f"/api/documents/{document_id}/analyze")
    assert response.status_code == 200


def test_partial_retrieval_completes_with_warnings(api, monkeypatch):
    document_id = _seed_document(api)
    monkeypatch.setattr(pipeline, "retrieve_document_evidence", _retrieval("PARTIAL"))
    monkeypatch.setattr(pipeline, "verify_document", _verification("COMPLETED"))
    response = api.client.post(f"/api/documents/{document_id}/analyze")
    assert response.json()["status"] == "COMPLETED_WITH_WARNINGS"
    assert response.json()["stages"][3]["status"] == "COMPLETED_WITH_WARNINGS"


def test_insufficient_evidence_is_a_verdict_not_pipeline_failure(api, monkeypatch):
    document_id = _seed_document(api)
    monkeypatch.setattr(pipeline, "retrieve_document_evidence", _retrieval("COMPLETED"))
    monkeypatch.setattr(pipeline, "verify_document", _verification_insufficient)
    response = api.client.post(f"/api/documents/{document_id}/analyze")
    assert response.json()["status"] == "COMPLETED"
    result = api.client.get(f"/api/analyses/{response.json()['analysisId']}").json()
    assert result["verdictCounts"] == {"INSUFFICIENT_EVIDENCE": 1}
    assert result["results"][0]["verdict"] == "INSUFFICIENT_EVIDENCE"


def test_history_keeps_assessment_and_evidence_provenance_after_mutable_rows_delete(api):
    document_id = _seed_document(api)
    with api.session_factory() as db:
        claim = db.scalar(select(Claim).where(Claim.document_id == document_id))
        citation = Citation(id=str(uuid4()), document_id=document_id, citation_key="Ref", aliases=["Ref"],
            raw_reference="Doe. Study.", authors=["Doe"], publication_title="Study", publication_year=2024,
            doi="10.1234/example", journal="Journal", reference_status="BIBLIOGRAPHY", reference_hash="b" * 64)
        mention = CitationMention(id=str(uuid4()), citation_id=citation.id, page_number=1,
            char_start=1, char_end=5, mention_text="(Doe)")
        source = ResearchSource(id=str(uuid4()), doi="10.1234/example", title="Study source",
            normalized_title="study source", authors=[], journal="Journal", publication_date="2024",
            publication_year=2024, publication_type="article", abstract="A twenty percent reduction.",
            metadata_status="ABSTRACT", provider_payload={})
        db.add_all([citation, mention, source]); db.flush()
        db.add(SourceIdentifier(source_id=source.id, provider="Crossref", identifier="10.1234/example"))
        evidence = EvidenceRecord(id=str(uuid4()), claim_id=claim.id, citation_id=citation.id, source_id=source.id,
            mention_id=mention.id, availability="ABSTRACT", retrieved_text="A twenty percent reduction.",
            source_url="https://doi.org/10.1234/example", retrieved_at=datetime.now(UTC))
        verification = VerificationRun(id=str(uuid4()), document_id=document_id, run_type="DOCUMENT", status="COMPLETED",
            total_claims=1, processed_claims=1, failed_claims=0, started_at=datetime.now(UTC), completed_at=datetime.now(UTC))
        db.add_all([evidence, verification]); db.flush()
        result = VerificationResult(id=str(uuid4()), run_id=verification.id, claim_id=claim.id,
            original_claim=claim.claim_text, verdict="SUPPORTED", explanation="The excerpt supports the outcome.",
            confidence_score=.77, evidence_availability="ABSTRACT", limitations=["Abstract only"],
            model_identifier="mock-model", prompt_version="prompt-v1", verified_at=datetime.now(UTC))
        db.add(result); db.flush()
        db.add(VerificationEvidenceLink(result_id=result.id, evidence_record_id=evidence.id,
            relation="DIRECT_SUPPORT", excerpt="twenty percent reduction", rationale="Same outcome."))
        analysis = AnalysisRun(id=str(uuid4()), document_id=document_id, status="COMPLETED",
            progress_percent=100, created_at=datetime.now(UTC), completed_at=datetime.now(UTC))
        analysis.stages = [AnalysisStageExecution(id=str(uuid4()), stage_key="VERIFYING", position=4,
            status="COMPLETED", attempts=1, output_run_id=verification.id)]
        db.add(analysis); db.flush()
        pipeline._snapshot_results(db, analysis)
        snapshot = analysis.verdict_details[0]
        db.delete(claim)
        db.commit()
        stored = db.get(AnalysisRun, analysis.id).verdict_details[0]
        assert stored == snapshot
        assert stored["evidence"][0]["evidence_id"] == evidence.id
        assert stored["evidence"][0]["source_provider"] == "Crossref"
        assert stored["evidence"][0]["relation"] == "DIRECT_SUPPORT"
        analysis_id = analysis.id
    response = api.client.get(f"/api/analyses/{analysis_id}")
    assert response.status_code == 200
    assert response.json()["results"][0]["evidence"][0]["citationDoi"] == "10.1234/example"


def test_migration_07_up_and_down(tmp_path, monkeypatch):
    from app.core.config import get_settings
    database_url = f"sqlite:///{(tmp_path / 'migration.db').as_posix()}"
    monkeypatch.setenv("DATABASE_URL", database_url)
    get_settings.cache_clear()
    config = Config(str(Path(__file__).parents[1] / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", database_url)
    engine = create_engine(database_url)
    try:
        command.upgrade(config, "head")
        tables = inspect(engine).get_table_names()
        assert "analysis_runs" in tables and "document_operation_leases" in tables
        assert "execution_token" in {column["name"] for column in inspect(engine).get_columns("analysis_runs")}
        command.downgrade(config, "20261119_06")
        assert "document_operation_leases" not in inspect(engine).get_table_names()
        assert "analysis_runs" in inspect(engine).get_table_names()
        assert "execution_token" not in {column["name"] for column in inspect(engine).get_columns("analysis_runs")}
    finally:
        engine.dispose()
        get_settings.cache_clear()


def test_duplicate_active_analysis_returns_same_run(api, monkeypatch):
    document_id = _seed_document(api)
    monkeypatch.setattr(pipeline, "retrieve_document_evidence", _retrieval("RUNNING"))
    first = api.client.post(f"/api/documents/{document_id}/analyze")
    second = api.client.post(f"/api/documents/{document_id}/analyze")
    assert first.status_code == second.status_code == 202
    assert first.json()["analysisId"] == second.json()["analysisId"]
    with api.session_factory() as db:
        assert db.scalar(select(func.count()).select_from(AnalysisRun).where(
            AnalysisRun.document_id == document_id)) == 1
