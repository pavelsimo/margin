"""Database models. State lives in records, not boolean columns."""

from datetime import UTC, datetime, timedelta

import sqlmodel

CODE_TTL = timedelta(minutes=15)
CODE_RATE_LIMIT = 10  # codes per CODE_TTL window per identity


def utcnow() -> datetime:
    """Naive UTC timestamp — SQLite stores datetimes without timezone info."""
    return datetime.now(UTC).replace(tzinfo=None)


class Identity(sqlmodel.SQLModel, table=True):
    """A global login identity — one row per email address."""

    id: int | None = sqlmodel.Field(default=None, primary_key=True)
    email: str = sqlmodel.Field(unique=True, index=True)


class User(sqlmodel.SQLModel, table=True):
    """An application user attached to an identity."""

    id: int | None = sqlmodel.Field(default=None, primary_key=True)
    identity_id: int = sqlmodel.Field(foreign_key="identity.id", index=True)
    display_name: str


class Session(sqlmodel.SQLModel, table=True):
    """An authenticated session; the random token is the credential."""

    id: int | None = sqlmodel.Field(default=None, primary_key=True)
    identity_id: int = sqlmodel.Field(foreign_key="identity.id", index=True)
    user_id: int = sqlmodel.Field(foreign_key="user.id", index=True)
    token: str = sqlmodel.Field(unique=True, index=True)
    created_at: datetime = sqlmodel.Field(default_factory=utcnow)


class MagicLinkCode(sqlmodel.SQLModel, table=True):
    """A short-lived 6-digit sign-in code."""

    id: int | None = sqlmodel.Field(default=None, primary_key=True)
    identity_id: int = sqlmodel.Field(foreign_key="identity.id", index=True)
    value: str = sqlmodel.Field(index=True)
    expires_at: datetime
    created_at: datetime = sqlmodel.Field(default_factory=utcnow)
