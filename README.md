# Margin Desktop

Electron desktop edition of [Margin](https://github.com/pavelsimo/margin), the AI-powered
research paper reader. A full TypeScript rewrite of the Python/Reflex web app: React + Vite
renderer, Electron main process with better-sqlite3 and mupdf.js (the WASM build of the same
engine PyMuPDF wraps), and AI answers via your local `claude` or `codex` CLI — no API calls.

## Features

- **Home** — add papers by arXiv link, direct PDF URL, or file upload, then browse first-page previews in a searchable grid.
- **Reader** — rendered PDF pages with selectable text/table/figure blocks. Click, Ctrl-click,
  Shift-click ranges, drag to select multiple blocks, Shift-drag to send an exact visual region.
- **AI chat** — Ask / Explain / Summarize / ELI12 on a selection, page, or the whole paper.
  Figures and regions are sent as PNG crops rendered from the PDF. `/clear` and `/help` commands.
- **Ingestion** — new papers are rendered and block-extracted in a worker thread; topic tags are
  generated automatically. (Table detection is not ported — new papers get text/image blocks only;
  tables in papers ingested by the web app carry over.)
- **Settings** — choose custom Claude/Codex CLI executables and customize the prompt template for each mode.
- **Desktop shell** — custom window chrome, application menus, a searchable papers sidebar,
  and a toggleable/resizable assistant panel. Use `Ctrl/Cmd+B` for papers, `Ctrl/Cmd+Shift+B`
  for the assistant, `Ctrl/Cmd+,` for settings, and `Ctrl/Cmd` with `+` / `-` to zoom the app.

Single-user: the app adopts whichever user owns the documents in the copied database. No sign-in.

## Setup

```bash
npm install
npm run copy-data   # copies ../margin's database and files into ./data (use --force to overwrite)
npm run dev
```

`npm run copy-data` expects the web app at `~/Projects/margin` (override with `MARGIN_SRC`).
Data lives in `./data` (override with `MARGIN_DATA_DIR`); it's a plain SQLite DB you can inspect
with `sqlite3 data/margin.db`.

## Scripts

- `npm run dev` — start with hot reload
- `npm run build` — build all bundles to `out/`
- `npm test` — vitest unit tests (selection, prompt assembly, tag parsing, math normalization)
- `npx tsx scripts/parity-check.ts [docId]` — diff the mupdf.js extractor against blocks stored
  by the web app's PyMuPDF ingestion

## Environment

- `CLAUDE_BIN` / `CODEX_BIN` — CLI paths used when no executable was saved in Settings (default `claude` / `codex` from `PATH`)
- `AI_TIMEOUT` — per-question timeout in seconds (default 180)
- `DEFAULT_AI_PROVIDER` — `claude` (default) or `codex`
- `MARGIN_ROUTE` — open the app on a route, e.g. `MARGIN_ROUTE=/read/1 npm run dev`

Executable resolution order is: the path saved in Settings, then `CLAUDE_BIN` / `CODEX_BIN`, then the
bare `claude` / `codex` command resolved through the system `PATH`. Saved paths live in Electron's per-user
application data directory rather than the paper database.

## Architecture

```
src/shared/     IPC contract, row types, constants (single source of truth)
src/main/       Electron main: better-sqlite3 (WAL), margin:// protocol for page images,
                ipc/ handlers, services/ (ai spawn, prompts, chat, tagging, mupdf, ingest)
src/main/ingest-worker.ts   worker thread for CPU-heavy page rendering/extraction
src/preload/    contextBridge → window.margin
src/renderer/   React app shell: Home / Reader / Settings, navigation and UI stores,
                selection logic ported 1:1 from the web app
```
