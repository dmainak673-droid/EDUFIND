from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.document import DocumentResponse


class ClaimExtractionResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    claim_id: str = Field(alias="claimId")
    document_id: str = Field(alias="documentId")
    claim_text: str = Field(alias="claimText")
    page_number: int = Field(alias="pageNumber")
    paragraph_context: str = Field(alias="paragraphContext")
    extraction_method: str = Field(alias="extractionMethod")
    confidence_score: float = Field(alias="confidenceScore")
    citation_ids: list[str] = Field(default_factory=list, alias="citationIds")


class ClaimExtractionListResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    document_id: str = Field(alias="documentId")
    claims: list[ClaimExtractionResponse]
    total: int


class CitationExtractionResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    citation_id: str = Field(alias="citationId")
    citation_key: str | None = Field(default=None, alias="citationKey")
    raw_reference: str = Field(alias="rawReference")
    authors: list[str] = Field(default_factory=list)
    title: str | None = None
    publication_year: int | None = Field(default=None, alias="publicationYear")
    doi: str | None = None
    journal: str | None = None
    reference_status: Literal["BIBLIOGRAPHY", "UNMATCHED", "AMBIGUOUS"] = Field(alias="referenceStatus")
    mention_pages: list[int] = Field(default_factory=list, alias="mentionPages")


class CitationExtractionListResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    document_id: str = Field(alias="documentId")
    citations: list[CitationExtractionResponse]
    total: int


class ClaimCitationResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    claim_id: str = Field(alias="claimId")
    citation_id: str = Field(alias="citationId")
    page_number: int = Field(alias="pageNumber")
    mention_text: str = Field(alias="mentionText")
    link_type: Literal["CITATION_MENTION"] = Field(default="CITATION_MENTION", alias="linkType")
    is_verified_evidence: Literal[False] = Field(default=False, alias="isVerifiedEvidence")


class ClaimCitationListResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    document_id: str = Field(alias="documentId")
    links: list[ClaimCitationResponse]
    total: int


class ExtractionStatusResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    document_id: str = Field(alias="documentId")
    status: Literal["NOT_STARTED", "RUNNING", "COMPLETED", "FAILED"]
    claims_detected: int = Field(default=0, alias="claimsDetected")
    citations_identified: int = Field(default=0, alias="citationsIdentified")
    started_at: datetime | None = Field(default=None, alias="startedAt")
    completed_at: datetime | None = Field(default=None, alias="completedAt")
    error: str | None = None


class FrontendCitationReference(BaseModel):
    """Subset compatible with CitationReference; no external resolution is implied."""

    model_config = ConfigDict(populate_by_name=True)

    citation_id: str = Field(alias="citationId")
    title: str = ""
    authors: list[str] = Field(default_factory=list)
    year: int | None = None
    doi: str | None = None
    journal: str | None = None
    resolved: bool = False
    evidence_availability: Literal["FULL_TEXT", "ABSTRACT", "NONE"] = Field(default="NONE", alias="evidenceAvailability")
    abstract_snippet: str | None = Field(default=None, alias="abstractSnippet")
    source_url: str | None = Field(default=None, alias="sourceUrl")
    provider: Literal["Crossref", "OpenAlex", "Unknown"] = "Unknown"
    linked_claim_ids: list[str] = Field(default_factory=list, alias="linkedClaimIds")
    raw_reference: str = Field(alias="rawReference")
    reference_status: Literal["BIBLIOGRAPHY", "UNMATCHED", "AMBIGUOUS"] = Field(alias="referenceStatus")


class DocumentCitationsResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    document: DocumentResponse
    citations: list[FrontendCitationReference]

