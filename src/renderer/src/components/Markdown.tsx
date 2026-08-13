import { useMemo } from 'react'
import { parseMarkdown, type InlineToken } from '../markdownLite'

function Inline({ tokens }: { tokens: InlineToken[] }) {
  return (
    <>
      {tokens.map((t, i) =>
        t.kind === 'code' ? (
          <code key={i} className="md-code">
            {t.text}
          </code>
        ) : t.kind === 'bold' ? (
          <strong key={i}>{t.text}</strong>
        ) : t.kind === 'italic' ? (
          <em key={i}>{t.text}</em>
        ) : t.kind === 'link' ? (
          <span key={i} className="md-link" title={t.href}>
            {t.text}
          </span>
        ) : (
          <span key={i}>{t.text}</span>
        )
      )}
    </>
  )
}

/** Renders agent output as lightweight markdown. */
export function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text])
  return (
    <div className="md">
      {blocks.map((b, i) => {
        switch (b.kind) {
          case 'heading':
            return (
              <div key={i} className={`md-heading md-h${b.level}`}>
                <Inline tokens={b.inline} />
              </div>
            )
          case 'list-item':
            return (
              <div key={i} className="md-li">
                <span className="md-bullet">{b.ordered ? '·' : '•'}</span>
                <span>
                  <Inline tokens={b.inline} />
                </span>
              </div>
            )
          case 'code-block':
            return (
              <pre key={i} className="md-pre">
                {b.text}
              </pre>
            )
          case 'blockquote':
            return (
              <div key={i} className="md-blockquote">
                <Inline tokens={b.inline} />
              </div>
            )
          case 'hr':
            return <hr key={i} className="md-hr" />
          default:
            return (
              <p key={i} className="md-p">
                <Inline tokens={b.inline} />
              </p>
            )
        }
      })}
    </div>
  )
}
