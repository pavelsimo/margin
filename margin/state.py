"""Authentication state shared by all pages."""

from typing import Any

import reflex as rx
from reflex.event import EventSpec

from . import auth, db, mailer
from .models import User


class AuthState(rx.State):
    session_token: str = rx.Cookie("", name="session_token", same_site="lax")
    email: str = ""
    error: str = ""
    display_name: str = ""

    @rx.event
    def check_auth(self) -> EventSpec | None:
        """on_load guard for protected pages."""
        with db.session() as s:
            session = auth.find_session_by_token(s, self.session_token)
            if session is None:
                return rx.redirect("/sign-in")
            user = s.get(User, session.user_id)
            self.display_name = user.display_name if user else ""
        return None

    @rx.event
    def send_code(self, form_data: dict[str, Any]) -> EventSpec | None:
        email = auth.normalize_email(str(form_data.get("email", "")))
        if not auth.valid_email(email):
            self.error = "Enter a valid email address."
            return None
        with db.session() as s:
            identity = auth.find_or_create_identity(s, email)
            code = auth.issue_code(s, identity)
        if code is None:
            self.error = "Too many codes requested. Try again in a few minutes."
            return None
        mailer.send_magic_link_code(email, code.value)
        self.email = email
        self.error = ""
        return rx.redirect("/verify")

    @rx.event
    def confirm_code(self, form_data: dict[str, Any]) -> EventSpec | None:
        value = str(form_data.get("code", "")).strip()
        with db.session() as s:
            session = auth.verify_code(s, self.email, value)
        if session is None:
            self.error = "Invalid or expired code."
            return None
        self.session_token = session.token
        self.error = ""
        return rx.redirect("/")

    @rx.event
    def sign_out(self) -> EventSpec:
        with db.session() as s:
            auth.terminate_session(s, self.session_token)
        self.session_token = ""
        self.display_name = ""
        return rx.redirect("/sign-in")
