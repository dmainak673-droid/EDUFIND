import pytest
from pydantic import ValidationError

from app.core.config import Settings


def test_settings_parse_comma_separated_cors_origins() -> None:
    settings = Settings(_env_file=None, cors_origins="https://app.example, http://localhost:3000")

    assert settings.cors_origins == ["https://app.example", "http://localhost:3000"]


def test_settings_reject_non_positive_upload_limit() -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, max_upload_size_bytes=0)

