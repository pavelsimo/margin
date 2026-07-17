# 37signals style guide reference

Key rules encoded in every generated `AGENTS.md`:

1. **Rich models** — business logic in models and concerns, not service objects
2. **CRUD only** — nominalize verbs: `close` → `resource :closure`, `publish` → `resource :publication`
3. **Concerns** — horizontal logic in `app/models/concerns/`, `app/controllers/concerns/`
4. **State = records** — `Closure`, `Pin`, `Watch` records instead of `closed_at`, `pinned`, `watching` booleans
5. **No Redis** — Solid Queue (jobs), Solid Cache (cache), Solid Cable (WebSockets)
6. **Build first** — reach for a gem only after confirming Rails doesn't provide the solution
7. **Ship and learn** — merge prototype-quality code, observe real usage, iterate
