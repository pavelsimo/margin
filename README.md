# margin

margin is a desktop app for reading research papers. Add PDFs or arXiv links to a searchable
library, open a paper, select the text or figure you want to understand, and ask questions with your favorite coding agent (e.g. Codex, Claude Code). It uses the AI command-line tools installed on your computer,
so you do not need a separate paid API.

![Home screen showing a searchable grid of papers with first-page previews](docs/screenshots/home.png)
*Library: first-page previews of your papers; add them from a link or file, then search by title or topic.*

![Reader view with a paper open, selectable blocks, and the AI assistant panel](docs/screenshots/reader.png)
*Reader: select text, tables, figures, or a page region and ask the assistant to explain or summarize it.*

## Setup

```bash
npm install
npm run dev
```

Data lives in `./data` (override with `MARGIN_DATA_DIR`). It's a plain SQLite DB you can
inspect with `sqlite3 data/margin.db`.

## Scripts

- `npm run dev`: start with hot reload
- `npm run build`: build all bundles to `out/`
- `npm run dist`: build a native installer for the current platform to `release/`
- `npm test`: vitest unit tests (selection, prompt assembly, tag parsing, math normalization)
