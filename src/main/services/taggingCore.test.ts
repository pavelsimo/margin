import { describe, expect, it } from 'vitest'
import { parseTags } from './taggingCore'

// Oracle: margin/tagging.py parse_tags semantics.
describe('parseTags', () => {
  it('parses a plain JSON array', () => {
    expect(parseTags('["MoE", "RAG"]')).toEqual(['MoE', 'RAG'])
  })
  it('tolerates code fences and preamble', () => {
    expect(parseTags('Here you go:\n```json\n["Sparse Attention"]\n```')).toEqual(['Sparse Attention'])
  })
  it('drops generic, duplicate, over-long, and multi-word-limit tags', () => {
    expect(
      parseTags(
        JSON.stringify(['AI', 'MoE', 'moe', 'a b c d e', 'x'.repeat(41), 'with,comma', 'Knowledge Distillation']),
      ),
    ).toEqual(['MoE', 'Knowledge Distillation'])
  })
  it('strips leading # and collapses whitespace', () => {
    expect(parseTags('["#RAG", "Long   Context"]')).toEqual(['RAG', 'Long Context'])
  })
  it('reuses canonical casing from the existing vocabulary', () => {
    expect(parseTags('["moe", "rag"]', ['MoE', 'RAG'])).toEqual(['MoE', 'RAG'])
  })
  it('caps at 5 tags', () => {
    expect(parseTags('["a1","a2","a3","a4","a5","a6"]')).toHaveLength(5)
  })
  it('throws when nothing usable remains', () => {
    expect(() => parseTags('no array here')).toThrow('did not contain a JSON array')
    expect(() => parseTags('[1, 2]')).toThrow('array of strings')
    expect(() => parseTags('["AI"]')).toThrow('usable topic tags')
  })
})
