# Promo video pipeline

Records a fully automated demo of Margin (add paper, ELI12, formula question) and
assembles it into an MP4 and a README GIF. Everything runs against a sandboxed
data dir at `.promo/data`; the real `./data` is never modified.

## One-shot

```bash
npm run build                                   # recorder launches the built app
npm install --no-save --prefix .promo playwright-core@1.61.1   # first time only
scripts/promo/setup-sandbox.sh
node scripts/promo/record.mjs
scripts/promo/make-video.sh
```

Outputs: `.promo/out/margin-promo.mp4` (1080p, captions) and `docs/promo.gif`.

## How it works

- `setup-sandbox.sh` snapshots `data/margin.db` (WAL-safe `.backup`), trims the
  library to 4 papers, removes "Attention Is All You Need" so it can be added on
  camera, and preseeds the provider to Claude CLI (`claude/sonnet/low`).
- `record.mjs` drives the app with Playwright's Electron driver. It injects a
  fake cursor div (screenshots don't include the OS cursor), captures JPEG
  frames in a loop, and pauses capture during long waits (ingest, model
  latency) so they become jump cuts. Scene targets (the abstract block, the
  softmax equation) are located by querying the ingested blocks in the sandbox
  db, so the script survives layout changes.
- `make-video.sh` assembles frames via ffmpeg's concat demuxer with real
  per-frame durations, burns in captions positioned by the scene marks in
  `.promo/meta.json`, and generates the palette GIF.

## Knobs

- `PROMO_FPS` (default 12): target capture rate; effective rate is limited by
  screenshot latency (~8 fps at 1728x972).
- `PROMO_REGION` ("x0,y0,x1,y1" fractions): fallback drag region if the
  equation block lookup fails.
- `PROMO_FONT`: caption font path for `make-video.sh`.
- `node scripts/promo/record.mjs --dry`: no frame capture, saves one still per
  scene to `.promo/steps/` for quick iteration on coordinates.

The AI responses are real (Claude CLI, `sonnet` at low effort), so each run
produces slightly different answers and timing. Chat titles are also generated
by a background model call.
