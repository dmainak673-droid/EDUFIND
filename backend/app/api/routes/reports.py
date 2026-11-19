from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_request_settings
from app.core.config import Settings
from app.db.models.analysis import AnalysisRun
from app.db.models.document import Document
from app.db.models.report import Report
from app.db.session import get_db
from app.schemas.report import ReportHistoryResponse, ReportResponse
from app.services.report_service import generate_report, report_path

router = APIRouter(tags=["reports"])
_SUCCESSFUL_ANALYSIS_STATUSES = {"COMPLETED", "COMPLETED_WITH_WARNINGS"}


@router.post("/analyses/{analysis_id}/reports", response_model=ReportResponse, status_code=201)
def create_analysis_report(analysis_id: str, db: Session = Depends(get_db),
                           settings: Settings = Depends(get_request_settings)) -> ReportResponse:
    analysis = _analysis(analysis_id, db)
    if analysis.status not in _SUCCESSFUL_ANALYSIS_STATUSES:
        raise HTTPException(status_code=409, detail="A report requires a successfully completed analysis.")
    document = db.get(Document, analysis.document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="Analysis document not found.")
    try:
        report = generate_report(db, analysis, document, settings)
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail="The report could not be generated.") from exc
    return ReportResponse.model_validate(report, from_attributes=True)


@router.get("/analyses/{analysis_id}/reports", response_model=ReportHistoryResponse)
def list_analysis_reports(analysis_id: str, db: Session = Depends(get_db)) -> ReportHistoryResponse:
    analysis = _analysis(analysis_id, db)
    reports = db.scalars(select(Report).where(Report.analysis_id == analysis.id)
                         .order_by(Report.created_at.desc(), Report.id.desc())).all()
    return ReportHistoryResponse(analysis_id=analysis.id,
        reports=[ReportResponse.model_validate(report, from_attributes=True) for report in reports])


@router.get("/reports/{report_id}/download")
def download_report(report_id: str, db: Session = Depends(get_db),
                    settings: Settings = Depends(get_request_settings)) -> FileResponse:
    report = _report(report_id, db)
    path = report_path(settings, report.filename)
    if path is None or not path.is_file():
        raise HTTPException(status_code=404, detail="Report file not found.")
    return FileResponse(path, media_type="application/pdf", filename=report.filename)


def _analysis(analysis_id: str, db: Session) -> AnalysisRun:
    try:
        canonical = str(UUID(analysis_id))
    except (ValueError, AttributeError) as exc:
        raise HTTPException(status_code=404, detail="Analysis not found.") from exc
    analysis = db.get(AnalysisRun, canonical)
    if analysis is None:
        raise HTTPException(status_code=404, detail="Analysis not found.")
    return analysis


def _report(report_id: str, db: Session) -> Report:
    try:
        canonical = str(UUID(report_id))
    except (ValueError, AttributeError) as exc:
        raise HTTPException(status_code=404, detail="Report not found.") from exc
    report = db.get(Report, canonical)
    if report is None:
        raise HTTPException(status_code=404, detail="Report not found.")
    return report
