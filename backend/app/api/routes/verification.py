import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_request_settings
from app.core.config import Settings
from app.db.models.document import Document
from app.db.models.extraction import Claim, Citation, CitationMention
from app.db.models.research import EvidenceRecord, ResearchSource, SourceIdentifier
from app.db.models.verification import VerificationEvidenceLink, VerificationResult, VerificationRun
from app.db.session import get_db
from app.schemas.verification import (
    EvidenceReferenceResponse,
    VerificationDocumentResultsResponse,
    VerificationResultResponse,
    VerificationRunResponse,
    VerificationStatusResponse,
)
from app.services.verification_service import verify_claim, verify_document

router = APIRouter(tags=["verification"])
logger = logging.getLogger(__name__)


@router.post("/claims/{claim_id}/verify", response_model=VerificationRunResponse)
def start_claim_verification(claim_id: str, response: Response, db: Session = Depends(get_db),
                             settings: Settings = Depends(get_request_settings)) -> VerificationRunResponse:
    claim = _find(Claim, claim_id, db, "Claim not found.")
    active = _active_run(claim.document_id, db)
    if active is not None:
        response.status_code = 202
        return _run_response(active, db)
    try:
        run = verify_claim(db, claim.id, settings)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        db.rollback()
        logger.error("Verification run failed claim_id=%s error_type=%s", claim.id, type(exc).__name__)
        raise HTTPException(status_code=500, detail="Verification run failed.") from exc
    if run.status == "RUNNING":
        response.status_code = 202
    return _run_response(run, db)


@router.get("/claims/{claim_id}/verification", response_model=VerificationResultResponse)
def get_claim_verification(claim_id: str, db: Session = Depends(get_db)) -> VerificationResultResponse:
    claim = _find(Claim, claim_id, db, "Claim not found.")
    result = db.scalar(select(VerificationResult).where(VerificationResult.claim_id == claim.id)
                       .order_by(VerificationResult.verified_at.desc(), VerificationResult.id.desc()).limit(1))
    if result is None:
        raise HTTPException(status_code=404, detail="No verification result is available for this claim.")
    return _result_response(result, db)


@router.post("/documents/{document_id}/verify", response_model=VerificationRunResponse)
def start_document_verification(document_id: str, response: Response, db: Session = Depends(get_db),
                                settings: Settings = Depends(get_request_settings)) -> VerificationRunResponse:
    document = _find(Document, document_id, db, "Document not found.")
    active = _active_run(document.id, db)
    if active is not None:
        response.status_code = 202
        return _run_response(active, db)
    try:
        run = verify_document(db, document.id, settings)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        db.rollback()
        logger.error("Verification run failed document_id=%s error_type=%s", document.id, type(exc).__name__)
        raise HTTPException(status_code=500, detail="Verification run failed.") from exc
    if run.status == "RUNNING":
        response.status_code = 202
    return _run_response(run, db)


@router.get("/documents/{document_id}/verification-status", response_model=VerificationStatusResponse)
def document_verification_status(document_id: str, db: Session = Depends(get_db)) -> VerificationStatusResponse:
    document = _find(Document, document_id, db, "Document not found.")
    run = db.scalar(select(VerificationRun).where(VerificationRun.document_id == document.id)
                    .order_by(VerificationRun.started_at.desc(), VerificationRun.id.desc()).limit(1))
    if run is None:
        return VerificationStatusResponse(document_id=document.id, status="NOT_STARTED")
    return VerificationStatusResponse(document_id=document.id, status=run.status, run_id=run.id,
        run_type=run.run_type, total_claims=run.total_claims, processed_claims=run.processed_claims,
        failed_claims=run.failed_claims, started_at=run.started_at, completed_at=run.completed_at,
        error=run.error_message)


@router.get("/documents/{document_id}/verification-results", response_model=VerificationDocumentResultsResponse)
def document_verification_results(document_id: str, db: Session = Depends(get_db)) -> VerificationDocumentResultsResponse:
    document = _find(Document, document_id, db, "Document not found.")
    run = db.scalar(select(VerificationRun).where(VerificationRun.document_id == document.id)
                    .order_by(VerificationRun.started_at.desc(), VerificationRun.id.desc()).limit(1))
    if run is None:
        return VerificationDocumentResultsResponse(document_id=document.id, status="NOT_STARTED", results=[], total=0)
    results = db.scalars(select(VerificationResult).where(VerificationResult.run_id == run.id)
                         .order_by(VerificationResult.verified_at, VerificationResult.claim_id)).all()
    return VerificationDocumentResultsResponse(document_id=document.id, run_id=run.id, status=run.status,
        results=[_result_response(item, db) for item in results], total=len(results))


@router.get("/verifications/{verification_id}", response_model=VerificationRunResponse)
def get_verification(verification_id: str, db: Session = Depends(get_db)) -> VerificationRunResponse:
    run = _find(VerificationRun, verification_id, db, "Verification not found.")
    return _run_response(run, db)


def _find(model, object_id: str, db: Session, message: str):
    try:
        canonical_id = str(UUID(object_id))
    except (ValueError, AttributeError) as exc:
        raise HTTPException(status_code=404, detail=message) from exc
    obj = db.get(model, canonical_id)
    if obj is None:
        raise HTTPException(status_code=404, detail=message)
    return obj


def _active_run(document_id: str, db: Session) -> VerificationRun | None:
    return db.scalar(select(VerificationRun).where(VerificationRun.active_document_id == document_id,
                                                    VerificationRun.status == "RUNNING"))


def _run_response(run: VerificationRun, db: Session) -> VerificationRunResponse:
    results = db.scalars(select(VerificationResult).where(VerificationResult.run_id == run.id)
                         .order_by(VerificationResult.verified_at, VerificationResult.claim_id)).all()
    return VerificationRunResponse(verification_id=run.id, document_id=run.document_id,
        requested_claim_id=run.requested_claim_id, run_type=run.run_type, status=run.status,
        total_claims=run.total_claims, processed_claims=run.processed_claims, failed_claims=run.failed_claims,
        error=run.error_message, started_at=run.started_at, completed_at=run.completed_at,
        results=[_result_response(item, db) for item in results])


def _result_response(result: VerificationResult, db: Session) -> VerificationResultResponse:
    links = db.scalars(select(VerificationEvidenceLink).where(VerificationEvidenceLink.result_id == result.id)).all()
    supporting, contradictory, other = [], [], []
    for link in links:
        record = db.get(EvidenceRecord, link.evidence_record_id)
        if record is None:
            continue
        citation = db.get(Citation, record.citation_id)
        source = db.get(ResearchSource, record.source_id) if record.source_id else None
        mention = db.get(CitationMention, record.mention_id) if record.mention_id else None
        identifiers = db.scalars(select(SourceIdentifier).where(SourceIdentifier.source_id == source.id)
                                 .order_by(SourceIdentifier.provider)).all() if source else []
        provider = next((item.provider for item in identifiers if item.provider in {"Crossref", "OpenAlex"}), None)
        reference = EvidenceReferenceResponse(evidence_id=record.id, relation=link.relation,
            excerpt=link.excerpt, rationale=link.rationale, citation_id=citation.id,
            source_id=source.id if source else None, source_title=source.title if source else None,
            doi=source.doi if source else None, provider=provider,
            citation_mention_page_number=mention.page_number if mention else None,
            evidence_availability=record.availability)
        if link.relation in {"DIRECT_SUPPORT", "INDIRECT_SUPPORT", "PARTIAL_SUPPORT"}:
            supporting.append(reference)
        elif link.relation == "CONTRADICTORY":
            contradictory.append(reference)
        else:
            other.append(reference)
    return VerificationResultResponse(verification_id=result.id, run_id=result.run_id,
        claim_id=result.claim_id, document_id=result.claim.document_id, original_claim=result.original_claim,
        verdict=result.verdict, explanation=result.explanation, supporting_evidence=supporting,
        contradictory_evidence=contradictory, other_evidence=other, evidence_limitations=result.limitations,
        confidence_score=result.confidence_score, evidence_availability=result.evidence_availability,
        verification_timestamp=result.verified_at, model_identifier=result.model_identifier,
        prompt_version=result.prompt_version)
