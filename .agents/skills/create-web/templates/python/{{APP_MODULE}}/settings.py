"""Environment-driven settings."""

import os

SMTP_ADDRESS = os.getenv("SMTP_ADDRESS", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USERNAME = os.getenv("SMTP_USERNAME", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
MAILER_FROM_ADDRESS = os.getenv("MAILER_FROM_ADDRESS", "noreply@example.com")
