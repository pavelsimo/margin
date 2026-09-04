import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PROVIDER_LABELS, type Provider } from '@shared/constants'
import type { CliExecutableInfo } from '@shared/ipc'
import type { AIResult, RunOpts } from './legacy'
import { managedAdapter } from './adapter'
import { cancelledResult } from './processHelpers'

export function createCliAdapter(
  provider: Provider,
  executable: CliExecutableInfo,
  run: (prompt: string, cwd: string, imagePath: string, executable: CliExecutableInfo, label: string, timeout: number, opts: RunOpts) => Promise<AIResult>,
) {
  const capturedExecutable = { ...executable }
  return managedAdapter({ streaming: true, images: true, nativeSessions: false, structuredOutput: false,
    modelOptions: provider === 'antigravity' ? ['model'] : ['model', 'effort'] }, async (request) => {
    const workdir = await mkdtemp(join(tmpdir(), 'margin-ai-'))
    try {
      if (request.signal.aborted) return cancelledResult('')
      let prompt = request.prompt
      let imagePath = ''
      if (request.attachments[0]) {
        imagePath = join(workdir, 'figure.png')
        await writeFile(imagePath, request.attachments[0].data)
        if (provider !== 'codex') prompt += '\n\nThe figure under discussion is saved as ./figure.png in your working directory. ' +
          'Read that image file first and ground your answer in what it shows.'
      }
      if (request.signal.aborted) return cancelledResult('')
      const timeout = Math.max(0, (request.deadline - Date.now()) / 1_000)
      return await run(prompt, workdir, imagePath, capturedExecutable, PROVIDER_LABELS[provider], timeout, {
        model: request.profile.model, effort: request.profile.effort, signal: request.signal,
        onDelta: (text) => request.onEvent?.({ type: 'text', text }),
      })
    } finally {
      await rm(workdir, { recursive: true, force: true }).catch(() => {})
    }
  })
}
