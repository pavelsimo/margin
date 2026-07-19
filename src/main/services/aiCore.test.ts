import { afterEach, describe, expect, it } from 'vitest'
import { delimiter, join } from 'node:path'
import { buildCommand, cliEnvironment, parseClaudeStreamLine, parseCodexStreamLine } from './aiCore'

const originalClaudeBin = process.env.CLAUDE_BIN
const originalCodexBin = process.env.CODEX_BIN
const originalAgyBin = process.env.AGY_BIN

afterEach(() => {
  if (originalClaudeBin === undefined) delete process.env.CLAUDE_BIN
  else process.env.CLAUDE_BIN = originalClaudeBin
  if (originalCodexBin === undefined) delete process.env.CODEX_BIN
  else process.env.CODEX_BIN = originalCodexBin
  if (originalAgyBin === undefined) delete process.env.AGY_BIN
  else process.env.AGY_BIN = originalAgyBin
})

describe('buildCommand', () => {
  it('uses a custom Claude executable while preserving model, effort, and image arguments', () => {
    expect(buildCommand('claude', 'sonnet', 'high', '/tmp/figure.png', '/opt/claude')).toEqual([
      '/opt/claude',
      '-p',
      '--output-format',
      'stream-json',
      '--include-partial-messages',
      '--verbose',
      '--model',
      'sonnet',
      '--effort',
      'high',
      '--allowed-tools',
      'Read',
    ])
  })

  it('uses a custom Codex executable for app-server streaming', () => {
    expect(buildCommand('codex', 'gpt-5.6-sol', 'xhigh', '/tmp/figure.png', '/opt/codex')).toEqual([
      '/opt/codex',
      'app-server',
    ])
  })

  it('passes the Antigravity model by display name and unlocks file reads only for images', () => {
    expect(buildCommand('antigravity', 'Gemini 3.1 Pro (High)', '', '/tmp/figure.png', '/opt/agy')).toEqual([
      '/opt/agy',
      '--model',
      'Gemini 3.1 Pro (High)',
      '--sandbox',
      '--dangerously-skip-permissions',
    ])
    expect(buildCommand('antigravity', '', '', '', '/opt/agy')).toEqual(['/opt/agy'])
  })

  it('retains environment-variable defaults for direct callers', () => {
    process.env.CLAUDE_BIN = '/environment/claude'
    process.env.CODEX_BIN = '/environment/codex'
    process.env.AGY_BIN = '/environment/agy'

    expect(buildCommand('claude')[0]).toBe('/environment/claude')
    expect(buildCommand('codex')[0]).toBe('/environment/codex')
    expect(buildCommand('antigravity')[0]).toBe('/environment/agy')
  })

  it('falls back to the agy binary name for Antigravity', () => {
    delete process.env.AGY_BIN
    expect(buildCommand('antigravity')[0]).toBe('agy')
  })
})

describe('cliEnvironment', () => {
  it.skipIf(process.platform === 'win32')('adds system tools and user shims to a minimal desktop PATH', () => {
    const home = join('/', 'home', 'test')
    const localBin = join(home, '.local', 'bin')
    const env = cliEnvironment({ PATH: localBin }, home, process.platform)
    const paths = env.PATH!.split(delimiter)

    expect(env.HOME).toBe(home)
    expect(paths).toContain(localBin)
    expect(paths).toContain(join(home, '.local', 'share', 'mise', 'shims'))
    expect(paths).toContain('/usr/bin')
    expect(paths).toContain('/bin')
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('does not rewrite the Windows environment', () => {
    expect(cliEnvironment({ Path: 'C:\\Tools' }, 'C:\\Users\\test', 'win32')).toEqual({ Path: 'C:\\Tools' })
  })
})

describe('stream event parsing', () => {
  it('extracts only Claude text deltas and the authoritative result', () => {
    expect(parseClaudeStreamLine('{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"hello"}}}')).toEqual({ delta: 'hello' })
    expect(parseClaudeStreamLine('{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"secret"}}}')).toEqual({})
    expect(parseClaudeStreamLine('{"type":"result","is_error":false,"result":"hello world"}')).toEqual({ finalText: 'hello world' })
    expect(parseClaudeStreamLine('not json')).toEqual({})
  })

  it('extracts Codex answer deltas and completion text', () => {
    expect(parseCodexStreamLine('{"method":"item/started","params":{"item":{"id":"a","type":"agentMessage","phase":"final_answer","text":""}}}')).toEqual({
      item: { itemId: 'a', phase: 'final_answer' },
    })
    expect(parseCodexStreamLine('{"method":"item/agentMessage/delta","params":{"itemId":"a","delta":"hello"}}')).toEqual({
      delta: { itemId: 'a', text: 'hello' },
    })
    expect(parseCodexStreamLine('{"method":"turn/completed","params":{"turn":{"status":"completed","error":null,"items":[{"id":"c","type":"agentMessage","phase":"commentary","text":"working"},{"id":"a","type":"agentMessage","phase":"final_answer","text":"done"}]}}}')).toEqual({
      completed: { status: 'completed', error: undefined, finalText: 'done' },
    })
    expect(parseCodexStreamLine('{broken')).toEqual({})
  })
})
