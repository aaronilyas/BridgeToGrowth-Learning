"""SQLAlchemy engine and session helpers for the backend."""

from __future__ import annotations

import getpass
import os
from collections.abc import Generator

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker


def _database_url() -> str:
    # Local convenience for the disposable development database. Deployed
    # environments should set DATABASE_URL to their managed PostgreSQL URL.
    return os.environ.get(
        "DATABASE_URL",
        f"postgresql+psycopg://{getpass.getuser()}@localhost:5432/bridgetogrowth_learning_dev",
    )


engine: Engine = create_engine(_database_url(), pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    """Yield a request-scoped session; callers own transaction boundaries."""
    with SessionLocal() as session:
        yield session


def check_database_connection() -> bool:
    """Return True when the configured PostgreSQL database accepts queries."""
    with engine.connect() as connection:
        connection.execute(text("SELECT 1"))
    return True
