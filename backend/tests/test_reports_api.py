from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect

from app.db.models.analysis import AnalysisRun
from app.db.models.document import Document
from app.db.models.report import Report
from app.services import report_service


def _seed_analysis(api, status="COMPLETED"):
    document_id, analysis_id = str(uuid4()), str(uuid4())
    with api.session_factory() as db:
        db.add(Document(
            id=document_id, original_filename="science paper.pdf", stored_filename=f"{uuid4()}.pdf",
            title="A Study of Results", authors=["A. Researcher"], pdf_metadata={}, file_size=100,
            mime_type="application/pdf", page_count=1, extraction_status="EXTRACTED",
        ))
        db.flush()
        db.add(AnalysisRun(
            id=analysis_id, document_id=document_id,
            active_document_id=document_id if status in {"QUEUED", "VERIFYING"} else None,
            status=status,
            progress_percent=100 if status in {"COMPLETED", "COMPLETED_WITH_WARNINGS"} else 0,
            retry_count=0, warning_count=0, claims_detected=1, citations_identified=1,
            evidence_records=1, verification_results=1, verdict_counts={"SUPPORTED": 1},
            verdict_details=[{
                "claim_id": str(uuid4()),
                "original_claim": "The study reported <b>20% improvement</b> & a useful result.",
                "claim_page_number": 2,
                "claim_context": "The result had a 20% improvement.",
                "verdict": "SUPPORTED",
                "explanation": "The evidence excerpt supports the measured outcome.",
                "confidence_score": 0.87,
                "evidence_availability": "ABSTRACT",
                "limitations": ["Abstract only", "\x00 hostile </para> text"],
                "evidence": [{
                    "evidence_id": str(uuid4()), "relation": "DIRECT_SUPPORT",
                    "excerpt": "The measured outcome improved by 20%.",
                    "rationale": "The reported metric and direction match.",
                    "evidence_availability": "ABSTRACT", "citation_id": str(uuid4()),
                    "citation_title": "A supporting study", "citation_authors": ["A. Author", "B. Author"],
                    "citation_year": 2024, "citation_journal": "Journal of Results",
                    "citation_doi": "10.1234/example", "raw_reference": "Author et al. (2024)",
                    "citation_mention_page_number": 1, "citation_mention_text": "(Author et al., 2024)",
                    "source_id": str(uuid4()), "source_doi": "10.1234/example",
                    "source_provider": "Crossref", "source_identifiers": [
                        {"provider": "Crossref", "identifier": "10.1234/example"}],
                    "source_url": "https://example.org/study", "source_title": "A supporting study",
                    "source_authors": [{"given": "A.", "family": "Author"}],
                    "source_year": 2024, "source_journal": "Journal of Results",
                }],
                "model_identifier": "mock-model", "prompt_version": "prompt-v1",
                "verified_at": datetime.now(UTC).isoformat(),
            }],
            created_at=datetime.now(UTC), started_at=datetime.now(UTC), completed_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        ))
        db.commit()
    return analysis_id


def test_successful_report_generation_persists_metadata_and_pdf(api):
    analysis_id = _seed_analysis(api)
    response = api.client.post(f"/api/analyses/{analysis_id}/reports")
    assert response.status_code == 201
    metadata = response.json()
    assert metadata["analysisId"] == analysis_id
    assert metadata["fileSize"] > 0
    assert metadata["filename"].endswith(".pdf")
    assert Path(metadata["filename"]).name == metadata["filename"]

    with api.session_factory() as db:
        report = db.get(Report, metadata["reportId"])
        assert report is not None
        assert report.analysis_id == analysis_id
        assert report.file_size == metadata["fileSize"]
        pdf_path = Path(api.settings.upload_dir) / "reports" / report.filename
        assert pdf_path.is_file()
        assert pdf_path.read_bytes().startswith(b"%PDF-")


def test_report_history_and_download_return_pdf(api):
    analysis_id = _seed_analysis(api)
    created = [api.client.post(f"/api/analyses/{analysis_id}/reports").json() for _ in range(2)]
    history = api.client.get(f"/api/analyses/{analysis_id}/reports")
    assert history.status_code == 200
    assert history.json()["analysisId"] == analysis_id
    assert {row["reportId"] for row in history.json()["reports"]} == {row["reportId"] for row in created}

    download = api.client.get(f"/api/reports/{created[0]['reportId']}/download")
    assert download.status_code == 200
    assert download.headers["content-type"].startswith("application/pdf")
    assert download.content.startswith(b"%PDF-")


def test_analysis_results_still_return_full_claim_and_evidence_snapshot(api):
    analysis_id = _seed_analysis(api)
    response = api.client.get(f"/api/analyses/{analysis_id}")
    assert response.status_code == 200
    result = response.json()["results"][0]
    assert result["originalClaim"].startswith("The study reported")
    assert result["verdict"] == "SUPPORTED"
    assert result["confidenceScore"] == 0.87
    assert result["evidence"][0]["excerpt"] == "The measured outcome improved by 20%."
    assert result["evidence"][0]["relation"] == "DIRECT_SUPPORT"
    assert result["evidence"][0]["citationDoi"] == "10.1234/example"


@pytest.mark.parametrize("method,path", [
    ("post", "/api/analyses/not-a-uuid/reports"),
    ("get", "/api/analyses/not-a-uuid/reports"),
    ("post", f"/api/analyses/{uuid4()}/reports"),
    ("get", f"/api/analyses/{uuid4()}/reports"),
    ("get", f"/api/reports/{uuid4()}/download"),
    ("get", "/api/reports/not-a-uuid/download"),
])
def test_unknown_or_invalid_ids_return_404(api, method, path):
    response = getattr(api.client, method)(path)
    assert response.status_code == 404


@pytest.mark.parametrize("status", ["QUEUED", "VERIFYING", "FAILED"])
def test_report_generation_rejects_incomplete_or_failed_analysis(api, status):
    analysis_id = _seed_analysis(api, status=status)
    response = api.client.post(f"/api/analyses/{analysis_id}/reports")
    assert response.status_code == 409


def test_database_failure_removes_unregistered_pdf_file(api, monkeypatch):
    analysis_id = _seed_analysis(api)
    with api.session_factory() as db:
        analysis = db.get(AnalysisRun, analysis_id)
        document = db.get(Document, analysis.document_id)

        def fail_commit():
            raise RuntimeError("simulated persistence failure")

        monkeypatch.setattr(db, "commit", fail_commit)
        with pytest.raises(RuntimeError, match="simulated persistence failure"):
            report_service.generate_report(db, analysis, document, api.settings)
        db.rollback()

    report_dir = Path(api.settings.upload_dir) / "reports"
    assert not list(report_dir.glob("*.pdf"))
    with api.session_factory() as db:
        assert db.query(Report).count() == 0


def test_report_migration_upgrade_and_downgrade(tmp_path, monkeypatch):
    from app.core.config import get_settings

    database_url = f"sqlite:///{(tmp_path / 'report-migration.db').as_posix()}"
    monkeypatch.setenv("DATABASE_URL", database_url)
    get_settings.cache_clear()
    config = Config(str(Path(__file__).parents[1] / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", database_url)
    engine = create_engine(database_url)
    try:
        command.upgrade(config, "head")
        assert "reports" in inspect(engine).get_table_names()
        command.downgrade(config, "20261120_08")
        assert "reports" not in inspect(engine).get_table_names()
    finally:
        engine.dispose()
        get_settings.cache_clear()
