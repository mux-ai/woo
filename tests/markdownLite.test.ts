import { describe, it, expect } from 'vitest'
import { parseInline, parseMarkdown } from '../src/renderer/src/markdownLite'

describe('parseInline', () => {
  it('splits bold and inline code out of text', () => {
    expect(parseInline('use `npm test` and **verify** output')).toEqual([
      { kind: 'text', text: 'use ' },
      { kind: 'code', text: 'npm test' },
      { kind: 'text', text: ' and ' },
      { kind: 'bold', text: 'verify' },
      { kind: 'text', text: ' output' }
    ])
  })

  it('leaves unmatched markers as plain text', () => {
    expect(parseInline('a ** b ` c')).toEqual([{ kind: 'text', text: 'a ** b ` c' }])
  })

  it('parses links', () => {
    expect(parseInline('see [the docs](https://example.com/docs) for more')).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'link', text: 'the docs', href: 'https://example.com/docs' },
      { kind: 'text', text: ' for more' }
    ])
  })

  it('parses italics with * or _, without breaking bold', () => {
    expect(parseInline('*italic* and _also italic_ and **bold**')).toEqual([
      { kind: 'italic', text: 'italic' },
      { kind: 'text', text: ' and ' },
      { kind: 'italic', text: 'also italic' },
      { kind: 'text', text: ' and ' },
      { kind: 'bold', text: 'bold' }
    ])
  })
})

describe('parseMarkdown', () => {
  it('parses headings, lists and paragraphs', () => {
    const blocks = parseMarkdown('# Title\n\n- first\n2. second\nplain line')
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'list-item', 'list-item', 'paragraph'])
    expect(blocks[0]).toMatchObject({ level: 1 })
    expect(blocks[1]).toMatchObject({ ordered: false })
    expect(blocks[2]).toMatchObject({ ordered: true })
  })

  it('captures fenced code blocks verbatim', () => {
    const blocks = parseMarkdown('```ts\nconst x = **not bold**\n```\nafter')
    expect(blocks[0]).toEqual({
      kind: 'code-block',
      lang: 'ts',
      text: 'const x = **not bold**'
    })
    expect(blocks[1].kind).toBe('paragraph')
  })

  it('keeps an unterminated fence (mid-stream) visible', () => {
    const blocks = parseMarkdown('```\npartial code')
    expect(blocks).toEqual([{ kind: 'code-block', lang: undefined, text: 'partial code' }])
  })

  it('parses blockquotes and horizontal rules', () => {
    const blocks = parseMarkdown('> quoted line\n\n---\n\nafter')
    expect(blocks.map((b) => b.kind)).toEqual(['blockquote', 'hr', 'paragraph'])
    expect(blocks[0]).toMatchObject({ inline: [{ kind: 'text', text: 'quoted line' }] })
  })

  it('supports headings up to level 6', () => {
    expect(parseMarkdown('###### Deep heading')[0]).toMatchObject({ kind: 'heading', level: 6 })
  })
})
