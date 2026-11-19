from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class EvidenceRunResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    document_id: str = Field(alias="documentId")
    status: Literal["NOT_STARTED", "RUNNING", "COMPLETED", "PARTIAL", "FAILED"]
    citations_processed: int = Field(default=0, alias="citationsProcessed")
    sources_matched: int = Field(default=0, alias="sourcesMatched")
    started_at: datetime | None = Field(default=None, alias="startedAt")
    completed_at: datetime | None = Field(default=None, alias="completedAt")
    error: str | None = None


class MatchResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    match_id: str = Field(alias="matchId")
    citation_id: str = Field(alias="citationId")
    source_id: str | None = Field(alias="sourceId")
    score: float
    matching_method: str = Field(alias="matchingMethod")
    status: Literal["MATCHED", "POSSIBLE", "UNMATCHED"]


class SourceResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    source_id: str = Field(alias="sourceId")
    doi: str | None = None
    title: str | None = None
    authors: list[dict] = Field(default_factory=list)
    journal: str | None = None
    publication_date: str | None = Field(default=None, alias="publicationDate")
    publication_year: int | None = Field(default=None, alias="publicationYear")
    publication_type: str | None = Field(default=None, alias="publicationType")
    abstract: str | None = None
    metadata_status: Literal["METADATA", "ABSTRACT", "UNAVAILABLE"] = Field(alias="metadataStatus")
    identifiers: list[dict] = Field(default_factory=list)


class EvidenceResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    evidence_id: str = Field(alias="evidenceId")
    claim_id: str = Field(alias="claimId")
    citation_id: str = Field(alias="citationId")
    source_id: str | None = Field(alias="sourceId")
    page_number: int | None = Field(default=None, alias="pageNumber")
    mention_text: str | None = Field(default=None, alias="mentionText")
    availability: Literal["METADATA_ONLY", "ABSTRACT", "UNAVAILABLE"]
    text: str | None = None
    source_url: str | None = Field(default=None, alias="sourceUrl")
    retrieved_at: datetime = Field(alias="retrievedAt")


class EvidenceListResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    document_id: str | None = Field(default=None, alias="documentId")
    claim_id: str | None = Field(default=None, alias="claimId")
    evidence: list[EvidenceResponse]
    total: int
