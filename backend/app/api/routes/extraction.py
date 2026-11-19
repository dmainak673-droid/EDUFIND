import logging
from datetime import UTC, datetime
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.db.models.document import Document, DocumentPage
from app.db.models.extraction import Citation, CitationMention, Claim, ClaimCitation, ExtractionRun
from app.db.models.research import EvidenceRecord, ResearchSource, SourceIdentifier, SourceMatch
from app.db.session import get_db
from app.schemas.document import DocumentResponse
from app.schemas.extraction import (
    CitationExtractionListResponse,
    CitationExtractionResponse,
    ClaimCitationListResponse,
    ClaimCitationResponse,
    ClaimExtractionListResponse,
    ClaimExtractionResponse,
    DocumentCitationsResponse,
    ExtractionStatusResponse,
    FrontendCitationReference,
)
from app.services.extraction_persistence import persist_extraction
from app.services.extraction_service import extract_document_content

router = APIRouter(tags=["extraction"])
logger = logging.getLogger(__name__)


@router.get("/documents/{document_id}/claims", response_model=ClaimExtractionListResponse)
def get_document_claims(document_id: str, db: Session = Depends(get_db)) -> ClaimExtractionListResponse:
    document = _find_document(document_id, db)
    claims = db.scalars(
        select(Claim).where(Claim.document_id == document.id).order_by(Claim.page_number, Claim.id)
    ).all()
    page_text = {
        page.page_number: page.extracted_text
        for page in db.scalars(select(DocumentPage).where(DocumentPage.document_id == document.id)).all()
    }
    claims.sort(key=lambda claim: (
        claim.page_number,
        page_text.get(claim.page_number, "").find(claim.claim_text)
        if page_text.get(claim.page_number, "").find(claim.claim_text) >= 0 else len(page_text.get(claim.page_number, "")),
        claim.id,
    ))
    claim_ids = [claim.id for claim in claims]
    link_rows = db.execute(
        select(ClaimCitation.claim_id, ClaimCitation.citation_id)
        .where(ClaimCitation.claim_id.in_(claim_ids))
        .order_by(ClaimCitation.claim_id, ClaimCitation.citation_id)
    ).all() if claim_ids else []
    links_by_claim: dict[str, list[str]] = {}
    for claim_id, citation_id in link_rows:
        links_by_claim.setdefault(claim_id, []).append(citation_id)
    return ClaimExtractionListResponse(
        document_id=document.id,
        claims=[
            ClaimExtractionResponse(
                claim_id=claim.id,
                document_id=claim.document_id,
                claim_text=claim.claim_text,
                page_number=claim.page_number,
                paragraph_context=claim.paragraph_context,
                extraction_method=claim.extraction_method,
                confidence_score=claim.confidence_score,
                citation_ids=links_by_claim.get(claim.id, []),
            )
            for claim in claims
        ],
        total=len(claims),
    )


@router.get("/documents/{document_id}/citations", response_model=CitationExtractionListResponse)
def get_document_citation_records(
    document_id: str, db: Session = Depends(get_db)
) -> CitationExtractionListResponse:
    document = _find_document(document_id, db)
    citations = db.scalars(
        select(Citation).where(Citation.document_id == document.id).order_by(Citation.citation_key, Citation.id)
    ).all()
    pages_by_citation = _mention_pages(db, [citation.id for citation in citations])
    return CitationExtractionListResponse(
        document_id=document.id,
        citations=[
            CitationExtractionResponse(
                citation_id=citation.id,
                citation_key=citation.citation_key,
                raw_reference=citation.raw_reference,
                authors=citation.authors,
                title=citation.publication_title,
                publication_year=citation.publication_year,
                doi=citation.doi,
                journal=citation.journal,
                reference_status=citation.reference_status,
                mention_pages=pages_by_citation.get(citation.id, []),
            )
            for citation in citations
        ],
        total=len(citations),
    )


@router.get("/documents/{document_id}/claim-citations", response_model=ClaimCitationListResponse)
def get_document_claim_citations(
    document_id: str, db: Session = Depends(get_db)
) -> ClaimCitationListResponse:
    document = _find_document(document_id, db)
    rows = db.execute(
        select(ClaimCitation, CitationMention)
        .join(CitationMention, CitationMention.id == ClaimCitation.mention_id)
        .join(Claim, Claim.id == ClaimCitation.claim_id)
        .where(Claim.document_id == document.id)
        .order_by(CitationMention.page_number, CitationMention.char_start, ClaimCitation.claim_id)
    ).all()
    return ClaimCitationListResponse(
        document_id=document.id,
        links=[
            ClaimCitationResponse(
                claim_id=link.claim_id,
                citation_id=link.citation_id,
                page_number=mention.page_number,
                mention_text=mention.mention_text,
            )
            for link, mention in rows
        ],
        total=len(rows),
    )


@router.get("/citations/{document_id}", response_model=DocumentCitationsResponse)
def get_frontend_document_citations(
    document_id: str, db: Session = Depends(get_db)
) -> DocumentCitationsResponse:
    document = _find_document(document_id, db)
    citations = db.scalars(
        select(Citation).where(Citation.document_id == document.id).order_by(Citation.citation_key, Citation.id)
    ).all()
    citation_ids = [citation.id for citation in citations]
    linked_rows = db.execute(
        select(ClaimCitation.citation_id, ClaimCitation.claim_id)
        .where(ClaimCitation.citation_id.in_(citation_ids))
        .order_by(ClaimCitation.citation_id, ClaimCitation.claim_id)
    ).all() if citation_ids else []
    claims_by_citation: dict[str, list[str]] = {}
    for citation_id, claim_id in linked_rows:
        claims_by_citation.setdefault(citation_id, []).append(claim_id)
    claim_count, citation_count = _document_counts(db, document.id)
    resolved_ids = set(db.scalars(select(SourceMatch.citation_id).where(SourceMatch.citation_id.in_(citation_ids), SourceMatch.status == "MATCHED")).all()) if citation_ids else set()
    document_response = DocumentResponse(
        id=document.id,
        title=document.title,
        authors=document.authors,
        file_name=document.original_filename,
        file_size_bytes=document.file_size,
        uploaded_at=document.created_at,
        page_count=document.page_count,
        extraction_status=document.extraction_status,
        extraction_warning=document.extraction_warning,
        total_claims=claim_count,
        total_citations=citation_count,
        resolved_citations=len(resolved_ids),
        unresolved_citations=max(0, citation_count - len(resolved_ids)),
    )
    return DocumentCitationsResponse(
        document=document_response,
        citations=[
            _frontend_citation(db, citation, claims_by_citation.get(citation.id, []), citation.id in resolved_ids)
            for citation in citations
        ],
    )


def _frontend_citation(db: Session, citation: Citation, claim_ids: list[str], resolved: bool) -> FrontendCitationReference:
    matched_rows = db.execute(
        select(ResearchSource, SourceIdentifier)
        .join(SourceMatch, SourceMatch.source_id == ResearchSource.id)
        .outerjoin(SourceIdentifier, SourceIdentifier.source_id == ResearchSource.id)
        .where(SourceMatch.citation_id == citation.id, SourceMatch.status == "MATCHED")
        .order_by(SourceMatch.score.desc())
    ).all()
    source, identifier = next(((s, i) for s, i in matched_rows if i and i.provider in {"Crossref", "OpenAlex"}), (matched_rows[0] if matched_rows else (None, None)))
    evidence = db.scalar(select(EvidenceRecord).where(EvidenceRecord.citation_id == citation.id).order_by(EvidenceRecord.retrieved_at.desc()))
    provider = identifier.provider if identifier else "Unknown"
    if provider not in {"Crossref", "OpenAlex"}: provider = "Unknown"
    return FrontendCitationReference(
                citation_id=citation.id,
                title=(source.title if source else None) or citation.publication_title or "",
                authors=([str(a.get("name") or " ".join(filter(None, [a.get("given"), a.get("family")]))) for a in source.authors if isinstance(a, dict)] if source else []) or citation.authors,
                year=(source.publication_year if source else None) or citation.publication_year,
                doi=(source.doi if source else None) or citation.doi,
                journal=(source.journal if source else None) or citation.journal,
                source_url=evidence.source_url if evidence else (f"https://doi.org/{source.doi}" if source and source.doi else None),
                provider=provider,
                resolved=resolved,
                evidence_availability="ABSTRACT" if evidence and evidence.availability == "ABSTRACT" else "NONE",
                abstract_snippet=evidence.retrieved_text[:500] if evidence and evidence.availability == "ABSTRACT" and evidence.retrieved_text else None,
                linked_claim_ids=claim_ids,
                raw_reference=citation.raw_reference,
                reference_status=citation.reference_status,
            )


@router.get("/documents/{document_id}/extraction-status", response_model=ExtractionStatusResponse)
def get_extraction_status(document_id: str, db: Session = Depends(get_db)) -> ExtractionStatusResponse:
    document = _find_document(document_id, db)
    run = db.scalar(select(ExtractionRun).where(ExtractionRun.document_id == document.id))
    return _status_response(document.id, run)


@router.post("/documents/{document_id}/extract", response_model=ExtractionStatusResponse)
def extract_document(document_id: str, response: Response, db: Session = Depends(get_db)) -> ExtractionStatusResponse:
    document = _find_document(document_id, db)
    if document.extraction_status == "OCR_REQUIRED":
        raise HTTPException(status_code=422, detail="No extractable text is available; OCR is not implemented.")

    run = db.scalar(select(ExtractionRun).where(ExtractionRun.document_id == document.id))
    if run is not None and run.status == "COMPLETED":
        return _status_response(document.id, run)
    if run is not None and run.status == "RUNNING":
        response.status_code = 202
        return _status_response(document.id, run)

    now = datetime.now(UTC)
    if run is None:
        run = ExtractionRun(id=str(uuid4()), document_id=document.id, status="RUNNING", started_at=now)
        db.add(run)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            run = db.scalar(select(ExtractionRun).where(ExtractionRun.document_id == document.id))
            if run is None:
                raise HTTPException(status_code=409, detail="Extraction is already being started.")
            if run.status == "COMPLETED":
                return _status_response(document.id, run)
            if run.status == "RUNNING":
                response.status_code = 202
                return _status_response(document.id, run)
    else:
        run.status = "RUNNING"
        run.error_message = None
        run.claims_count = 0
        run.citations_count = 0
        run.started_at = now
        run.completed_at = None
        db.commit()

    try:
        pages = db.scalars(
            select(DocumentPage).where(DocumentPage.document_id == document.id).order_by(DocumentPage.page_number)
        ).yield_per(50)
        extraction = extract_document_content(pages)
        claims_count, citations_count = persist_extraction(db, document.id, extraction)
        run.status = "COMPLETED"
        run.claims_count = claims_count
        run.citations_count = citations_count
        run.completed_at = datetime.now(UTC)
        run.error_message = None
        db.commit()
    except Exception as exc:
        db.rollback()
        failed_run = db.scalar(select(ExtractionRun).where(ExtractionRun.document_id == document.id))
        if failed_run is not None:
            failed_run.status = "FAILED"
            failed_run.error_message = "Extraction failed. The request may be retried."
            failed_run.completed_at = datetime.now(UTC)
            try:
                db.commit()
            except SQLAlchemyError:
                db.rollback()
        logger.error("Claim/citation extraction failed document_id=%s error_type=%s", document.id, type(exc).__name__)
        raise HTTPException(status_code=500, detail="Claim and citation extraction failed.") from exc
    return _status_response(document.id, run)


def _find_document(document_id: str, db: Session) -> Document:
    try:
        canonical_id = str(UUID(document_id))
    except (ValueError, AttributeError) as exc:
        raise HTTPException(status_code=404, detail="Document not found.") from exc
    document = db.get(Document, canonical_id)
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found.")
    return document


def _status_response(document_id: str, run: ExtractionRun | None) -> ExtractionStatusResponse:
    if run is None:
        return ExtractionStatusResponse(document_id=document_id, status="NOT_STARTED")
    return ExtractionStatusResponse(
        document_id=document_id,
        status=run.status,
        claims_detected=run.claims_count,
        citations_identified=run.citations_count,
        started_at=run.started_at,
        completed_at=run.completed_at,
        error=run.error_message,
    )


def _mention_pages(db: Session, citation_ids: list[str]) -> dict[str, list[int]]:
    if not citation_ids:
        return {}
    rows = db.execute(
        select(CitationMention.citation_id, CitationMention.page_number)
        .where(CitationMention.citation_id.in_(citation_ids))
        .distinct()
        .order_by(CitationMention.citation_id, CitationMention.page_number)
    ).all()
    pages: dict[str, list[int]] = {}
    for citation_id, page_number in rows:
        pages.setdefault(citation_id, []).append(page_number)
    return pages


def _document_counts(db: Session, document_id: str) -> tuple[int, int]:
    claims = db.query(Claim).filter(Claim.document_id == document_id).count()
    citations = db.query(Citation).filter(Citation.document_id == document_id).count()
    return claims, citations

