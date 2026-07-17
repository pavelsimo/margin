---
name: create-web
description: Scaffold a production-ready web application from language templates. Use when the user wants to bootstrap a new web project from scratch.
---

# create-web skill

## features

- Scaffolds a complete, production-ready web application from a language template
- Ruby on Rails 8.x template built on 37signals conventions (Basecamp / Fizzy architecture)
- Python template: Reflex (pure-Python UI) + FastAPI mounted via `api_transformer`, SQLite with WAL mode, SQLModel + Alembic migrations
- Passwordless magic link authentication in both templates — no Devise, no auth library
- Ruby: UUID primary keys, Solid Queue/Cache/Cable (no Redis), Hotwire + importmap-rails, native CSS with cascade layers, Minitest + fixtures
- Python: uv + ruff + mypy strict + pytest with coverage gate, lefthook pre-commit hooks
- Kamal deployment configuration with multi-stage Dockerfile (both templates)
- GitHub Actions CI + automatic Kamal deploy on push to main
- Comprehensive `AGENTS.md` encoding 37signals engineering principles (symlinked as `CLAUDE.md`)

## usage

```
/create-web
/create-web name=my-app template=ruby database=mysql
/create-web name=my-app template=python
```

## workflow

Read `templates/` to understand the available templates and what variable placeholders each one uses before collecting any input from the user. Read [reference/37signals-style.md](reference/37signals-style.md) before changing Rails conventions, and [reference/template-maintenance.md](reference/template-maintenance.md) only when adding a new language template.

### 1. clarify

Collect these values via `AskUserQuestion`. Auto-detect `github_user` silently; never prompt the user for it.

| Field | Default | Notes |
|-------|---------|-------|
| `name` | — | Lowercase, hyphenated app name (e.g., `my-app`) |
| `template` | `ruby` | `ruby` or `python` |
| `description` | — | One sentence: what this app does |
| `github_user` | auto | `gh api user --jq .login` |
| `database` | `sqlite` | (ruby only) `sqlite` or `mysql` — python is always SQLite with WAL |
| `ruby_version` | `3.4.2` | (ruby only) Latest stable Ruby |
| `python_version` | `3.13` | (python only) Latest stable Python |
| `visibility` | `private` | `private` or `public` |

**Derived values — never ask the user:**

| Variable | Derivation | Example |
|----------|-----------|---------|
| `APP_CLASS` | PascalCase(`name`) | `my-app` → `MyApp` |
| `APP_MODULE` | underscore(`name`) | `my-app` → `my_app` |
| `APP_NAME_HUMAN` | Title Case(`name`) | `my-app` → `My App` |
| `YEAR` | current year | `2025` |

PascalCase: split on `-`, capitalize each word, join. Underscore: replace `-` with `_`.
`APP_CLASS` is used by the ruby template only.

### 2. show spec card

Display a confirmation card before creating anything.

For `template=ruby`:

```
╭─ App Spec ──────────────────────────────────────────╮
│ Name:        {name}                                  │
│ Class:       {APP_CLASS}                             │
│ Description: {description}                           │
│ Template:    Ruby on Rails 8.x (37signals style)    │
│ Database:    {database}                              │
│ Ruby:        {ruby_version}                          │
│ Auth:        Passwordless magic links (no Devise)    │
│ Frontend:    Hotwire (Turbo + Stimulus) + importmap  │
│ CSS:         Native CSS (no Tailwind)                │
│ Jobs:        Solid Queue (no Redis)                  │
│ Deploy:      Kamal                                   │
│ Repo:        github.com/{github_user}/{name}         │
╰──────────────────────────────────────────────────────╯
```

For `template=python`:

```
╭─ App Spec ──────────────────────────────────────────╮
│ Name:        {name}                                  │
│ Module:      {APP_MODULE}                            │
│ Description: {description}                           │
│ Template:    Python + Reflex (37signals style)       │
│ Database:    SQLite (WAL mode)                       │
│ Python:      {python_version}                        │
│ Auth:        Passwordless magic links                │
│ Frontend:    Reflex (pure-Python, compiles to React) │
│ API:         FastAPI via api_transformer             │
│ Tooling:     uv · ruff · mypy · pytest · lefthook    │
│ Deploy:      Kamal                                   │
│ Repo:        github.com/{github_user}/{name}         │
╰──────────────────────────────────────────────────────╯
```

Ask: "Does this look right? Shall I scaffold the project?"

### 3. scaffold

Execute in order. Steps 1, 6, 7, and 8 are identical for both templates; steps 2–5 branch on the template.

1. **Create GitHub repo and clone:**
   ```bash
   gh repo create {github_user}/{name} --{visibility} --clone --description "{description}"
   cd {name}
   ```

2. **Copy template files with variable substitution:**
   - Copy all files from `templates/{template}/` (relative to this skill's directory) to the project root
   - Substitute all `{{PLACEHOLDER}}` tokens in both file contents and filenames:
     - `{{APP_NAME}}` → `{name}`
     - `{{APP_MODULE}}` → `{APP_MODULE}`
     - `{{APP_NAME_HUMAN}}` → `{APP_NAME_HUMAN}`
     - `{{GITHUB_USER}}` → `{github_user}`
     - `{{DESCRIPTION}}` → `{description}`
     - `{{YEAR}}` → current year
     - ruby only: `{{APP_CLASS}}` → `{APP_CLASS}`, `{{RUBY_VERSION}}` → `{ruby_version}`, `{{DATABASE}}` → `{database}` (value: `sqlite3` for sqlite, `mysql2` for mysql)
     - python only: `{{PYTHON_VERSION}}` → `{python_version}`
   - Strip `.tmpl` extension from all `*.tmpl` files after substitution
   - Make all bin scripts executable: `chmod +x bin/*`

3. **Install dependencies:**
   - ruby:
     ```bash
     bundle install
     ```
   - python (also generates `uv.lock`, which must be committed):
     ```bash
     uv sync --dev
     ```

4. **Prepare database:**
   - ruby (runs db:create + db:migrate + db:seed):
     ```bash
     bin/rails db:prepare
     ```
   - python (generate the initial migration, apply it, seed):
     ```bash
     uv run alembic revision --autogenerate -m "create auth tables"
     uv run alembic upgrade head
     uv run python -m {APP_MODULE}.seed
     ```

5. **Install git hooks:**
   - ruby:
     ```bash
     bundle exec lefthook install
     ```
   - python:
     ```bash
     uv run lefthook install
     ```

6. **Create CLAUDE.md symlink:**
   ```bash
   ln -s AGENTS.md CLAUDE.md
   ```

7. **Initial commit and push:**
   ```bash
   git add -A
   git commit -m "🎉 init: scaffold {APP_NAME_HUMAN} from create-web"
   git push -u origin main
   ```

8. **Configure GitHub repo:**
   ```bash
   gh repo edit --enable-wiki=false --enable-issues=true
   ```

### 4. output summary

For `template=ruby`:

```
✅ Created: https://github.com/{github_user}/{name}

Template: Ruby on Rails 8.x (37signals style)

Next steps:
  cd {name}
  bin/dev                        # start development server (localhost:3000)
  open http://localhost:3000     # view the app
  bin/rails test                 # run tests
  make lint                      # run rubocop
  bin/rails generate model ...   # add your first model

Documentation:
  docs/development.md            # local setup guide
  docs/deployment.md             # Kamal deployment guide
  config/deploy.yml              # Kamal deployment config — fill in your server IP and domain
  AGENTS.md                      # AI agent conventions (← CLAUDE.md)
```

For `template=python`:

```
✅ Created: https://github.com/{github_user}/{name}

Template: Python + Reflex (37signals style)

Next steps:
  cd {name}
  make dev                       # start development server (localhost:3000)
  open http://localhost:3000     # view the app
  make test                      # run tests
  make ci                        # format check + lint + tests
  make db-makemigrations m="..." # generate a migration after adding models

Documentation:
  docs/development.md            # local setup guide
  docs/deployment.md             # Kamal deployment guide
  config/deploy.yml              # Kamal deployment config — fill in your server IP, domain, and API_URL
  AGENTS.md                      # AI agent conventions (← CLAUDE.md)
```

## template variable reference

| Placeholder | Example | Used in |
|------------|---------|---------|
| `{{APP_NAME}}` | `my-app` | filenames, Kamal config, README |
| `{{APP_CLASS}}` | `MyApp` | (ruby only) Ruby module names, application.rb |
| `{{APP_MODULE}}` | `my_app` | database names, directory paths, Python package |
| `{{APP_NAME_HUMAN}}` | `My App` | page titles, email subjects, commit message |
| `{{GITHUB_USER}}` | `pavelsimo` | repo URL, Docker image registry, Kamal |
| `{{DESCRIPTION}}` | `A task manager...` | README, repo description |
| `{{RUBY_VERSION}}` | `3.4.2` | (ruby only) .ruby-version, Gemfile, Dockerfile |
| `{{DATABASE}}` | `sqlite3` | (ruby only) database.yml default adapter |
| `{{PYTHON_VERSION}}` | `3.13` | (python only) .python-version, pyproject.toml, Dockerfile |
| `{{YEAR}}` | current year | README license line |

Substitution applies to both file contents and filenames. `.tmpl` extension is stripped post-substitution.

## best practices

- Always show the spec card and wait for explicit confirmation before creating the GitHub repo or any files
- Detect `github_user` silently via `gh api user --jq .login`; never prompt the user for it
- Both templates ship with a working auth system — do not replace it with Devise or other auth libraries
- When modeling state ("close", "archive", "publish"), always use a separate record (`Closure`, `Publication`) rather than boolean columns — this is the 37signals pattern

Ruby:

- When users ask for tests, remind them that fixtures (not FactoryBot) and Minitest (not RSpec) are the 37signals convention
- CSS additions go in focused component files under `app/assets/stylesheets/` using cascade layers — never suggest Tailwind
- Background jobs go through Solid Queue — never suggest Sidekiq or Redis
- New routes nominalize verbs: "close" → `resource :closure`, "pin" → `resource :pin`, "watch" → `resource :watch`

Python:

- Domain logic goes in plain functions taking a `sqlmodel.Session` (like `auth.py`) — never in Reflex state or service classes
- Migrations only via `make db-makemigrations` + `make db-migrate` (Alembic) — never edit the schema by hand
- Use native Reflex components — never suggest custom React components or a JavaScript frontend
- The app runs a single backend worker; never suggest Redis, Celery, or PostgreSQL for a single-server deployment
