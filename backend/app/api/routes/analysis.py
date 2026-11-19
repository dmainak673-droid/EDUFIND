from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_request_settings
from app.core.config import Settings
from app.db.models.analysis import AnalysisRun
from app.db.models.document import Document
from app.db.session import get_db
from app.schemas.analysis import AnalysisHistoryResponse, AnalysisResultResponse, AnalysisRunResponse
from app.services.analysis_pipeline import AnalysisBusyError, create_analysis, retry_analysis

router = APIRouter(tags=["analysis"])


@router.post("/documents/{document_id}/analyze", response_model=AnalysisRunResponse)
def analyze_document(document_id: str, response: Response, db: Session = Depends(get_db),
                     settings: Settings = Depends(get_request_settings)) -> AnalysisRunResponse:
    document = _document(document_id, db)
    try:
        run, created = create_analysis(db, document.id, settings)
    except AnalysisBusyError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail="Analysis could not be started.") from exc
    if run.status in {"QUEUED", "VALIDATING", "EXTRACTING", "EXTRACTING_CLAIMS", "RETRIEVING_EVIDENCE", "VERIFYING"}:
        response.status_code = 202
    return AnalysisRunResponse.model_validate(run, from_attributes=True)


@router.get("/documents/{document_id}/analysis-status", response_model=AnalysisRunResponse)
def analysis_status(document_id: str, db: Session = Depends(get_db)) -> AnalysisRunResponse:
    document = _document(document_id, db)
    run = db.scalar(select(AnalysisRun).where(AnalysisRun.document_id == document.id)
                    .order_by(AnalysisRun.created_at.desc(), AnalysisRun.id.desc()))
    if run is None:
        raise HTTPException(status_code=404, detail="No analysis has been started for this document.")
    return AnalysisRunResponse.model_validate(run, from_attributes=True)


@router.get("/documents/{document_id}/analyses", response_model=AnalysisHistoryResponse)
def analysis_history(document_id: str, db: Session = Depends(get_db)) -> AnalysisHistoryResponse:
    document = _document(document_id, db)
    runs = db.scalars(select(AnalysisRun).where(AnalysisRun.document_id == document.id)
                      .order_by(AnalysisRun.created_at.desc(), AnalysisRun.id.desc())).all()
    return AnalysisHistoryResponse(document_id=document.id,
        analyses=[AnalysisRunResponse.model_validate(run, from_attributes=True) for run in runs])


@router.get("/analyses/{analysis_id}", response_model=AnalysisResultResponse)
def analysis_result(analysis_id: str, db: Session = Depends(get_db)) -> AnalysisResultResponse:
    run = _analysis(analysis_id, db)
    summary = AnalysisRunResponse.model_validate(run, from_attributes=True).model_dump(by_alias=True)
    summary["results"] = run.verdict_details
    return AnalysisResultResponse.model_validate(summary)


@router.post("/analyses/{analysis_id}/retry", response_model=AnalysisRunResponse)
def retry(analysis_id: str, response: Response, db: Session = Depends(get_db),
          settings: Settings = Depends(get_request_settings)) -> AnalysisRunResponse:
    run = _analysis(analysis_id, db)
    try:
        run = retry_analysis(db, run, settings)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail="Analysis retry failed.") from exc
    if run.status in {"QUEUED", "VALIDATING", "EXTRACTING", "EXTRACTING_CLAIMS", "RETRIEVING_EVIDENCE", "VERIFYING"}:
        response.status_code = 202
    return AnalysisRunResponse.model_validate(run, from_attributes=True)


def _document(document_id: str, db: Session) -> Document:
    try:
        canonical = str(UUID(document_id))
    except (ValueError, AttributeError) as exc:
        raise HTTPException(status_code=404, detail="Document not found.") from exc
    document = db.get(Document, canonical)
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found.")
    return document


def _analysis(analysis_id: str, db: Session) -> AnalysisRun:
    try:
        canonical = str(UUID(analysis_id))
    except (ValueError, AttributeError) as exc:
        raise HTTPException(status_code=404, detail="Analysis not found.") from exc
    run = db.get(AnalysisRun, canonical)
    if run is None:
        raise HTTPException(status_code=404, detail="Analysis not found.")
    return run
