// Pure tag parsing — no DB access. Port of tagging.parse_tags.

export const MAX_TAGS = 5
export const MAX_TAG_LENGTH = 40
export const MAX_TAG_WORDS = 4

export const GENERIC_TAGS = new Set([
  'ai',
  'artificial intelligence',
  'machine learning',
  'ml',
  'research',
  'research paper',
])

/** Parse and normalize a JSON tag array, tolerating a surrounding code fence or preamble. */
export function parseTags(text: string, vocabulary: string[] = []): string[] {
  const match = text.match(/\[[\s\S]*?\]/)
  if (!match) throw new Error('The AI response did not contain a JSON array.')
  let rawTags: unknown
  try {
    rawTags = JSON.parse(match[0])
  } catch {
    throw new Error('The AI response contained invalid JSON.')
  }
  if (!Array.isArray(rawTags) || !rawTags.every((tag) => typeof tag === 'string')) {
    throw new Error('The AI response must be a JSON array of strings.')
  }

  const canonical = new Map(vocabulary.map((tag) => [tag.toLowerCase(), tag]))
  const normalized: string[] = []
  const seen = new Set<string>()
  for (const raw of rawTags as string[]) {
    let tag = raw.replace(/^#/, '').split(/\s+/).filter(Boolean).join(' ').trim()
    const folded = tag.toLowerCase()
    if (
      !tag ||
      tag.includes(',') ||
      tag.length > MAX_TAG_LENGTH ||
      tag.split(' ').length > MAX_TAG_WORDS ||
      GENERIC_TAGS.has(folded) ||
      seen.has(folded)
    ) {
      continue
    }
    tag = canonical.get(folded) ?? tag
    seen.add(folded)
    normalized.push(tag)
    if (normalized.length === MAX_TAGS) break
  }
  if (!normalized.length) throw new Error('The AI response did not contain any usable topic tags.')
  return normalized
}
