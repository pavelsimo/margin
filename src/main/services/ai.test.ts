import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { runPrompt } from './ai'

let fakeBinDir = ''
let fakeClaudeBin = ''

vi.mock('./executableSettings', () => ({
  executableInfo: () => ({ customPath: fakeClaudeBin, effectiveCommand: fakeClaudeBin, source: 'custom' }),
}))

// A stand-in Claude CLI that drains stdin, waits long enough for runPrompt's
// cleanup to race ahead, then reports whether its working directory survived.
// $PWD can silently fall back to the inherited value when getcwd fails at
// shell startup, so probe by writing into the cwd instead: that fails with
// ENOENT once the directory has been deleted.
const FAKE_CLAUDE = `#!/bin/sh
cat >/dev/null
sleep 0.2
if touch ./.cwd-probe 2>/dev/null; then
  printf '{"type":"result","result":"cwd-ok"}\\n'
else
  printf '{"type":"result","result":"cwd-gone"}\\n'
fi
`

beforeAll(async () => {
  fakeBinDir = await mkdtemp(join(tmpdir(), 'margin-fake-cli-'))
  fakeClaudeBin = join(fakeBinDir, 'claude')
  await writeFile(fakeClaudeBin, FAKE_CLAUDE)
  await chmod(fakeClaudeBin, 0o755)
})

afterAll(async () => {
  await rm(fakeBinDir, { recursive: true, force: true })
})

describe.skipIf(process.platform === 'win32')('runPrompt', () => {
  it('keeps the temp workdir alive until the CLI process exits', async () => {
    const result = await runPrompt('claude', 'hello')
    expect(result.error).toBe('')
    expect(result.ok).toBe(true)
    expect(result.text).toBe('cwd-ok')
  })
})
