from pathlib import Path
from types import SimpleNamespace

from sqlalchemy import select

from app.db.models.analysis import AnalysisRun, AnalysisStageExecution
from app.db.models.document import Document
from tests.pdf_factory import build_text_pdf
import app.services.analysis_pipeline as pipeline


def test_analysis_runs_pipeline_and_persists_each_stage(api, monkeypatch):
    monkeypatch.setattr(pipeline, "retrieve_document_evidence", lambda db, document_id, settings, **kwargs:
                        SimpleNamespace(status="COMPLETED", id="mock-evidence-run"))
    monkeypatch.setattr(pipeline, "extract_document_content", lambda pages, heartbeat=None:
                        SimpleNamespace(claims=[], references=[], mentions=[]))
    monkeypatch.setattr(pipeline, "persist_extraction", lambda db, document_id, extraction: (0, 0))
    uploaded = api.client.post("/api/upload", files={"file": ("study.pdf", build_text_pdf([
        "The measured outcome increased substantially across the study population. " * 8,
    ]), "application/pdf")})
    assert uploaded.status_code == 201
    document_id = uploaded.json()["document_id"]

    response = api.client.post(f"/api/documents/{document_id}/analyze")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] in {"COMPLETED", "COMPLETED_WITH_WARNINGS"}
    assert 0 <= body["progressPercent"] <= 100
    assert [stage["stageKey"] for stage in body["stages"]] == [
        "VALIDATING", "EXTRACTING", "EXTRACTING_CLAIMS", "RETRIEVING_EVIDENCE", "VERIFYING",
    ]
    assert all(stage["status"] in {"COMPLETED", "COMPLETED_WITH_WARNINGS", "SKIPPED"} for stage in body["stages"])

    status = api.client.get(f"/api/documents/{document_id}/analysis-status")
    history = api.client.get(f"/api/documents/{document_id}/analyses")
    result = api.client.get(f"/api/analyses/{body['analysisId']}")
    assert status.json()["analysisId"] == body["analysisId"]
    assert [item["analysisId"] for item in history.json()["analyses"]] == [body["analysisId"]]
    assert result.json()["documentId"] == document_id
    assert "verdictCounts" in result.json()

    with api.session_factory() as db:
        run = db.get(AnalysisRun, body["analysisId"])
        assert run is not None and run.active_document_id is None
        assert len(db.scalars(select(AnalysisStageExecution).where(
            AnalysisStageExecution.analysis_id == run.id)).all()) == 5


def test_analysis_rejects_unknown_document(api):
    response = api.client.post("/api/documents/not-a-uuid/analyze")
    assert response.status_code == 404
    assert api.client.get("/api/documents/not-a-uuid/analyses").status_code == 404


def test_missing_uploaded_file_fails_validation_and_is_retryable(api):
    uploaded = api.client.post("/api/upload", files={"file": ("study.pdf", build_text_pdf(["Science " * 40]), "application/pdf")})
    assert uploaded.status_code == 201
    document_id = uploaded.json()["document_id"]
    with api.session_factory() as db:
        document = db.get(Document, document_id)
        Path(api.settings.upload_dir, document.stored_filename).unlink()

    response = api.client.post(f"/api/documents/{document_id}/analyze")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "FAILED"
    assert body["stages"][0]["status"] == "FAILED"
    retry = api.client.post(f"/api/analyses/{body['analysisId']}/retry")
    assert retry.status_code == 200
    assert retry.json()["retryCount"] == 1
    assert retry.json()["stages"][0]["attempts"] == 2
