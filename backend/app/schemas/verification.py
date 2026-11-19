from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field


class VerificationVerdict(StrEnum):
    SUPPORTED = "SUPPORTED"
    CONTRADICTED = "CONTRADICTED"
    PARTIALLY_SUPPORTED = "PARTIALLY_SUPPORTED"
    INSUFFICIENT_EVIDENCE = "INSUFFICIENT_EVIDENCE"
    UNVERIFIABLE = "UNVERIFIABLE"


class EvidenceRelation(StrEnum):
    DIRECT_SUPPORT = "DIRECT_SUPPORT"
    INDIRECT_SUPPORT = "INDIRECT_SUPPORT"
    PARTIAL_SUPPORT = "PARTIAL_SUPPORT"
    CONTRADICTORY = "CONTRADICTORY"
    IRRELEVANT = "IRRELEVANT"


class GeminiEvidenceAssessment(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    evidence_id: str = Field(min_length=1, max_length=36, description="An ID from the supplied assessable evidence list.")
    relation: EvidenceRelation
    excerpt: str = Field(min_length=3, max_length=500, description="Verbatim excerpt copied from that evidence abstract.")
    rationale: str = Field(min_length=1, max_length=500)


class GeminiAssessment(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    verdict: VerificationVerdict
    explanation: str = Field(min_length=10, max_length=2000)
    evidence_assessments: list[GeminiEvidenceAssessment] = Field(max_length=20)
    limitations: list[str] = Field(max_length=20)
    confidence_score: float = Field(ge=0, le=1, description="Confidence in this assessment, not probability that the claim is true.")


class EvidenceReferenceResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    evidence_id: str = Field(alias="evidenceId")
    relation: EvidenceRelation
    excerpt: str
    rationale: str
    citation_id: str = Field(alias="citationId")
    source_id: str | None = Field(default=None, alias="sourceId")
    source_title: str | None = Field(default=None, alias="sourceTitle")
    doi: str | None = None
    provider: str | None = None
    citation_mention_page_number: int | None = Field(default=None, alias="citationMentionPageNumber")
    evidence_availability: str = Field(alias="evidenceAvailability")


class VerificationResultResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    verification_id: str = Field(alias="verificationId")
    run_id: str = Field(alias="runId")
    claim_id: str = Field(alias="claimId")
    document_id: str = Field(alias="documentId")
    original_claim: str = Field(alias="originalClaim")
    verdict: VerificationVerdict
    explanation: str
    supporting_evidence: list[EvidenceReferenceResponse] = Field(default_factory=list, alias="supportingEvidence")
    contradictory_evidence: list[EvidenceReferenceResponse] = Field(default_factory=list, alias="contradictoryEvidence")
    other_evidence: list[EvidenceReferenceResponse] = Field(default_factory=list, alias="otherEvidence")
    evidence_limitations: list[str] = Field(default_factory=list, alias="evidenceLimitations")
    confidence_score: float = Field(alias="confidenceScore")
    evidence_availability: str = Field(alias="evidenceAvailability")
    verification_timestamp: datetime = Field(alias="verificationTimestamp")
    model_identifier: str = Field(alias="modelIdentifier")
    prompt_version: str = Field(alias="promptVersion")


class VerificationRunResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    verification_id: str = Field(alias="verificationId")
    document_id: str = Field(alias="documentId")
    requested_claim_id: str | None = Field(default=None, alias="requestedClaimId")
    run_type: str = Field(alias="runType")
    status: str
    total_claims: int = Field(alias="totalClaims")
    processed_claims: int = Field(alias="processedClaims")
    failed_claims: int = Field(alias="failedClaims")
    error: str | None = None
    started_at: datetime = Field(alias="startedAt")
    completed_at: datetime | None = Field(default=None, alias="completedAt")
    results: list[VerificationResultResponse] = Field(default_factory=list)


class VerificationStatusResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    document_id: str = Field(alias="documentId")
    status: str
    run_id: str | None = Field(default=None, alias="runId")
    run_type: str | None = Field(default=None, alias="runType")
    total_claims: int = Field(default=0, alias="totalClaims")
    processed_claims: int = Field(default=0, alias="processedClaims")
    failed_claims: int = Field(default=0, alias="failedClaims")
    started_at: datetime | None = Field(default=None, alias="startedAt")
    completed_at: datetime | None = Field(default=None, alias="completedAt")
    error: str | None = None


class VerificationDocumentResultsResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    document_id: str = Field(alias="documentId")
    run_id: str | None = Field(default=None, alias="runId")
    status: str
    results: list[VerificationResultResponse]
    total: int
