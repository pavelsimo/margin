"""Verify page — exchange the emailed code for a session."""

import reflex as rx

from ..state import AuthState


@rx.page(route="/verify", title="Verify code")
def verify() -> rx.Component:
    return rx.container(
        rx.vstack(
            rx.heading("Check your email", size="7"),
            rx.text("We sent a 6-digit code to ", rx.text.strong(AuthState.email), "."),
            rx.form(
                rx.vstack(
                    rx.input(name="code", placeholder="123456", max_length=6, required=True, width="100%"),
                    rx.button("Verify", type="submit", width="100%"),
                    spacing="3",
                ),
                on_submit=AuthState.confirm_code,
                width="100%",
            ),
            rx.cond(AuthState.error != "", rx.text(AuthState.error, color_scheme="red")),
            rx.link("Use a different email", href="/sign-in"),
            spacing="4",
            padding_top="4em",
        ),
        size="1",
    )
