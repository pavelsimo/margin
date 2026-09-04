import type { ChatSendRequest } from '@shared/ipc'
import type { ChatMessageRow, DocumentRow } from '@shared/models'
import { assemblePrompt, capText, MAX_HISTORY_MESSAGES } from './promptCore'
import type { ProviderInput } from './providers/types'

export function textContext(
  document: Pick<DocumentRow, 'title'>,
  pages: Array<{ number: number; text: string }>,
  args: { scope: string; pageNumber: number | null; selectedText?: string },
): [string, string] {
  const selected = (args.selectedText ?? '').trim()
  if (selected) return [selected, "the reader's highlighted selection"]
  if (args.scope === 'page' && args.pageNumber !== null) {
    const page = pages.find((p) => p.number === args.pageNumber)
    if (page?.text) return [page.text, `page ${args.pageNumber} of the paper`]
  }
  return [pages.filter((p) => p.text).map((p) => p.text).join('\n\n'), `the paper "${document.title}"`]
}
export function imageContext(pageNumber: number | null): [string, string] {
  const where = pageNumber !== null ? ` on page ${pageNumber} of the paper` : ' in the paper'
  return [`[The reader selected a figure${where}. It is attached as an image rather than text, so study the image to answer.]`, `a figure${where}`]
}
export function regionImageContext(pageNumber: number): [string, string] {
  const where = ` on page ${pageNumber} of the paper`
  return [`[The reader selected an exact visual region${where}. It is attached as an image rather than extracted text, so study everything visible in that region to answer.]`, `the reader's selected visual region${where}`]
}
export function buildChatInput(args: {
  request: ChatSendRequest
  template: string
  history: ChatMessageRow[]
  context: [string, string]
  imagePng?: Buffer | null
  contextPageNumber?: number
}): ProviderInput {
  const { request, template, history, imagePng } = args
  const [context, scopeLabel] = args.context
  const recent = history.slice(-MAX_HISTORY_MESSAGES)
  return {
    instructions: assemblePrompt(template, { context, question: request.question, scopeLabel }),
    messages: recent.map((m) => ({ role: m.role, content: m.content })),
    context: { documentId: request.docId, pageNumber: args.contextPageNumber ?? request.imageRegionPage ?? request.pageNumber, scope: scopeLabel, text: capText(context) },
    attachments: imagePng ? [{ name: 'figure.png', mediaType: 'image/png', data: imagePng }] : [],
    prompt: assemblePrompt(template, { context, question: request.question, scopeLabel, history: recent }),
  }
}
