// Portable protocol peer: tests launch this script with the current Node runtime.
const { createInterface } = require('node:readline')
const { writeFileSync, existsSync } = require('node:fs')
const provider = process.argv[2]
const args = process.argv.slice(3)
const emit = (value) => process.stdout.write(JSON.stringify(value) + '\n')
let scenario = ''
let alive
function answer(prompt) {
  scenario = prompt
  if (prompt.includes('early-exit')) return process.exit(2)
  if (prompt.includes('stderr-flood')) {
    process.stderr.write('private prompt and token '.repeat(10_000))
    return process.exit(2)
  }
  if (prompt.includes('cwd-probe')) {
    writeFileSync('.cwd-probe', 'ok')
    if (!existsSync('figure.png')) return process.exit(3)
  }
  if (prompt.includes('malformed')) {
    process.stdout.write('{not-json}\n')
    return process.exit(0)
  }
  const text = 'héllo world'
  const delta = provider === 'claude'
    ? JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } }) + '\n'
    : provider === 'codex'
      ? JSON.stringify({ method: 'item/agentMessage/delta', params: { itemId: 'answer', delta: text } }) + '\n'
      : text
  if (provider === 'codex') {
    if (prompt.includes('in-progress')) emit({ method: 'turn/completed', params: { turn: { status: 'inProgress' } } })
    emit({ method: 'item/started', params: { item: { id: 'answer', type: 'agentMessage', phase: 'final_answer' } } })
  }
  const bytes = Buffer.from(delta)
  const split = bytes.indexOf(Buffer.from('é')) + 1
  process.stdout.write(bytes.subarray(0, split))
  setTimeout(() => {
    process.stdout.write(bytes.subarray(split))
    if (prompt.includes('hang')) {
      process.on('SIGTERM', () => {})
      alive = setInterval(() => {}, 1_000)
      return
    }
    setTimeout(() => {
      if (provider === 'claude') {
        emit({ type: 'result', result: text })
        if (prompt.includes('duplicate')) {
          emit({ type: 'result', result: 'late result must be ignored' })
          emit({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'late' } } })
        }
      } else if (provider === 'codex') {
        emit({ method: 'turn/completed', params: { turn: { status: 'completed', items: [
          { type: 'agentMessage', phase: 'final_answer', text },
        ] } } })
      }
      if (provider !== 'codex') process.exit(0)
    }, 20)
  }, 20)
}
if (provider === 'antigravity') answer(args[args.indexOf('-p') + 1])
else if (provider === 'claude') {
  let input = ''
  process.stdin.on('data', (chunk) => { input += chunk })
  process.stdin.on('end', () => answer(input))
} else {
  createInterface({ input: process.stdin }).on('line', (line) => {
    const message = JSON.parse(line)
    if (message.method === 'initialize') emit({ id: message.id, result: {} })
    if (message.method === 'thread/start') emit({ id: message.id, result: { thread: { id: 'native-thread' } } })
    if (message.method === 'turn/start') {
      emit({ id: message.id, result: { turn: { id: 'native-turn' } } })
      answer(message.params.input[0].text)
    }
    if (message.method === 'turn/interrupt' && !scenario.includes('hang')) {
      clearInterval(alive)
      emit({ method: 'turn/completed', params: { turn: { status: 'interrupted' } } })
    }
  })
}
