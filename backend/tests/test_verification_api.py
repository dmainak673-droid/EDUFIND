from datetime import UTC, datetime
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app.db.models.document import Document
from app.db.models.extraction import Citation, CitationMention, Claim
from app.db.models.research import EvidenceRecord, ResearchSource, SourceIdentifier
from app.db.models.verification import VerificationEvidenceLink, VerificationResult, VerificationRun
from app.schemas.verification import GeminiAssessment
from app.services.verification_service import verify_claim, verify_document


def _fixture_records(db, evidence_text="The treatment reduced scores by 20%.", availability="ABSTRACT"):
    doc_id, claim_id, citation_id, mention_id, source_id, evidence_id = [str(uuid4()) for _ in range(6)]
    db.add(Document(id=doc_id, original_filename="paper.pdf", stored_filename=f"{uuid4()}.pdf", title="Paper",
        authors=[], pdf_metadata={}, file_size=123, mime_type="application/pdf", page_count=2, extraction_status="EXTRACTED"))
    db.add(Claim(id=claim_id, document_id=doc_id, page_number=2, claim_text="Treatment reduces symptom scores by 20%.",
        paragraph_context="The intervention was associated with change. (Smith, 2024)", extraction_method="RULE_BASED",
        confidence_score=.8, fingerprint="c" * 64))
    db.add(Citation(id=citation_id, document_id=doc_id, citation_key="Smith2024", aliases=["Smith2024"],
        raw_reference="Smith (2024). Trial.", authors=["Smith"], publication_title="Trial", publication_year=2024,
        doi="10.5555/trial", journal="Research", reference_status="BIBLIOGRAPHY", reference_hash="d" * 64))
    db.add(CitationMention(id=mention_id, citation_id=citation_id, page_number=2, char_start=48, char_end=61,
        mention_text="(Smith, 2024)"))
    db.add(ResearchSource(id=source_id, doi="10.5555/trial", title="Trial", normalized_title="trial", authors=[],
        journal="Research", publication_date="2024", publication_year=2024, publication_type="article",
        abstract=evidence_text if availability == "ABSTRACT" else None,
        metadata_status="ABSTRACT" if availability == "ABSTRACT" else "METADATA", provider_payload={}))
    db.flush()
    db.add(SourceIdentifier(source_id=source_id, provider="Crossref", identifier="10.5555/trial"))
    db.add(EvidenceRecord(id=evidence_id, claim_id=claim_id, citation_id=citation_id, source_id=source_id,
        mention_id=mention_id, availability=availability,
        retrieved_text=evidence_text if availability == "ABSTRACT" else None,
        source_url="https://doi.org/10.5555/trial", retrieved_at=datetime.now(UTC)))
    db.commit()
    return doc_id, claim_id, evidence_id


class FakeProvider:
    def __init__(self, verdict="SUPPORTED", evidence_id=None, relation="DIRECT_SUPPORT", excerpt="reduced scores by 20%", explanation=None):
        self.verdict, self.evidence_id, self.relation, self.excerpt = verdict, evidence_id, relation, excerpt
        self.explanation = explanation or "The abstract reports the same measured outcome."
        self.calls = 0

    def assess(self, payload):
        self.calls += 1
        assert payload["assessable_evidence"][0]["availability"] == "ABSTRACT"
        return GeminiAssessment.model_validate({
            "verdict": self.verdict,
            "explanation": self.explanation,
            "evidence_assessments": [{"evidence_id": self.evidence_id, "relation": self.relation,
                                      "excerpt": self.excerpt, "rationale": "This text addresses the stated outcome."}],
            "limitations": [], "confidence_score": .81,
        })


@pytest.mark.parametrize("verdict,relation", [
    ("SUPPORTED", "DIRECT_SUPPORT"),
    ("CONTRADICTED", "CONTRADICTORY"),
    ("PARTIALLY_SUPPORTED", "PARTIAL_SUPPORT"),
    ("INSUFFICIENT_EVIDENCE", "IRRELEVANT"),
    ("UNVERIFIABLE", "IRRELEVANT"),
])
def test_persists_each_verdict_with_existing_evidence_link(api, verdict, relation):
    with api.session_factory() as db:
        _, claim_id, evidence_id = _fixture_records(db)
        provider = FakeProvider(verdict, evidence_id, relation)
        run = verify_claim(db, claim_id, api.settings.model_copy(update={"gemini_model": "mock-model"}), provider)
        assert run.status == "COMPLETED" and run.processed_claims == 1
        result = db.scalar(select(VerificationResult).where(VerificationResult.run_id == run.id))
        assert result.verdict == verdict
        assert result.confidence_score == .81
        assert result.model_identifier == "mock-model"
        assert "abstract-level" in " ".join(result.limitations)
        link = db.scalar(select(VerificationEvidenceLink).where(VerificationEvidenceLink.result_id == result.id))
        assert link.evidence_record_id == evidence_id
        assert link.excerpt == "reduced scores by 20%"


def test_unknown_evidence_id_and_fabricated_excerpt_fail_without_persisting_verdict(api):
    with api.session_factory() as db:
        _, claim_id, _ = _fixture_records(db)
        run = verify_claim(db, claim_id, api.settings, FakeProvider(evidence_id="unknown-evidence"))
        assert run.status == "FAILED" and run.failed_claims == 1
        assert db.scalar(select(func.count()).select_from(VerificationResult)) == 0


def test_fabricated_excerpt_is_rejected(api):
    with api.session_factory() as db:
        _, claim_id, evidence_id = _fixture_records(db)
        run = verify_claim(db, claim_id, api.settings,
                           FakeProvider(evidence_id=evidence_id, excerpt="The treatment cured everyone."))
        assert run.status == "FAILED" and run.failed_claims == 1
        assert db.scalar(select(func.count()).select_from(VerificationResult)) == 0
        assert db.scalar(select(func.count()).select_from(VerificationEvidenceLink)) == 0


def test_supported_without_direct_excerpt_is_downgraded_to_abstention(api):
    with api.session_factory() as db:
        _, claim_id, evidence_id = _fixture_records(db)
        run = verify_claim(db, claim_id, api.settings, FakeProvider(evidence_id=evidence_id, relation="INDIRECT_SUPPORT"))
        result = db.scalar(select(VerificationResult).where(VerificationResult.run_id == run.id))
        assert result.verdict == "INSUFFICIENT_EVIDENCE"
        assert "did not provide a directly supporting" in result.explanation


def test_missing_abstract_abstains_without_gemini_and_metadata_is_not_sent(api):
    with api.session_factory() as db:
        _, claim_id, _ = _fixture_records(db, availability="METADATA_ONLY")
        run = verify_claim(db, claim_id, api.settings)
        result = db.scalar(select(VerificationResult).where(VerificationResult.run_id == run.id))
        assert run.status == "COMPLETED"
        assert result.verdict == "INSUFFICIENT_EVIDENCE"
        assert result.evidence_availability == "METADATA_ONLY"
        assert result.model_identifier == "rule-based-no-evidence"


def test_document_run_is_single_active_and_api_contracts_are_traceable(api, monkeypatch):
    from app.api.routes import verification as routes
    with api.session_factory() as db:
        doc_id, claim_id, evidence_id = _fixture_records(db)
    provider = FakeProvider(evidence_id=evidence_id)
    monkeypatch.setattr(routes, "verify_document", lambda db, document_id, settings: verify_document(
        db, document_id, settings, provider=provider))
    response = api.client.post(f"/api/documents/{doc_id}/verify")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "COMPLETED" and body["totalClaims"] == 1
    assert body["results"][0]["verdict"] == "SUPPORTED"
    assert body["results"][0]["supportingEvidence"][0]["evidenceId"] == evidence_id
    assert body["results"][0]["supportingEvidence"][0]["citationMentionPageNumber"] == 2
    assert api.client.get(f"/api/claims/{claim_id}/verification").json()["verdict"] == "SUPPORTED"
    assert api.client.get(f"/api/documents/{doc_id}/verification-status").json()["status"] == "COMPLETED"
    results = api.client.get(f"/api/documents/{doc_id}/verification-results").json()
    assert results["total"] == 1 and results["results"][0]["claimId"] == claim_id
    assert api.client.get(f"/api/verifications/{body['verificationId']}").status_code == 200

    claim_provider = FakeProvider(evidence_id=evidence_id)
    monkeypatch.setattr(routes, "verify_claim", lambda db, claim_id, settings: verify_claim(
        db, claim_id, settings, provider=claim_provider))
    claim_run = api.client.post(f"/api/claims/{claim_id}/verify")
    assert claim_run.status_code == 200 and claim_run.json()["runType"] == "CLAIM"
    assert claim_run.json()["results"][0]["originalClaim"] == "Treatment reduces symptom scores by 20%."


def test_active_duplicate_request_returns_existing_run(api):
    with api.session_factory() as db:
        doc_id, claim_id, _ = _fixture_records(db)
        run = VerificationRun(id=str(uuid4()), document_id=doc_id, requested_claim_id=claim_id,
            active_document_id=doc_id, run_type="CLAIM", status="RUNNING", total_claims=1,
            processed_claims=0, failed_claims=0, started_at=datetime.now(UTC))
        db.add(run)
        db.commit()
    response = api.client.post(f"/api/claims/{claim_id}/verify")
    assert response.status_code == 202
    assert response.json()["verificationId"] == run.id


def test_document_delete_cascades_verification_records_and_evidence_links(api):
    with api.session_factory() as db:
        doc_id, claim_id, evidence_id = _fixture_records(db)
        run = verify_claim(db, claim_id, api.settings, FakeProvider(evidence_id=evidence_id))
        assert db.scalar(select(func.count()).select_from(VerificationEvidenceLink)) == 1
    assert api.client.delete(f"/api/documents/{doc_id}").status_code == 204
    with api.session_factory() as db:
        assert db.scalar(select(func.count()).select_from(VerificationRun)) == 0
        assert db.scalar(select(func.count()).select_from(VerificationResult)) == 0
        assert db.scalar(select(func.count()).select_from(VerificationEvidenceLink)) == 0
        assert db.scalar(select(func.count()).select_from(ResearchSource)) == 1
