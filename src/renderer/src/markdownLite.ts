/**
 * Tiny markdown parser for agent output — headings, bold, inline code,
 * fenced code blocks, bullet/numbered lists. No dependency, no HTML
 * injection (returns a token tree the component renders as React nodes).
 */

export type InlineToken =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string }

export type BlockToken =
  | { kind: 'paragraph'; inline: InlineToken[] }
  | { kind: 'heading'; level: number; inline: InlineToken[] }
  | { kind: 'list-item'; ordered: boolean; inline: InlineToken[] }
  | { kind: 'code-block'; text: string; lang?: string }
  | { kind: 'blockquote'; inline: InlineToken[] }
  | { kind: 'hr' }

export function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = []
  // Code wins first (backticks beat other markers inside them), then links,
  // then bold, then italic (single * or _, not immediately re-matching **).
  const re =
    /(`[^`\n]+`)|(\[[^\]\n]+\]\([^)\n]+\))|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(_[^_\n]+_)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) tokens.push({ kind: 'text', text: text.slice(last, m.index) })
    if (m[1]) {
      tokens.push({ kind: 'code', text: m[1].slice(1, -1) })
    } else if (m[2]) {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(m[2])
      if (link) tokens.push({ kind: 'link', text: link[1], href: link[2] })
    } else if (m[3]) {
      tokens.push({ kind: 'bold', text: m[3].slice(2, -2) })
    } else if (m[4]) {
      tokens.push({ kind: 'italic', text: m[4].slice(1, -1) })
    } else if (m[5]) {
      tokens.push({ kind: 'italic', text: m[5].slice(1, -1) })
    }
    last = m.index + m[0].length
  }
  if (last < text.length) tokens.push({ kind: 'text', text: text.slice(last) })
  return tokens
}

export function parseMarkdown(text: string): BlockToken[] {
  const blocks: BlockToken[] = []
  const lines = text.split('\n')
  let codeBlock: { lang?: string; lines: string[] } | null = null

  for (const line of lines) {
    const fence = /^```(\w*)\s*$/.exec(line)
    if (fence) {
      if (codeBlock) {
        blocks.push({ kind: 'code-block', text: codeBlock.lines.join('\n'), lang: codeBlock.lang })
        codeBlock = null
      } else {
        codeBlock = { lang: fence[1] || undefined, lines: [] }
      }
      continue
    }
    if (codeBlock) {
      codeBlock.lines.push(line)
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length, inline: parseInline(heading[2]) })
      continue
    }
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ kind: 'hr' })
      continue
    }
    const quote = /^>\s?(.*)$/.exec(line)
    if (quote) {
      blocks.push({ kind: 'blockquote', inline: parseInline(quote[1]) })
      continue
    }
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line)
    if (bullet) {
      blocks.push({ kind: 'list-item', ordered: false, inline: parseInline(bullet[1]) })
      continue
    }
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (numbered) {
      blocks.push({ kind: 'list-item', ordered: true, inline: parseInline(numbered[1]) })
      continue
    }
    if (line.trim() === '') continue
    blocks.push({ kind: 'paragraph', inline: parseInline(line) })
  }
  // Unterminated fence at end of stream: show what arrived so far.
  if (codeBlock) {
    blocks.push({ kind: 'code-block', text: codeBlock.lines.join('\n'), lang: codeBlock.lang })
  }
  return blocks
}
