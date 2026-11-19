from __future__ import annotations

import logging
import re
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db.models.extraction import Claim
from app.db.models.document import Document
from app.db.models.research import EvidenceRecord
from app.db.models.verification import VerificationEvidenceLink, VerificationResult, VerificationRun
from app.schemas.verification import GeminiAssessment
from app.services.gemini_provider import PROMPT_VERSION, GeminiProvider, GeminiProviderError

logger = logging.getLogger(__name__)
MAX_ABSTRACT_RECORDS = 12
MAX_ABSTRACT_CHARS = 8000


class AssessmentValidationError(Exception):
    """The generated assessment cannot be grounded in the supplied records."""


def verify_claim(db: Session, claim_id: str, settings: Settings, provider: Any | None = None) -> VerificationRun:
    claim = db.get(Claim, claim_id)
    if claim is None:
        raise LookupError("Claim not found")
    document = db.get(Document, claim.document_id)
    return _run_verification(db, document, [claim], "CLAIM", claim.id, settings, provider)


def verify_document(db: Session, document_id: str, settings: Settings, provider: Any | None = None) -> VerificationRun:
    document = db.get(Document, document_id)
    if document is None:
        raise LookupError("Document not found")
    claims = db.scalars(select(Claim).where(Claim.document_id == document.id).order_by(Claim.page_number, Claim.id)).all()
    if not claims:
        raise ValueError("No extracted claims are available for verification")
    return _run_verification(db, document, claims, "DOCUMENT", None, settings, provider)


def _run_verification(db: Session, document: Document, claims: list[Claim], run_type: str,
                      requested_claim_id: str | None, settings: Settings, provider: Any | None) -> VerificationRun:
    run = VerificationRun(
        id=str(uuid4()), document_id=document.id, requested_claim_id=requested_claim_id,
        active_document_id=document.id, run_type=run_type, status="RUNNING", total_claims=len(claims),
        started_at=datetime.now(UTC),
    )
    db.add(run)
    try:
        db.commit()
        db.refresh(run)
    except IntegrityError:
        db.rollback()
        active = db.scalar(select(VerificationRun).where(
            VerificationRun.active_document_id == document.id, VerificationRun.status == "RUNNING"
        ))
        if active is not None:
            return active
        raise

    owns_provider = provider is None
    provider_error: GeminiProviderError | None = None
    try:
        for claim in claims:
            try:
                evidence_records = db.scalars(select(EvidenceRecord).where(EvidenceRecord.claim_id == claim.id)
                                              .order_by(EvidenceRecord.retrieved_at, EvidenceRecord.id)).all()
                assessable = [record for record in evidence_records
                              if record.availability in {"ABSTRACT", "FULL_TEXT"} and record.retrieved_text]
                if not assessable:
                    result, links = _no_evidence_result(claim, run.id, evidence_records)
                else:
                    records = assessable[:MAX_ABSTRACT_RECORDS]
                    omitted = len(assessable) - len(records)
                    if provider is None:
                        if provider_error is None:
                            try:
                                provider = GeminiProvider(settings)
                            except GeminiProviderError as exc:
                                provider_error = exc
                        if provider_error is not None:
                            raise provider_error
                    payload, record_map = _model_payload(claim, records)
                    assessment = provider.assess(payload)
                    result, links = _validated_result(claim, run.id, settings.gemini_model, assessment,
                                                       records, record_map, evidence_records, omitted)
                db.add(result)
                db.flush()
                db.add_all(VerificationEvidenceLink(result_id=result.id, evidence_record_id=evidence_id,
                    relation=relation, excerpt=excerpt, rationale=rationale)
                    for evidence_id, relation, excerpt, rationale in links)
                run.processed_claims += 1
                db.commit()
            except Exception as exc:
                db.rollback()
                run = db.get(VerificationRun, run.id)
                run.failed_claims += 1
                run.error_message = "One or more claims could not be verified; inspect status and retry."
                logger.warning("Claim verification failed claim_id=%s error_type=%s error_kind=%s",
                               claim.id, type(exc).__name__, getattr(exc, "kind", "validation"))
                db.commit()
        run = db.get(VerificationRun, run.id)
        run.status = "FAILED" if run.failed_claims == run.total_claims else "PARTIAL" if run.failed_claims else "COMPLETED"
        run.active_document_id = None
        run.completed_at = datetime.now(UTC)
        db.commit()
        db.refresh(run)
        return run
    except Exception:
        db.rollback()
        run = db.get(VerificationRun, run.id)
        if run is not None:
            run.status = "FAILED"
            run.active_document_id = None
            run.error_message = "Verification run failed. The request may be retried."
            run.completed_at = datetime.now(UTC)
            db.commit()
        raise
    finally:
        if owns_provider and provider is not None:
            try:
                provider.close()
            except Exception:
                logger.warning("Could not close Gemini provider client")


def _evidence_availability(records: list[EvidenceRecord]) -> str:
    available = {r.availability for r in records}
    if "FULL_TEXT" in available:
        return "FULL_TEXT"
    if "ABSTRACT" in available and any(r.retrieved_text for r in records):
        return "ABSTRACT"
    if available.intersection({"ABSTRACT", "METADATA_ONLY"}):
        return "METADATA_ONLY"
    return "NONE"


def _no_evidence_result(claim: Claim, run_id: str, records: list[EvidenceRecord]) -> tuple[VerificationResult, list]:
    limitations = ["No abstract or full-text evidence was available; publication metadata is not scientific evidence.",
                   "EDUFIND does not retrieve full text in this phase."]
    return VerificationResult(
        id=str(uuid4()), run_id=run_id, claim_id=claim.id, original_claim=claim.claim_text,
        verdict="INSUFFICIENT_EVIDENCE",
        explanation="No assessable abstract or full-text evidence is available for this claim, so EDUFIND abstained.",
        confidence_score=0.0, evidence_availability=_evidence_availability(records), limitations=limitations,
        model_identifier="rule-based-no-evidence", prompt_version=PROMPT_VERSION, verified_at=datetime.now(UTC),
    ), []


def _model_payload(claim: Claim, records: list[EvidenceRecord]) -> tuple[dict[str, Any], dict[str, EvidenceRecord]]:
    evidence = []
    record_map = {}
    for record in records:
        source = record.source
        citation = record.citation
        record_map[record.id] = record
        # Only the returned abstract/full text is assessable. Bibliographic fields are labels, never evidence.
        evidence.append({
            "evidence_id": record.id,
            "availability": record.availability,
            "source_title_label_only": source.title if source else None,
            "doi_label_only": source.doi if source else None,
            "provider_identifiers_label_only": [i.identifier for i in source.identifiers] if source else [],
            "abstract_or_text": record.retrieved_text[:MAX_ABSTRACT_CHARS],
            "citation_id_provenance_only": citation.id,
        })
    return {
        "claim_text_untrusted_data": claim.claim_text[:4000],
        "paragraph_context_untrusted_data": claim.paragraph_context[:8000],
        "assessable_evidence": evidence,
    }, record_map


def _normalized_quote(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def _validated_result(claim: Claim, run_id: str, model_id: str, assessment: GeminiAssessment,
                      assessable_records: list[EvidenceRecord], record_map: dict[str, EvidenceRecord],
                      all_records: list[EvidenceRecord], omitted: int) -> tuple[VerificationResult, list]:
    links: list[tuple[str, str, str, str]] = []
    seen: set[str] = set()
    for reference in assessment.evidence_assessments:
        record = record_map.get(reference.evidence_id)
        if record is None:
            raise AssessmentValidationError("Gemini referenced an evidence record that was not supplied")
        if reference.evidence_id in seen:
            raise AssessmentValidationError("Gemini returned a duplicate evidence reference")
        if _normalized_quote(reference.excerpt) not in _normalized_quote(record.retrieved_text or ""):
            raise AssessmentValidationError("Gemini returned an excerpt not found in the supplied evidence")
        seen.add(reference.evidence_id)
        links.append((record.id, reference.relation.value, reference.excerpt, reference.rationale))

    relations = {relation for _, relation, _, _ in links}
    verdict = assessment.verdict.value
    explanation = assessment.explanation
    if verdict == "SUPPORTED" and "DIRECT_SUPPORT" not in relations:
        verdict = "INSUFFICIENT_EVIDENCE"
        explanation = "The model did not provide a directly supporting evidence excerpt; EDUFIND abstained."
    elif verdict == "CONTRADICTED" and "CONTRADICTORY" not in relations:
        verdict = "INSUFFICIENT_EVIDENCE"
        explanation = "The model did not provide a contradictory evidence excerpt; EDUFIND abstained."
    elif verdict == "PARTIALLY_SUPPORTED" and not relations.intersection({"DIRECT_SUPPORT", "INDIRECT_SUPPORT", "PARTIAL_SUPPORT"}):
        verdict = "INSUFFICIENT_EVIDENCE"
        explanation = "The model did not provide a supporting evidence excerpt; EDUFIND abstained."

    limitations = list(dict.fromkeys(assessment.limitations))
    if any(r.availability == "ABSTRACT" for r in assessable_records):
        limitations.append("Assessment used abstract-level text only; the full paper, methods, tables, and supplementary materials were not examined.")
    if omitted:
        limitations.append(f"{omitted} additional evidence record(s) were omitted from the model input due to the per-claim context limit.")
    limitations.append("Confidence is confidence in the assessment, not a probability that the scientific claim is true.")

    result = VerificationResult(
        id=str(uuid4()), run_id=run_id, claim_id=claim.id, original_claim=claim.claim_text,
        verdict=verdict, explanation=explanation, confidence_score=assessment.confidence_score,
        evidence_availability=_evidence_availability(all_records), limitations=list(dict.fromkeys(limitations)),
        model_identifier=model_id, prompt_version=PROMPT_VERSION, verified_at=datetime.now(UTC),
    )
    return result, links
