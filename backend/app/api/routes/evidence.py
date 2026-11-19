import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_request_settings
from app.core.config import Settings
from app.db.models.document import Document
from app.db.models.extraction import Citation, CitationMention, Claim, ClaimCitation
from app.db.models.research import EvidenceRecord, EvidenceRetrievalRun, ResearchSource, SourceIdentifier, SourceMatch
from app.db.session import get_db
from app.schemas.evidence import EvidenceListResponse, EvidenceResponse, EvidenceRunResponse, MatchResponse, SourceResponse
from app.services.evidence_retrieval import retrieve_document_evidence
from app.services.research_providers import normalize_doi

router = APIRouter(tags=["evidence"])
logger = logging.getLogger(__name__)


@router.post("/documents/{document_id}/retrieve-evidence", response_model=EvidenceRunResponse)
def retrieve_evidence(document_id: str, response: Response, db: Session = Depends(get_db), settings: Settings = Depends(get_request_settings)) -> EvidenceRunResponse:
    document = _find(Document, document_id, db, "Document not found.")
    if db.scalar(select(Citation.id).where(Citation.document_id == document.id)) is None:
        raise HTTPException(status_code=409, detail="Extract citations before retrieving evidence.")
    run = db.scalar(select(EvidenceRetrievalRun).where(EvidenceRetrievalRun.document_id == document.id))
    if run is not None and run.status == "COMPLETED":
        return _run_response(run)
    if run is not None and run.status == "RUNNING":
        response.status_code = 202
        return _run_response(run)
    try:
        run = retrieve_document_evidence(db, document.id, settings)
    except Exception as exc:
        db.rollback()
        logger.error("Evidence retrieval failed document_id=%s error_type=%s", document.id, type(exc).__name__)
        raise HTTPException(status_code=502, detail="Evidence retrieval failed. The request may be retried.") from exc
    return _run_response(run)


@router.get("/documents/{document_id}/evidence-status", response_model=EvidenceRunResponse)
def evidence_status(document_id: str, db: Session = Depends(get_db)) -> EvidenceRunResponse:
    document = _find(Document, document_id, db, "Document not found.")
    run = db.scalar(select(EvidenceRetrievalRun).where(EvidenceRetrievalRun.document_id == document.id))
    if run is None:
        return EvidenceRunResponse(document_id=document.id, status="NOT_STARTED")
    return _run_response(run)


@router.get("/documents/{document_id}/evidence", response_model=EvidenceListResponse)
def document_evidence(document_id: str, db: Session = Depends(get_db)) -> EvidenceListResponse:
    document = _find(Document, document_id, db, "Document not found.")
    rows = _evidence_rows(db, select(EvidenceRecord).join(Claim).where(Claim.document_id == document.id))
    return EvidenceListResponse(document_id=document.id, evidence=rows, total=len(rows))


@router.get("/claims/{claim_id}/evidence", response_model=EvidenceListResponse)
def claim_evidence(claim_id: str, db: Session = Depends(get_db)) -> EvidenceListResponse:
    claim = _find(Claim, claim_id, db, "Claim not found.")
    rows = _evidence_rows(db, select(EvidenceRecord).where(EvidenceRecord.claim_id == claim.id))
    return EvidenceListResponse(document_id=claim.document_id, claim_id=claim.id, evidence=rows, total=len(rows))


@router.get("/citations/{citation_id}/matches", response_model=list[MatchResponse])
def citation_matches(citation_id: str, db: Session = Depends(get_db)) -> list[MatchResponse]:
    citation = _find(Citation, citation_id, db, "Citation not found.")
    matches = db.scalars(select(SourceMatch).where(SourceMatch.citation_id == citation.id).order_by(SourceMatch.score.desc())).all()
    return [MatchResponse(match_id=m.id, citation_id=m.citation_id, source_id=m.source_id, score=m.score, matching_method=m.matching_method, status=m.status) for m in matches]


@router.get("/sources/{source_id}", response_model=SourceResponse)
def get_source(source_id: str, db: Session = Depends(get_db)) -> SourceResponse:
    source = _find(ResearchSource, source_id, db, "Source not found.")
    identifiers = db.scalars(select(SourceIdentifier).where(SourceIdentifier.source_id == source.id).order_by(SourceIdentifier.provider)).all()
    return SourceResponse(source_id=source.id, doi=source.doi, title=source.title, authors=source.authors, journal=source.journal,
        publication_date=source.publication_date, publication_year=source.publication_year, publication_type=source.publication_type,
        abstract=source.abstract, metadata_status=source.metadata_status,
        identifiers=[{"provider": i.provider, "identifier": i.identifier} for i in identifiers])


def _find(model, object_id: str, db: Session, message: str):
    try: canonical_id = str(UUID(object_id))
    except (ValueError, AttributeError) as exc: raise HTTPException(status_code=404, detail=message) from exc
    obj = db.get(model, canonical_id)
    if obj is None: raise HTTPException(status_code=404, detail=message)
    return obj


def _run_response(run: EvidenceRetrievalRun) -> EvidenceRunResponse:
    return EvidenceRunResponse(document_id=run.document_id, status=run.status, citations_processed=run.citations_processed,
        sources_matched=run.sources_matched, started_at=run.started_at, completed_at=run.completed_at, error=run.error_message)


def _evidence_rows(db: Session, query) -> list[EvidenceResponse]:
    rows = db.execute(query.order_by(EvidenceRecord.retrieved_at, EvidenceRecord.id)).scalars().all()
    result = []
    for record in rows:
        mention = db.get(CitationMention, record.mention_id) if record.mention_id else None
        result.append(EvidenceResponse(evidence_id=record.id, claim_id=record.claim_id, citation_id=record.citation_id,
            source_id=record.source_id, page_number=mention.page_number if mention else None,
            mention_text=mention.mention_text if mention else None, availability=record.availability,
            text=record.retrieved_text, source_url=record.source_url, retrieved_at=record.retrieved_at))
    return result
