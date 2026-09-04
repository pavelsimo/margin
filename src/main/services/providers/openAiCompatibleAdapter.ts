import { runOpenAiChat, type FetchLike, type OpenAiRuntimeProfile } from '../openAiCompatibleCore'
import { managedAdapter } from './adapter'

export function openAiCompatibleAdapter(profile: OpenAiRuntimeProfile, fetcher: FetchLike) {
  const capturedProfile = { ...profile }
  return managedAdapter({ streaming: 'unknown', images: 'unknown', nativeSessions: false,
    structuredOutput: 'unknown', modelOptions: ['model'] }, (request) => runOpenAiChat(capturedProfile, request.prompt, {
    model: request.profile.model,
    imagePng: request.attachments[0]?.data,
    timeout: Math.max(0, (request.deadline - Date.now()) / 1_000),
    signal: request.signal,
    onDelta: (text) => request.onEvent?.({ type: 'text', text }),
  }, fetcher))
}
