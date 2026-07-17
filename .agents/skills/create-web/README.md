# create-web skill

Scaffold a production-ready web application from language templates.

## Usage

```
/create-web
/create-web name=my-app template=ruby database=mysql
/create-web name=my-app template=python
```

## Templates

| Template | Stack |
|----------|-------|
| `ruby` (default) | Rails 8.x · Hotwire · Solid Queue/Cache/Cable · Kamal · Magic link auth |
| `python` | Reflex · FastAPI (`api_transformer`) · SQLite WAL · uv/ruff/mypy/pytest · Kamal · Magic link auth |

## What It Creates

Both templates:

- Passwordless magic link authentication — no Devise, no auth library
- Kamal deployment configuration with multi-stage Dockerfile
- GitHub Actions CI + automatic Kamal deploy on push to main
- `AGENTS.md` encoding 37signals engineering principles (← symlinked as `CLAUDE.md`)

Ruby template:

- UUID primary keys across all tables
- Hotwire (Turbo + Stimulus) frontend with importmap-rails — no Node.js bundler
- Native CSS with cascade layers — no Tailwind, no preprocessors
- Solid Queue/Cache/Cable — no Redis dependency
- Minitest test suite with fixtures — no RSpec, no FactoryBot

Python template:

- Reflex UI (pure Python, compiles to React) with a FastAPI app mounted via `api_transformer`
- SQLite tuned for concurrency: WAL mode, `busy_timeout`, single shared engine
- SQLModel models with Alembic migrations (auto-formatted by a ruff post-write hook)
- uv + ruff + mypy strict + pytest with a coverage gate, lefthook pre-commit hooks
- Single-container production image: Caddy serves the exported frontend and proxies the backend

## Architecture

Inspired by [basecamp/fizzy](https://github.com/basecamp/fizzy) and the
[unofficial 37signals coding style guide](https://github.com/marckohlbrugge/unofficial-37signals-coding-style-guide):

1. Rich domain models over service objects
2. CRUD controllers over custom actions
3. Concerns for horizontal code sharing
4. Records as state over boolean columns
5. Database-backed infrastructure (no Redis)
6. Build it yourself before adopting gems
7. Ship to learn; validate; iterate

## Installation

```bash
npx skills@latest add pavelsimo/skills
```

## Contributing

Open an issue or pull request. Keep commits atomic.

## License

MIT
