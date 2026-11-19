from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class DocumentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: str
    title: str
    authors: list[str] = Field(default_factory=list)
    publication_info: str | None = Field(default=None, alias="publicationInfo")
    file_name: str = Field(alias="fileName")
    file_size_bytes: int = Field(alias="fileSizeBytes")
    uploaded_at: datetime = Field(alias="uploadedAt")
    status: Literal["UPLOADED", "PROCESSING", "COMPLETED", "FAILED"] = "UPLOADED"
    page_count: int = Field(alias="pageCount")
    total_claims: int = Field(default=0, alias="totalClaims")
    total_citations: int = Field(default=0, alias="totalCitations")
    resolved_citations: int = Field(default=0, alias="resolvedCitations")
    unresolved_citations: int = Field(default=0, alias="unresolvedCitations")
    extraction_status: str = Field(alias="extractionStatus")
    extraction_warning: str | None = Field(default=None, alias="extractionWarning")


class DocumentListResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    documents: list[DocumentResponse]
    page: int
    page_size: int = Field(alias="pageSize")
    total: int


class UploadResponse(BaseModel):
    # These snake_case fields preserve the existing src/api/verification.ts contract.
    document_id: str
    filename: str
    size: int
    title: str
    status: Literal["UPLOADED"]
    page_count: int
    extraction_status: str
    extraction_warning: str | None = None

