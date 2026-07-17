"""JSON API mounted into the Reflex backend via api_transformer."""

from fastapi import FastAPI

api = FastAPI(title="Margin API")


@api.get("/up")
def up() -> dict[str, str]:
    """Health check probed by Kamal's proxy."""
    return {"status": "ok"}
