"""Magic-link authentication domain logic. Plain functions — no Reflex runtime needed."""

import re
import secrets

import sqlmodel

from .models import CODE_RATE_LIMIT, CODE_TTL, Identity, MagicLinkCode, Session, User, utcnow

EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def normalize_email(email: str) -> str:
    return email.strip().lower()


def valid_email(email: str) -> bool:
    return EMAIL_PATTERN.match(normalize_email(email)) is not None


def find_or_create_identity(db: sqlmodel.Session, email: str) -> Identity:
    email = normalize_email(email)
    identity = db.exec(sqlmodel.select(Identity).where(Identity.email == email)).first()
    if identity is None:
        identity = Identity(email=email)
        db.add(identity)
        db.commit()
        db.refresh(identity)
    return identity


def issue_code(db: sqlmodel.Session, identity: Identity) -> MagicLinkCode | None:
    """Create a sign-in code, or None when the identity is over the rate limit."""
    window_start = utcnow() - CODE_TTL
    recent = db.exec(
        sqlmodel.select(MagicLinkCode).where(
            MagicLinkCode.identity_id == identity.id,
            MagicLinkCode.created_at > window_start,
        )
    ).all()
    if len(recent) >= CODE_RATE_LIMIT:
        return None
    assert identity.id is not None
    code = MagicLinkCode(
        identity_id=identity.id,
        value=f"{secrets.randbelow(1_000_000):06d}",
        expires_at=utcnow() + CODE_TTL,
    )
    db.add(code)
    db.commit()
    db.refresh(code)
    return code


def verify_code(db: sqlmodel.Session, email: str, value: str) -> Session | None:
    """Exchange a valid code for a session; None when the code is wrong or expired."""
    email = normalize_email(email)
    identity = db.exec(sqlmodel.select(Identity).where(Identity.email == email)).first()
    if identity is None:
        return None
    code = db.exec(
        sqlmodel.select(MagicLinkCode).where(
            MagicLinkCode.identity_id == identity.id,
            MagicLinkCode.value == value.strip(),
            MagicLinkCode.expires_at > utcnow(),
        )
    ).first()
    if code is None:
        return None
    assert identity.id is not None
    user = db.exec(sqlmodel.select(User).where(User.identity_id == identity.id)).first()
    if user is None:
        user = User(identity_id=identity.id, display_name=email.split("@")[0])
        db.add(user)
        db.commit()
        db.refresh(user)
    assert user.id is not None
    db.delete(code)  # codes are single-use
    session = Session(identity_id=identity.id, user_id=user.id, token=secrets.token_hex(32))
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def find_session_by_token(db: sqlmodel.Session, token: str) -> Session | None:
    if not token:
        return None
    return db.exec(sqlmodel.select(Session).where(Session.token == token)).first()


def terminate_session(db: sqlmodel.Session, token: str) -> None:
    session = find_session_by_token(db, token)
    if session is not None:
        db.delete(session)
        db.commit()
