from collections.abc import Iterator
from dataclasses import dataclass

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.api.deps import get_request_settings
from app.core.config import Settings
from app.db.session import _make_engine, get_db
from app.main import create_app


@dataclass
class ApiContext:
    client: TestClient
    engine: Engine
    session_factory: sessionmaker[Session]
    settings: Settings


@pytest.fixture
def api(tmp_path) -> Iterator[ApiContext]:
    db_path = tmp_path / "test.db"
    settings = Settings(
        _env_file=None,
        environment="test",
        database_url=f"sqlite:///{db_path.as_posix()}",
        upload_dir=str(tmp_path / "documents"),
        max_upload_size_bytes=2 * 1024 * 1024,
        min_extractable_text_chars=20,
        cors_origins=[],
    )
    engine = _make_engine(settings.database_url)
    session_factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    application = create_app(settings, engine)

    def override_get_db() -> Iterator[Session]:
        with session_factory() as db:
            yield db

    application.dependency_overrides[get_db] = override_get_db
    application.dependency_overrides[get_request_settings] = lambda: settings

    with TestClient(application) as client:
        yield ApiContext(client, engine, session_factory, settings)

    application.dependency_overrides.clear()
    engine.dispose()

