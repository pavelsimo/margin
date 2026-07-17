# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Python template: Reflex UI + FastAPI mounted via `api_transformer`, SQLite with WAL mode
  on a Kamal volume, magic-link auth (Identity/User/Session/MagicLinkCode parity with ruby),
  SQLModel + Alembic migrations, uv + ruff + mypy strict + pytest + lefthook, GitHub Actions
  CI and Kamal deploy, single-container production image (Caddy + Reflex backend)

## [0.1.0] - 2025-06-04

### Added

- Initial release with Ruby on Rails 8.x template
- Passwordless magic link authentication (no Devise)
- UUID primary keys via Rails generators config
- Hotwire (Turbo + Stimulus) frontend with importmap-rails
- Solid Queue, Solid Cache, Solid Cable (no Redis)
- Native CSS with cascade layers (no Tailwind)
- Minitest test suite with fixtures (no RSpec, no FactoryBot)
- Kamal deployment configuration with multi-stage Dockerfile
- GitHub Actions CI (rubocop + minitest + system tests)
- Comprehensive AGENTS.md encoding 37signals engineering conventions
- SQLite default; MySQL via DATABASE_ADAPTER env var
