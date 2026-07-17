"""Application entry point."""

import reflex as rx

from . import (
    db,  # noqa: F401  — registers the SQLite PRAGMA listener
    pages,  # noqa: F401  — registers @rx.page routes
)
from .api import api

app = rx.App(api_transformer=api)
