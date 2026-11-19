from pathlib import Path

from sqlalchemy import select

from app.db.models.extraction import Citation, Claim, ClaimCitation, ExtractionRun
from tests.pdf_factory import build_text_pdf


def upload(api, pages: list[str]):
    return api.client.post(
        "/api/upload",
        files={"file": ("research.pdf", build_text_pdf(pages), "application/pdf")},
    )


def test_extraction_status_and_invalid_document_ids(api):
    assert api.client.get("/api/documents/not-a-uuid/extraction-status").status_code == 404
    assert api.client.post("/api/documents/not-a-uuid/extract").status_code == 404

    uploaded = upload(api, ["The treatment increased response by 10% in participants."])
    document_id = uploaded.json()["document_id"]
    response = api.client.get(f"/api/documents/{document_id}/extraction-status")

    assert response.status_code == 200
    assert response.json()["status"] == "NOT_STARTED"
    assert response.json()["claimsDetected"] == 0


def test_extraction_detects_claims_citations_and_provenance(api):
    body = (
        "Treatment reduced symptoms by 35% among participants [1].\n"
        "Smith et al. (2020) reported a 20% increase [2].\n\n"
        "References\n"
        "[1] Smith, J. (2020). Treatment response. Journal A, 4. doi:10.1234/alpha.1\n"
        "[2] Doe, R. (2021). Comparative outcome. Journal B, 7."
    )
    document_id = upload(api, [body]).json()["document_id"]

    status_response = api.client.post(f"/api/documents/{document_id}/extract")
    assert status_response.status_code == 200
    status_body = status_response.json()
    assert status_body["status"] == "COMPLETED"
    assert status_body["claimsDetected"] == 2
    assert status_body["citationsIdentified"] == 2

    claims_response = api.client.get(f"/api/documents/{document_id}/claims")
    claims = claims_response.json()["claims"]
    assert claims_response.json()["total"] == 2
    assert claims[0]["claimText"] == "Treatment reduced symptoms by 35% among participants [1]."
    assert claims[0]["pageNumber"] == 1
    assert claims[0]["extractionMethod"] == "RULE_BASED"
    assert len(claims[0]["citationIds"]) == 1

    citations_response = api.client.get(f"/api/documents/{document_id}/citations")
    citations = citations_response.json()["citations"]
    assert citations_response.json()["total"] == 2
    assert citations[0]["title"] == "Treatment response"
    assert citations[0]["doi"] == "10.1234/alpha.1"
    assert citations[0]["referenceStatus"] == "BIBLIOGRAPHY"
    assert citations[0]["mentionPages"] == [1]

    links = api.client.get(f"/api/documents/{document_id}/claim-citations").json()["links"]
    assert len(links) == 3
    assert all(link["isVerifiedEvidence"] is False for link in links)

    frontend_citations = api.client.get(f"/api/citations/{document_id}").json()
    assert frontend_citations["document"]["totalClaims"] == 2
    assert frontend_citations["citations"][0]["resolved"] is False
    assert frontend_citations["citations"][0]["evidenceAvailability"] == "NONE"


def test_unmatched_citation_stays_visible_without_fabricated_metadata(api):
    document_id = upload(api, ["The measured response increased by 15% in adults [9]."]).json()["document_id"]
    run = api.client.post(f"/api/documents/{document_id}/extract")
    assert run.status_code == 200

    citation = api.client.get(f"/api/documents/{document_id}/citations").json()["citations"][0]
    assert citation["citationKey"] == "number:9"
    assert citation["rawReference"] == "[9]"
    assert citation["title"] is None
    assert citation["doi"] is None
    assert citation["referenceStatus"] == "UNMATCHED"


def test_duplicate_extraction_request_is_idempotent(api):
    document_id = upload(api, ["The intervention improved results by 18%."]).json()["document_id"]

    first = api.client.post(f"/api/documents/{document_id}/extract").json()
    second = api.client.post(f"/api/documents/{document_id}/extract").json()

    assert first["status"] == second["status"] == "COMPLETED"
    assert first["claimsDetected"] == second["claimsDetected"] == 1
    with api.session_factory() as db:
        assert len(db.scalars(select(Claim).where(Claim.document_id == document_id)).all()) == 1
        assert len(db.scalars(select(ExtractionRun).where(ExtractionRun.document_id == document_id)).all()) == 1


def test_low_text_document_cannot_claim_extraction_succeeded(api):
    document_id = upload(api, [""]).json()["document_id"]

    response = api.client.post(f"/api/documents/{document_id}/extract")

    assert response.status_code == 422
    assert "OCR is not implemented" in response.json()["detail"]
    assert api.client.get(f"/api/documents/{document_id}/extraction-status").json()["status"] == "NOT_STARTED"


def test_failed_extraction_can_be_retried(api, monkeypatch):
    from app.api.routes import extraction as extraction_routes

    document_id = upload(api, ["The treatment increased survival by 8%."]).json()["document_id"]
    original = extraction_routes.extract_document_content
    monkeypatch.setattr(extraction_routes, "extract_document_content", lambda _pages: (_ for _ in ()).throw(ValueError()))

    failed = api.client.post(f"/api/documents/{document_id}/extract")
    assert failed.status_code == 500
    assert api.client.get(f"/api/documents/{document_id}/extraction-status").json()["status"] == "FAILED"

    monkeypatch.setattr(extraction_routes, "extract_document_content", original)
    retried = api.client.post(f"/api/documents/{document_id}/extract")
    assert retried.status_code == 200
    assert retried.json()["status"] == "COMPLETED"


def test_document_deletion_cascades_extraction_records_and_file(api):
    document_id = upload(api, ["The response increased by 28% [1].\nReferences\n[1] Smith (2020). Paper."]).json()["document_id"]
    assert api.client.post(f"/api/documents/{document_id}/extract").status_code == 200
    stored_file = next(Path(api.settings.upload_dir).glob("*.pdf"))

    response = api.client.delete(f"/api/documents/{document_id}")

    assert response.status_code == 204
    assert not stored_file.exists()
    with api.session_factory() as db:
        assert db.scalar(select(Claim).where(Claim.document_id == document_id)) is None
        assert db.scalar(select(Citation).where(Citation.document_id == document_id)) is None
        assert db.scalar(select(ExtractionRun).where(ExtractionRun.document_id == document_id)) is None
        assert db.scalar(select(ClaimCitation)) is None
