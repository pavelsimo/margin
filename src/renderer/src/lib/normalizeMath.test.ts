import { describe, expect, it } from 'vitest'
import { normalizeMath } from './normalizeMath'

// Oracle: chat.normalize_math.
describe('normalizeMath', () => {
  it('rewrites display math', () => {
    expect(normalizeMath('before \\[x^2\\] after')).toBe('before $$x^2$$ after')
  })
  it('rewrites inline math', () => {
    expect(normalizeMath('a \\(y\\) b')).toBe('a $y$ b')
  })
  it('handles multiline display math (DOTALL)', () => {
    expect(normalizeMath('\\[\nx = 1\n\\]')).toBe('$$\nx = 1\n$$')
  })
  it('leaves dollar-delimited math untouched', () => {
    expect(normalizeMath('$a$ and $$b$$')).toBe('$a$ and $$b$$')
  })
  it('handles multiple occurrences', () => {
    expect(normalizeMath('\\(a\\) \\(b\\) \\[c\\]')).toBe('$a$ $b$ $$c$$')
  })
})
