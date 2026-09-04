import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { runOpenAiChat } from './openAiCompatibleCore'

let server: Server
let baseUrl: string
beforeAll(async () => {
  server = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    const { model, messages } = JSON.parse(body)
    expect(messages[0].content).toBe('question')
    if (model === 'json') {
      res.setHeader('content-type', 'application/json')
      return res.end(JSON.stringify({ choices: [{ message: { content: 'answer' } }] }))
    }
    if (model === 'limited') {
      res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '2' })
      return res.end(JSON.stringify({ error: { message: 'rate limited' } }))
    }
    res.setHeader('content-type', 'text/event-stream')
    if (model === 'malformed') return res.end('data: invalid\n\n')
    const bytes = Buffer.from('data: {"choices":[{"delta":{"content":"héllo"}}]}\r\n\r\n')
    const split = bytes.indexOf(Buffer.from('é')) + 1
    res.write(bytes.subarray(0, split))
    setTimeout(() => {
      res.write(bytes.subarray(split))
      if (model === 'disconnect') return setTimeout(() => res.destroy(), 10)
      res.end('data: [DONE]\n\n')
    }, 10)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`
})
afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

it.each(['json', 'stream'])('handles real HTTP %s responses', async (model) => {
  const result = await runOpenAiChat({ name: 'Fixture', baseUrl, apiKey: '' }, 'question', { model, timeout: 2 }, fetch)
  expect(result.ok).toBe(true)
  expect(result.text).toBe(model === 'json' ? 'answer' : 'héllo')
})
it.each(['limited', 'malformed', 'disconnect'])('fails on %s without retrying', async (model) => {
  const result = await runOpenAiChat({ name: 'Fixture', baseUrl, apiKey: '' }, 'question', { model, timeout: 2 }, fetch)
  expect(result.ok).toBe(false)
  expect(result.error).not.toBe('')
})
