from __future__ import annotations

from datetime import datetime

from pydantic import AliasChoices, BaseModel, ConfigDict, Field


class AnalysisVerdictResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    claim_id: str = Field(alias="claimId")
    original_claim: str = Field(alias="originalClaim")
    claim_page_number: int | None = Field(default=None, alias="claimPageNumber")
    claim_context: str | None = Field(default=None, alias="claimContext")
    verdict: str
    explanation: str
    confidence_score: float = Field(alias="confidenceScore")
    evidence_availability: str = Field(alias="evidenceAvailability")
    limitations: list[str]
    evidence: list["AnalysisEvidenceSnapshotResponse"] = Field(default_factory=list)
    model_identifier: str = Field(alias="modelIdentifier")
    prompt_version: str = Field(alias="promptVersion")
    verified_at: datetime = Field(alias="verifiedAt")


class AnalysisEvidenceSnapshotResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    evidence_id: str = Field(alias="evidenceId")
    relation: str
    excerpt: str
    rationale: str
    evidence_availability: str = Field(alias="evidenceAvailability")
    citation_id: str = Field(alias="citationId")
    citation_title: str | None = Field(alias="citationTitle")
    citation_authors: list[str] = Field(alias="citationAuthors")
    citation_year: int | None = Field(alias="citationYear")
    citation_journal: str | None = Field(alias="citationJournal")
    citation_doi: str | None = Field(alias="citationDoi")
    raw_reference: str = Field(alias="rawReference")
    citation_mention_page_number: int | None = Field(alias="citationMentionPageNumber")
    citation_mention_text: str | None = Field(alias="citationMentionText")
    source_id: str | None = Field(alias="sourceId")
    source_title: str | None = Field(alias="sourceTitle")
    source_doi: str | None = Field(alias="sourceDoi")
    source_provider: str | None = Field(alias="sourceProvider")
    source_authors: list[dict[str, object]] = Field(alias="sourceAuthors")
    source_journal: str | None = Field(alias="sourceJournal")
    source_year: int | None = Field(alias="sourceYear")
    source_identifiers: list[dict[str, str]] = Field(alias="sourceIdentifiers")
    source_url: str | None = Field(alias="sourceUrl")


AnalysisVerdictResponse.model_rebuild()


class AnalysisStageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)
    stage_key: str = Field(alias="stageKey")
    position: int
    status: str
    attempts: int
    output_run_id: str | None = Field(alias="outputRunId")
    started_at: datetime | None = Field(alias="startedAt")
    completed_at: datetime | None = Field(alias="completedAt")
    error_code: str | None = Field(alias="errorCode")
    error_message: str | None = Field(alias="errorMessage")


class AnalysisRunResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)
    analysis_id: str = Field(
        validation_alias=AliasChoices("id", "analysisId"),
        serialization_alias="analysisId",
    )
    document_id: str = Field(alias="documentId")
    status: str
    current_stage: str | None = Field(alias="currentStage")
    progress_percent: int = Field(alias="progressPercent")
    retry_count: int = Field(alias="retryCount")
    warning_count: int = Field(alias="warningCount")
    error_message: str | None = Field(alias="errorMessage")
    created_at: datetime = Field(alias="createdAt")
    started_at: datetime | None = Field(alias="startedAt")
    completed_at: datetime | None = Field(alias="completedAt")
    stages: list[AnalysisStageResponse]
    claims_detected: int = Field(alias="claimsDetected")
    citations_identified: int = Field(alias="citationsIdentified")
    evidence_records: int = Field(alias="evidenceRecords")
    verification_results: int = Field(alias="verificationResults")
    verdict_counts: dict[str, int] = Field(alias="verdictCounts")


class AnalysisHistoryResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    document_id: str = Field(alias="documentId")
    analyses: list[AnalysisRunResponse]


class AnalysisResultResponse(AnalysisRunResponse):
    results: list[AnalysisVerdictResponse]
