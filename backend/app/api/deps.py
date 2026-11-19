from fastapi import Request

from app.core.config import Settings


def get_request_settings(request: Request) -> Settings:
    return request.app.state.settings

