// Drives the built Margin app with Playwright's Electron driver and captures
// JPEG frames for the promo video. Run scripts/promo/setup-sandbox.sh first.
//
//   node scripts/promo/record.mjs          # full recording -> .promo/frames + meta.json
//   node scripts/promo/record.mjs --dry    # no frame loop; saves a still per step to .promo/steps
//
// Tunables via env: PROMO_FPS, PROMO_REGION ("x0,y0,x1,y1" fractions of the page image).

import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const require = createRequire(import.meta.url)
const { _electron } = require(join(ROOT, '.promo', 'node_modules', 'playwright-core'))
const electronPath = require(join(ROOT, 'node_modules', 'electron'))

const DRY = process.argv.includes('--dry')
const FPS = Number(process.env.PROMO_FPS || 12)
const REGION = (process.env.PROMO_REGION || '0.28,0.24,0.74,0.34').split(',').map(Number)
const ARXIV_URL = 'https://arxiv.org/abs/1706.03762'
const QUESTION = 'Why divide by sqrt(d_k)?'

const PROMO = join(ROOT, '.promo')
const FRAMES = join(PROMO, 'frames')
const STEPS = join(PROMO, 'steps')
rmSync(FRAMES, { recursive: true, force: true })
rmSync(STEPS, { recursive: true, force: true })
mkdirSync(FRAMES, { recursive: true })
mkdirSync(STEPS, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Read a single row from the sandbox db (WAL allows concurrent readers while
// the app has it open). Used to locate ingested blocks by their text.
function dbRow(sql) {
  const uri = `file:${join(PROMO, 'data', 'margin.db')}?mode=ro`
  const out = execFileSync('sqlite3', ['-json', uri, sql], { encoding: 'utf8' }).trim()
  return out ? JSON.parse(out)[0] : null
}

// ---------------------------------------------------------------------------
// Frame capture: continuous screenshot loop with real timestamps. pause() is
// used to jump-cut long waits (ingest, model latency); make-video caps the
// per-frame duration so a pause reads as an instant cut.
function makeRecorder(page) {
  const times = []
  let n = 0
  let running = false
  let paused = false
  let loop = Promise.resolve()

  async function pump() {
    while (running) {
      if (paused) { await sleep(40); continue }
      const t = Date.now()
      const name = `f${String(n).padStart(6, '0')}.jpg`
      try {
        await page.screenshot({ path: join(FRAMES, name), type: 'jpeg', quality: 90, caret: 'hide' })
        times.push({ name, t })
        n += 1
      } catch { /* window closing */ }
      const spent = Date.now() - t
      await sleep(Math.max(0, 1000 / FPS - spent))
    }
  }

  return {
    start() { if (DRY) return; running = true; loop = pump() },
    pause() { paused = true },
    resume() { paused = false },
    async stop() { running = false; await loop },
    times,
  }
}

// ---------------------------------------------------------------------------
// Fake cursor: a DOM overlay so pointer movement is visible in screenshots.
async function injectCursor(page) {
  await page.evaluate(() => {
    if (document.getElementById('promo-cursor')) return
    const style = document.createElement('style')
    style.id = 'promo-cursor-style'
    style.textContent = `
      #promo-cursor { position: fixed; left: 0; top: 0; z-index: 2147483647;
        pointer-events: none; width: 20px; height: 20px;
        transition: left .38s cubic-bezier(.3,.7,.3,1), top .38s cubic-bezier(.3,.7,.3,1);
        filter: drop-shadow(0 1px 2px rgba(0,0,0,.55)); }
      #promo-cursor.no-anim { transition: none; }
      .promo-ripple { position: fixed; z-index: 2147483646; pointer-events: none;
        width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%;
        border: 2px solid rgba(120,180,255,.9); animation: promo-ripple .45s ease-out forwards; }
      @keyframes promo-ripple { from { transform: scale(.35); opacity: .9; }
        to { transform: scale(1.15); opacity: 0; } }`
    document.head.appendChild(style)
    const c = document.createElement('div')
    c.id = 'promo-cursor'
    c.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24">
      <path d="M4 2 L4 19 L8.6 14.8 L11.4 21 L14.2 19.8 L11.4 13.6 L18 13.2 Z"
        fill="#fff" stroke="#222" stroke-width="1.4" stroke-linejoin="round"/></svg>`
    document.body.appendChild(c)
  })
}

async function cursorSet(page, x, y, anim = true) {
  await page.evaluate(([x, y, anim]) => {
    const c = document.getElementById('promo-cursor')
    if (!c) return
    c.classList.toggle('no-anim', !anim)
    c.style.left = `${x}px`
    c.style.top = `${y}px`
  }, [x, y, anim])
}

async function ripple(page, x, y) {
  await page.evaluate(([x, y]) => {
    const r = document.createElement('div')
    r.className = 'promo-ripple'
    r.style.left = `${x}px`
    r.style.top = `${y}px`
    document.body.appendChild(r)
    setTimeout(() => r.remove(), 500)
  }, [x, y])
}

async function cursorMove(page, x, y) {
  await cursorSet(page, x, y, true)
  await page.mouse.move(x, y, { steps: 8 })
  await sleep(420)
}

async function clickAt(page, x, y) {
  await cursorMove(page, x, y)
  await ripple(page, x, y)
  await page.mouse.click(x, y)
  await sleep(250)
}

async function cursorClick(page, locator) {
  const box = await locator.boundingBox()
  if (!box) throw new Error(`no bounding box for ${locator}`)
  await clickAt(page, box.x + box.width / 2, box.y + box.height / 2)
}

// Shift-drag with the cursor div tracking the real pointer step by step.
async function shiftDrag(page, from, to) {
  await cursorMove(page, from.x, from.y)
  await page.keyboard.down('Shift')
  await page.mouse.down()
  const steps = 22
  for (let i = 1; i <= steps; i++) {
    const x = from.x + ((to.x - from.x) * i) / steps
    const y = from.y + ((to.y - from.y) * i) / steps
    await page.mouse.move(x, y)
    await cursorSet(page, x, y, false)
    await sleep(28)
  }
  await page.mouse.up()
  await page.keyboard.up('Shift')
  await sleep(300)
}

// ---------------------------------------------------------------------------
async function main() {
  console.log('Launching app (sandbox data dir)…')
  const app = await _electron.launch({
    executablePath: electronPath,
    args: ['.'],
    cwd: ROOT,
    env: {
      ...process.env,
      MARGIN_DATA_DIR: join(PROMO, 'data'),
      AI_TIMEOUT: '120',
    },
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]
    w.setSize(1728, 972)
    w.center()
  })

  await page.evaluate(() => {
    localStorage.setItem('margin.theme', 'dark')
    localStorage.setItem('margin.assistantOpen', 'true')
    localStorage.setItem('margin.leftSidebarOpen', 'true')
    localStorage.setItem('margin.appZoom', '100')
    localStorage.setItem('margin.pdfTheme', 'light')
  })
  await page.reload()
  await page.waitForSelector('.paper-grid', { timeout: 30_000 })
  await injectCursor(page)
  await cursorSet(page, 860, 700, false)

  const rec = makeRecorder(page)
  const t0 = Date.now()
  const marks = {}
  const mark = async (name) => {
    marks[name] = Date.now() - t0
    console.log(`mark ${name} @ ${(marks[name] / 1000).toFixed(1)}s`)
    if (DRY) await page.screenshot({ path: join(STEPS, `${name}.png`) })
  }

  // Jump-cut helper: show `showMs` of the wait, pause capture, resume when done.
  const capturedWait = async (showMs, waitFn) => {
    if (DRY) { await waitFn(); return }
    await sleep(showMs)
    rec.pause()
    await waitFn()
    rec.resume()
  }

  const waitStreamStart = () =>
    page.waitForFunction(() => {
      const els = document.querySelectorAll('.msg-ai .chat-md')
      const last = els[els.length - 1]
      return !!last && last.textContent.trim().length > 0
    }, { timeout: 60_000 })

  const waitStreamDone = async () => {
    await page.waitForSelector('button.composer-send.stop', { state: 'detached', timeout: 150_000 })
    await sleep(400)
  }

  rec.start()
  await mark('intro')
  await sleep(1600)

  // ------------------------------------------------------------ Scene 1: add paper
  await mark('scene1')
  const urlInput = page.locator('#paper-url')
  await cursorClick(page, urlInput)
  await urlInput.pressSequentially(ARXIV_URL, { delay: 34 })
  await sleep(350)
  await cursorClick(page, page.locator('button.home-add-submit'))

  const newCard = page.locator('article.paper-card', { hasText: 'Attention' })
  await capturedWait(2600, async () => {
    await newCard.locator('.paper-cover img').waitFor({ state: 'visible', timeout: 120_000 })
  })
  await mark('scene1_ready')
  await sleep(2600) // linger: title + preview + tags badge

  // ------------------------------------------------------------ Scene 2: ELI12
  await mark('scene2')
  await cursorClick(page, newCard.locator('button.paper-card-open'))
  await page.waitForSelector('.reader-pdf-page img', { timeout: 30_000 })
  await sleep(1200)

  // ELI12 the abstract: the longest text block on page 1 of the ingested doc.
  const docId = dbRow('SELECT MAX(id) AS id FROM document').id
  const abstract = dbRow(
    `SELECT b.id FROM block b JOIN page p ON b.page_id = p.id
     WHERE p.document_id = ${docId} AND p.number = 1 AND b.kind = 'text'
     ORDER BY length(b.text) DESC LIMIT 1`
  )
  const absEl = page.locator(`.reader-block[data-block-id="${abstract.id}"]`)
  await absEl.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  await sleep(1200)
  const absBox = await absEl.boundingBox()
  await clickAt(page, absBox.x + absBox.width / 2, absBox.y + absBox.height / 2)
  await page.waitForSelector('.reader-selection-toolbar', { timeout: 10_000 })
  await sleep(700)
  await cursorClick(page, page.locator('button.mode-btn', { hasText: 'ELI12' }))

  await capturedWait(2600, waitStreamStart)
  await waitStreamDone()
  await mark('scene2_done')
  await sleep(2000)

  // ------------------------------------------------------------ Scene 3: formula region + question
  await mark('scene3')
  const nextBtn = page.locator('.page-nav .pill button').nth(1)
  for (let i = 0; i < 3; i++) {
    await cursorClick(page, nextBtn)
    await sleep(450)
  }
  await page.waitForSelector('.reader-pdf-page img', { timeout: 15_000 })
  await sleep(900)

  // Shift-drag around equation (1), located by its text in the ingested blocks.
  // Falls back to the PROMO_REGION fractions if the lookup finds nothing.
  const eq = dbRow(
    `SELECT b.id, b.x0, b.y0, b.x1, b.y1 FROM block b JOIN page p ON b.page_id = p.id
     WHERE p.document_id = ${docId} AND p.number = 4 AND b.text LIKE '%softmax%'
     ORDER BY length(b.text) LIMIT 1`
  )
  let [fx0, fy0, fx1, fy1] = REGION
  if (eq) {
    fx0 = eq.x0 - 0.03
    fy0 = eq.y0 - 0.013
    fx1 = eq.x1 + 0.03
    fy1 = eq.y1 + 0.015
    await page
      .locator(`.reader-block[data-block-id="${eq.id}"]`)
      .evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }))
    await sleep(1200)
  }
  const img = await page.locator('.reader-pdf-page img').boundingBox()
  await shiftDrag(
    page,
    { x: img.x + img.width * fx0, y: img.y + img.height * fy0 },
    { x: img.x + img.width * fx1, y: img.y + img.height * fy1 }
  )
  await page.waitForSelector('.region-highlight', { timeout: 10_000 })
  await mark('scene3_region')
  await sleep(800)

  await cursorClick(page, page.locator('.reader-selection-toolbar .ask-btn'))
  const composer = page.locator('.chat-composer textarea')
  await cursorClick(page, composer)
  await composer.pressSequentially(QUESTION, { delay: 46 })
  await sleep(400)
  await composer.press('Enter')

  await capturedWait(2600, waitStreamStart)
  await waitStreamDone()
  await mark('outro')
  await sleep(3000)

  // ------------------------------------------------------------ wrap up
  await rec.stop()
  if (!DRY) {
    // ffmpeg concat demuxer input with real per-frame durations, capped so
    // capture pauses become jump cuts instead of freezes. videoStart[i] is the
    // video-time each frame appears at, used to map wall-clock scene marks to
    // caption windows in the compressed timeline.
    const times = rec.times
    const cap = 0.25
    const videoStart = []
    let cum = 0
    let txt = ''
    for (let i = 0; i < times.length; i++) {
      videoStart.push(cum)
      const d = i + 1 < times.length ? Math.min((times[i + 1].t - times[i].t) / 1000, cap) : 1 / FPS
      txt += `file 'frames/${times[i].name}'\nduration ${d.toFixed(4)}\n`
      cum += d
    }
    if (times.length) txt += `file 'frames/${times[times.length - 1].name}'\n`
    writeFileSync(join(PROMO, 'frames.txt'), txt)

    const marksVideo = {}
    for (const [name, ms] of Object.entries(marks)) {
      const wall = t0 + ms
      const idx = times.findIndex((f) => f.t >= wall)
      marksVideo[name] = Number((idx === -1 ? cum : videoStart[idx]).toFixed(2))
    }
    const meta = {
      fps: FPS,
      frameCount: times.length,
      marks,
      marksVideo,
      videoDuration: Number(cum.toFixed(2)),
    }
    writeFileSync(join(PROMO, 'meta.json'), JSON.stringify(meta, null, 2))
    console.log(`Captured ${times.length} frames, video length ${cum.toFixed(1)}s`)
  }
  await app.close()
  console.log('Done.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
