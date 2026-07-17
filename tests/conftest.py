from collections.abc import Iterator

import pytest
import sqlmodel

from margin import db as _db  # noqa: F401  — registers the SQLite PRAGMA listener
from margin import models


@pytest.fixture
def db() -> Iterator[sqlmodel.Session]:
    engine = sqlmodel.create_engine("sqlite://")
    models.Identity.metadata.create_all(engine)
    with sqlmodel.Session(engine) as session:
        yield session
    engine.dispose()
