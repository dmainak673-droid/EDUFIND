from fastapi import APIRouter, Depends

from app.api.deps import get_request_settings
from app.core.config import Settings

router = APIRouter()


@router.get("/health", tags=["health"])
def health_check(settings: Settings = Depends(get_request_settings)) -> dict[str, str]:
    return {"status": "ok", "version": settings.app_version}

