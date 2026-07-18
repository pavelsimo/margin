// Port of chat.normalize_math: rewrite \[...\] / \(...\) LaTeX delimiters to
// $$...$$ / $...$ so remark-math renders them. Applied at display time only.

const DISPLAY_MATH = /\\\[([\s\S]+?)\\\]/g
const INLINE_MATH = /\\\(([\s\S]+?)\\\)/g

export function normalizeMath(text: string): string {
  return text.replace(DISPLAY_MATH, (_m, inner) => `$$${inner}$$`).replace(INLINE_MATH, (_m, inner) => `$${inner}$`)
}
