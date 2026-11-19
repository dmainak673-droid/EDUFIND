from pathlib import Path

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from app.db.models.document import Document, DocumentPage
from app.db.session import get_db
from tests.pdf_factory import build_encrypted_pdf, build_text_pdf


def upload(client, payload: bytes, filename: str = "paper.pdf", content_type: str = "application/pdf"):
    return client.post("/api/upload", files={"file": (filename, payload, content_type)})


def test_valid_upload_preserves_frontend_response_contract(api):
    response = upload(api.client, build_text_pdf(["A scientific result " * 10]))

    assert response.status_code == 201
    body = response.json()
    assert body["document_id"]
    assert body["filename"] == "paper.pdf"
    assert body["size"] > 0
    assert body["page_count"] == 1
    assert body["status"] == "UPLOADED"
    assert len(list(Path(api.settings.upload_dir).glob("*.pdf"))) == 1


def test_document_upload_alias_is_available(api):
    response = api.client.post(
        "/api/documents/upload",
        files={"file": ("paper.pdf", build_text_pdf(["Enough content " * 10]), "application/octet-stream")},
    )
    assert response.status_code == 201


def test_rejects_invalid_extension(api):
    response = upload(api.client, b"%PDF-1.4\n", "paper.txt")
    assert response.status_code == 415


def test_user_filename_is_not_used_as_storage_path(api):
    response = upload(api.client, build_text_pdf(["A paper " * 10]), r"..\..\outside.pdf")
    assert response.status_code == 201
    assert response.json()["filename"] == "outside.pdf"
    stored = list(Path(api.settings.upload_dir).glob("*.pdf"))
    assert len(stored) == 1
    assert stored[0].name != "outside.pdf"


def test_rejects_invalid_pdf_signature(api):
    response = upload(api.client, b"not a pdf", "paper.pdf")
    assert response.status_code == 415


def test_rejects_empty_upload(api):
    response = upload(api.client, b"", "paper.pdf")
    assert response.status_code == 400


def test_rejects_oversized_upload(api):
    response = upload(api.client, b"%PDF-" + b"x" * (2 * 1024 * 1024), "paper.pdf")
    assert response.status_code == 413


def test_rejects_malformed_pdf_and_cleans_staging_file(api):
    response = upload(api.client, b"%PDF-1.7\nnot a complete PDF", "paper.pdf")
    assert response.status_code == 422
    assert list(Path(api.settings.upload_dir).iterdir()) == []


def test_rejects_encrypted_pdf(api):
    response = upload(api.client, build_encrypted_pdf(), "secret.pdf")
    assert response.status_code == 422
    assert "Encrypted" in response.json()["detail"]


def test_extracts_each_page_and_pdf_metadata(api):
    texts = ["First page scientific findings " * 8, "Second page quantitative result " * 8]
    response = upload(api.client, build_text_pdf(texts, title="Study title", author="Ada Author"))
    assert response.status_code == 201
    document_id = response.json()["document_id"]

    document_response = api.client.get(f"/api/documents/{document_id}")
    document = document_response.json()
    assert document["title"] == "Study title"
    assert document["authors"] == ["Ada Author"]
    assert document["pageCount"] == 2
    assert document["extractionStatus"] == "EXTRACTED"

    with api.session_factory() as db:
        pages = db.scalars(
            select(DocumentPage).where(DocumentPage.document_id == document_id).order_by(DocumentPage.page_number)
        ).all()
    assert [(page.page_number, page.extracted_text.strip()) for page in pages] == [
        (1, texts[0].strip()),
        (2, texts[1].strip()),
    ]


def test_empty_or_scanned_style_pdf_is_flagged_for_ocr(api):
    response = upload(api.client, build_text_pdf([""]), "scan.pdf")
    assert response.status_code == 201
    assert response.json()["extraction_status"] == "OCR_REQUIRED"
    assert "OCR is not implemented" in response.json()["extraction_warning"]


def test_blank_page_is_preserved_when_other_pages_have_extractable_text(api):
    response = upload(api.client, build_text_pdf(["A supported result " * 10, ""]), "partial.pdf")
    assert response.status_code == 201
    assert response.json()["extraction_status"] == "PARTIAL"
    with api.session_factory() as db:
        pages = db.scalars(
            select(DocumentPage)
            .where(DocumentPage.document_id == response.json()["document_id"])
            .order_by(DocumentPage.page_number)
        ).all()
    assert len(pages) == 2
    assert pages[1].extracted_text == ""


def test_document_list_retrieval_and_unknown_id(api):
    first = upload(api.client, build_text_pdf(["First paper " * 10]), "duplicate.pdf").json()["document_id"]
    second = upload(api.client, build_text_pdf(["Second paper " * 10]), "duplicate.pdf").json()["document_id"]

    page_one = api.client.get("/api/documents?page=1&pageSize=1")
    page_two = api.client.get("/api/documents?page=2&pageSize=1")
    assert page_one.status_code == page_two.status_code == 200
    assert page_one.json()["total"] == 2
    assert page_one.json()["documents"][0]["id"] != page_two.json()["documents"][0]["id"]
    assert api.client.get(f"/api/documents/{first}").json()["fileName"] == "duplicate.pdf"
    assert api.client.get(f"/api/documents/{second}").status_code == 200
    assert api.client.get("/api/documents/not-a-uuid").status_code == 404


def test_delete_removes_database_rows_and_stored_file(api):
    document_id = upload(api.client, build_text_pdf(["A paper " * 10])).json()["document_id"]
    stored_path = next(Path(api.settings.upload_dir).glob("*.pdf"))

    response = api.client.delete(f"/api/documents/{document_id}")

    assert response.status_code == 204
    assert not stored_path.exists()
    assert api.client.get(f"/api/documents/{document_id}").status_code == 404
    with api.session_factory() as db:
        assert db.scalar(select(DocumentPage).where(DocumentPage.document_id == document_id)) is None
        assert db.get(Document, document_id) is None


def test_upload_database_failure_removes_file(api):
    failing_session = api.session_factory()

    def fail_commit():
        raise SQLAlchemyError("simulated database failure")

    failing_session.commit = fail_commit

    def failing_db():
        yield failing_session

    api.client.app.dependency_overrides[get_db] = failing_db
    response = upload(api.client, build_text_pdf(["A paper " * 10]))

    assert response.status_code == 500
    assert response.json() == {"detail": "The document could not be saved."}
    assert list(Path(api.settings.upload_dir).iterdir()) == []
    failing_session.close()
