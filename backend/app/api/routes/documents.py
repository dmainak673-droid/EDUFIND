import logging
import os
from pathlib import Path
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.api.deps import get_request_settings
from app.core.config import Settings
from app.db.models.document import Document, DocumentPage
from app.db.models.extraction import Citation, Claim
from app.db.session import get_db
from app.schemas.document import DocumentListResponse, DocumentResponse, UploadResponse
from app.services.pdf_service import EncryptedPdfError, InvalidPdfError, extract_pdf
from app.services.storage import LocalDocumentStorage
from app.services.operation_lock import operation_guard

router = APIRouter(tags=["documents"])
logger = logging.getLogger(__name__)
_CHUNK_SIZE = 64 * 1024
_PDF_SIGNATURE = b"%PDF-"


@router.post("/upload", response_model=UploadResponse, status_code=status.HTTP_201_CREATED)
@router.post("/documents/upload", response_model=UploadResponse, status_code=status.HTTP_201_CREATED)
def upload_document(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_request_settings),
) -> UploadResponse:
    original_filename = _safe_display_filename(file.filename)
    if not original_filename or Path(original_filename).suffix.lower() != ".pdf":
        raise HTTPException(status_code=415, detail="Only files with a .pdf filename are accepted.")

    document_id = uuid4()
    stored_filename = f"{document_id}.pdf"
    try:
        storage = LocalDocumentStorage(settings.upload_dir)
    except OSError as exc:
        file.file.close()
        logger.error("Document storage is unavailable error_type=%s", type(exc).__name__)
        raise HTTPException(status_code=500, detail="Document storage is unavailable.") from exc
    staging_path = storage.staging_path(document_id)
    final_path: Path | None = None
    byte_count = 0
    signature = bytearray()

    try:
        with staging_path.open("xb") as output:
            while chunk := file.file.read(_CHUNK_SIZE):
                byte_count += len(chunk)
                if byte_count > settings.max_upload_size_bytes:
                    raise HTTPException(status_code=413, detail="PDF exceeds the configured upload size limit.")
                if len(signature) < len(_PDF_SIGNATURE):
                    signature.extend(chunk[: len(_PDF_SIGNATURE) - len(signature)])
                output.write(chunk)
            output.flush()
            os.fsync(output.fileno())

        if byte_count == 0:
            raise HTTPException(status_code=400, detail="The uploaded file is empty.")
        if bytes(signature) != _PDF_SIGNATURE:
            raise HTTPException(status_code=415, detail="The uploaded file does not have a valid PDF signature.")

        try:
            extraction = extract_pdf(staging_path)
        except EncryptedPdfError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except InvalidPdfError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

        extraction_status, warning = _extraction_status(
            extraction.extracted_char_count, extraction.page_texts, settings
        )
        title = extraction.title or Path(original_filename).stem or "Untitled document"
        final_path = storage.promote(staging_path, stored_filename)

        record = Document(
            id=str(document_id),
            original_filename=original_filename,
            stored_filename=stored_filename,
            title=title[:500],
            authors=extraction.authors,
            pdf_metadata=extraction.metadata,
            file_size=byte_count,
            mime_type="application/pdf",
            page_count=extraction.page_count,
            extraction_status=extraction_status,
            extraction_warning=warning,
            pages=[
                DocumentPage(page_number=page_number, extracted_text=text)
                for page_number, text in enumerate(extraction.page_texts, start=1)
            ],
        )
        db.add(record)
        db.commit()
        logger.info("Document uploaded id=%s bytes=%d pages=%d extraction_status=%s", record.id, byte_count, record.page_count, extraction_status)
        return UploadResponse(
            document_id=record.id,
            filename=record.original_filename,
            size=record.file_size,
            title=record.title,
            status="UPLOADED",
            page_count=record.page_count,
            extraction_status=record.extraction_status,
            extraction_warning=record.extraction_warning,
        )
    except HTTPException:
        db.rollback()
        _cleanup_failed_upload(storage, final_path or staging_path, document_id)
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        _cleanup_failed_upload(storage, final_path or staging_path, document_id)
        logger.error("Database write failed during document upload id=%s error_type=%s", document_id, type(exc).__name__)
        raise HTTPException(status_code=500, detail="The document could not be saved.") from exc
    except OSError as exc:
        db.rollback()
        _cleanup_failed_upload(storage, final_path or staging_path, document_id)
        logger.error("Storage operation failed during document upload id=%s error_type=%s", document_id, type(exc).__name__)
        raise HTTPException(status_code=500, detail="The document could not be stored.") from exc
    except Exception as exc:
        db.rollback()
        _cleanup_failed_upload(storage, final_path or staging_path, document_id)
        logger.error("Unexpected upload failure id=%s error_type=%s", document_id, type(exc).__name__)
        raise HTTPException(status_code=500, detail="The document could not be processed.") from exc
    finally:
        file.file.close()


@router.get("/documents", response_model=DocumentListResponse)
def list_documents(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100, alias="pageSize"),
    db: Session = Depends(get_db),
) -> DocumentListResponse:
    total = db.scalar(select(func.count()).select_from(Document)) or 0
    records = db.scalars(
        select(Document).order_by(Document.created_at.desc(), Document.id).offset((page - 1) * page_size).limit(page_size)
    ).all()
    counts = _load_document_counts(db, [record.id for record in records])
    return DocumentListResponse(
        documents=[
            _to_document_response(record, *counts.get(record.id, (0, 0))) for record in records
        ],
        page=page,
        page_size=page_size,
        total=total,
    )


@router.get("/documents/{document_id}", response_model=DocumentResponse)
def get_document(document_id: str, db: Session = Depends(get_db)) -> DocumentResponse:
    record = _find_document(document_id, db)
    counts = _load_document_counts(db, [record.id])
    return _to_document_response(record, *counts[record.id])


@router.delete("/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document(
    document_id: str,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_request_settings),
    _operation: str | None = Depends(operation_guard("DELETE")),
) -> None:
    record = _find_document(document_id, db)
    storage = LocalDocumentStorage(settings.upload_dir)
    source_path = storage.document_path(record.stored_filename)
    tombstone = source_path.with_suffix(".deleting")
    moved_file = False
    try:
        if source_path.exists():
            source_path.replace(tombstone)
            moved_file = True
        db.delete(record)
        db.commit()
    except SQLAlchemyError as exc:
        db.rollback()
        if moved_file and tombstone.exists():
            tombstone.replace(source_path)
        logger.error("Database delete failed for document id=%s error_type=%s", document_id, type(exc).__name__)
        raise HTTPException(status_code=500, detail="The document could not be deleted.") from exc
    except OSError as exc:
        db.rollback()
        if moved_file and tombstone.exists():
            tombstone.replace(source_path)
        logger.error("Storage delete failed for document id=%s error_type=%s", document_id, type(exc).__name__)
        raise HTTPException(status_code=500, detail="The document could not be deleted.") from exc
    if moved_file:
        try:
            storage.remove_staging(tombstone)
        except OSError:
            logger.error("Deleted document file could not be cleaned up id=%s", document_id)


def _find_document(document_id: str, db: Session) -> Document:
    try:
        canonical_id = str(UUID(document_id))
    except (ValueError, AttributeError) as exc:
        raise HTTPException(status_code=404, detail="Document not found.") from exc
    record = db.get(Document, canonical_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Document not found.")
    return record


def _to_document_response(record: Document, claim_count: int = 0, citation_count: int = 0) -> DocumentResponse:
    return DocumentResponse(
        id=record.id,
        title=record.title,
        authors=record.authors,
        file_name=record.original_filename,
        file_size_bytes=record.file_size,
        uploaded_at=record.created_at,
        page_count=record.page_count,
        extraction_status=record.extraction_status,
        extraction_warning=record.extraction_warning,
        total_claims=claim_count,
        total_citations=citation_count,
        resolved_citations=0,
        unresolved_citations=citation_count,
    )


def _load_document_counts(db: Session, document_ids: list[str]) -> dict[str, tuple[int, int]]:
    if not document_ids:
        return {}
    claims = dict(
        db.execute(
            select(Claim.document_id, func.count(Claim.id))
            .where(Claim.document_id.in_(document_ids))
            .group_by(Claim.document_id)
        ).all()
    )
    citations = dict(
        db.execute(
            select(Citation.document_id, func.count(Citation.id))
            .where(Citation.document_id.in_(document_ids))
            .group_by(Citation.document_id)
        ).all()
    )
    return {document_id: (claims.get(document_id, 0), citations.get(document_id, 0)) for document_id in document_ids}


def _safe_display_filename(filename: str | None) -> str:
    if not filename:
        return ""
    leaf = filename.replace("\\", "/").rsplit("/", 1)[-1]
    cleaned = "".join(char for char in leaf if ord(char) >= 32 and ord(char) != 127).strip()
    return cleaned[:255]


def _cleanup_failed_upload(storage: LocalDocumentStorage, path: Path, document_id: UUID) -> None:
    try:
        storage.remove_staging(path)
    except OSError:
        logger.error("Failed upload left a storage artifact id=%s", document_id)


def _extraction_status(char_count: int, page_texts: list[str], settings: Settings) -> tuple[str, str | None]:
    if char_count < settings.min_extractable_text_chars:
        return "OCR_REQUIRED", "This PDF has little or no extractable text; OCR is not implemented."
    if any(not page.strip() for page in page_texts):
        return "PARTIAL", "Some pages have no extractable text; OCR is not implemented."
    return "EXTRACTED", None

