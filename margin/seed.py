"""Development seed data. Run with: uv run python -m <app_module>.seed"""

import sqlmodel

from . import db
from .models import Identity, User

SEED_EMAIL = "dev@example.com"


def seed() -> None:
    with db.session() as session:
        identity = session.exec(sqlmodel.select(Identity).where(Identity.email == SEED_EMAIL)).first()
        if identity is None:
            identity = Identity(email=SEED_EMAIL)
            session.add(identity)
            session.commit()
            session.refresh(identity)
        assert identity.id is not None
        user = session.exec(sqlmodel.select(User).where(User.identity_id == identity.id)).first()
        if user is None:
            session.add(User(identity_id=identity.id, display_name="Dev"))
            session.commit()
    print(f"Seeded {SEED_EMAIL}")


if __name__ == "__main__":
    seed()
