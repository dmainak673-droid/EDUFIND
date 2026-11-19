from functools import lru_cache
from typing import Annotated

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "EDUFIND API"
    app_version: str = "0.1.0"
    environment: str = "development"
    database_url: str = "sqlite:///./edufind.db"
    upload_dir: str = "./uploads"
    max_upload_size_bytes: int = 50 * 1024 * 1024
    min_extractable_text_chars: int = 100
    cors_origins: Annotated[list[str], NoDecode] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]
    log_level: str = "INFO"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    @field_validator("max_upload_size_bytes")
    @classmethod
    def validate_upload_limit(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("MAX_UPLOAD_SIZE_BYTES must be greater than zero")
        return value

    @field_validator("min_extractable_text_chars")
    @classmethod
    def validate_minimum_text(cls, value: int) -> int:
        if value < 0:
            raise ValueError("MIN_EXTRACTABLE_TEXT_CHARS cannot be negative")
        return value

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()

