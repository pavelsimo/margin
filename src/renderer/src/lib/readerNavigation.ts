/** Only implicit reader routes may adopt the thread resolved by the store. */
export function resolvedChatPath(
  pathname: string,
  docId: number,
  state: { documentId: number; activeThreadId: number },
): string | null {
  if (!Number.isInteger(docId) || docId <= 0 || state.documentId !== docId || !state.activeThreadId) return null
  if (pathname !== `/read/${docId}` && pathname !== `/read/${docId}/new`) return null
  return `/read/${docId}/chat/${state.activeThreadId}`
}
