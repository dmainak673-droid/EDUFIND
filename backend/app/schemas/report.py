from datetime import datetime

from pydantic import AliasChoices, BaseModel, ConfigDict, Field


class ReportResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    report_id: str = Field(validation_alias=AliasChoices("id", "report_id"), serialization_alias="reportId")
    analysis_id: str = Field(alias="analysisId")
    filename: str
    file_size: int = Field(alias="fileSize")
    created_at: datetime = Field(alias="createdAt")


class ReportHistoryResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    analysis_id: str = Field(alias="analysisId")
    reports: list[ReportResponse]
