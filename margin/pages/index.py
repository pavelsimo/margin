"""Home page — requires authentication."""

import reflex as rx

from ..state import AuthState


@rx.page(route="/", title="Margin", on_load=AuthState.check_auth)
def index() -> rx.Component:
    return rx.container(
        rx.vstack(
            rx.heading("Margin", size="8"),
            rx.text("Read research papers with AI assistance via your Claude or Codex subscription"),
            rx.text("Signed in as ", rx.text.strong(AuthState.display_name)),
            rx.button("Sign out", on_click=AuthState.sign_out, variant="soft"),
            spacing="4",
            padding_top="4em",
        ),
        size="2",
    )
