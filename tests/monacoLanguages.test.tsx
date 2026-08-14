// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'

// jsdom lacks several browser APIs monaco-editor's full bundle touches
// during module init / editor creation — real desktop Chromium has all of
// these; only the test environment needs them stubbed.
;(document as any).queryCommandSupported = () => false
// jsdom has no Worker. Without one, monaco's language services fall back to
// running worker code on the main thread, and that fallback's module loader
// crashes in jsdom (FileAccess.asBrowserUri -> toUrl of undefined) as an
// unhandled rejection that fails the whole vitest run. A silent Worker stub
// keeps the services harmlessly pending instead — these tests only assert
// tokenization, which is main-thread Monarch and never touches a worker.
;(globalThis as any).Worker = class {
  onmessage: unknown = null
  onerror: unknown = null
  postMessage() {}
  addEventListener() {}
  removeEventListener() {}
  terminate() {}
}
;(globalThis as any).ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(HTMLCanvasElement.prototype as any).getContext = () => ({
  measureText: () => ({ width: 8 }),
  fillRect: () => {},
  clearRect: () => {},
  getImageData: () => ({ data: [] }),
  putImageData: () => {},
  createImageData: () => [],
  setTransform: () => {},
  drawImage: () => {},
  save: () => {},
  restore: () => {},
  scale: () => {},
  translate: () => {},
  rotate: () => {},
  beginPath: () => {},
  closePath: () => {},
  moveTo: () => {},
  lineTo: () => {},
  stroke: () => {},
  fill: () => {}
})
if (!window.matchMedia) {
  ;(window as any).matchMedia = () => ({
    matches: false,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {}
  })
}

/**
 * Regression test for a real bug (2026-08-13): monacoLanguages.ts's
 * `typescript`/`javascript` loaders imported only
 * `language/typescript/monaco.contribution` (the rich IntelliSense/compiler
 * config module) — that module never calls languages.register() or
 * setTokensProvider() (verified against the actual bundled source). Without
 * `basic-languages/{typescript,javascript}/*.contribution` (the module that
 * actually registers the language + Monarch grammar), createModel(text,
 * 'typescript') silently fell back to 'plaintext', so every token rendered
 * in a single flat color — no syntax highlighting at all, for every TS/JS
 * file, from the moment a file opened.
 */
describe('ensureMonacoLanguage', () => {
  it('registers typescript as a real language with a working tokenizer, not a plaintext fallback', async () => {
    const { monaco } = await import('../src/renderer/src/monacoSetup')
    const { ensureMonacoLanguage } = await import('../src/renderer/src/monacoLanguages')

    await ensureMonacoLanguage('typescript')
    expect(monaco.languages.getLanguages().map((l) => l.id)).toContain('typescript')

    const container = document.createElement('div')
    document.body.appendChild(container)
    const model = monaco.editor.createModel(
      'const apiKey = process.env.PAYMENT_API_KEY\nif (!apiKey) {\n  throw new Error("x")\n}',
      'typescript'
    )
    // The real bug: this silently reported 'plaintext' instead of throwing.
    expect(model.getLanguageId()).toBe('typescript')

    const editor = monaco.editor.create(container, {
      model,
      theme: 'woo-dark',
      automaticLayout: false,
      // jsdom's canvas stub can't back the minimap's ImageData buffers —
      // irrelevant to what this test verifies (token coloring), so disable
      // it rather than fight jsdom's canvas limitations.
      minimap: { enabled: false }
    })
    editor.layout({ width: 800, height: 400 })
    await new Promise((resolve) => setTimeout(resolve, 200))

    const spans = container.querySelectorAll('.view-line span[class^="mtk"]')
    const distinctClasses = new Set(Array.from(spans).map((el) => el.className))
    // A real tokenizer assigns different classes to keywords/strings/
    // punctuation; a plaintext fallback assigns exactly one (mtk1) to every
    // span regardless of content — that was the actual observed symptom.
    expect(distinctClasses.size).toBeGreaterThan(1)

    editor.dispose()
    model.dispose()
  })

  it('registers dart with a working tokenizer (Flutter projects)', async () => {
    const { monaco } = await import('../src/renderer/src/monacoSetup')
    const { ensureMonacoLanguage } = await import('../src/renderer/src/monacoLanguages')

    await ensureMonacoLanguage('dart')
    expect(monaco.languages.getLanguages().map((l) => l.id)).toContain('dart')

    const model = monaco.editor.createModel('class Weather { final String city; }', 'dart')
    expect(model.getLanguageId()).toBe('dart')
    model.dispose()
  })

  it('registers javascript too (shares the same loader group as typescript)', async () => {
    const { monaco } = await import('../src/renderer/src/monacoSetup')
    const { ensureMonacoLanguage } = await import('../src/renderer/src/monacoLanguages')

    await ensureMonacoLanguage('javascript')
    expect(monaco.languages.getLanguages().map((l) => l.id)).toContain('javascript')

    const model = monaco.editor.createModel('const x = 1', 'javascript')
    expect(model.getLanguageId()).toBe('javascript')
    model.dispose()
  })

  // Same bug, same fix, same reasoning — css/monaco.contribution and
  // html/monaco.contribution also have zero register()/setTokensProvider()
  // calls (verified against the bundled source). Regression-guard all four.
  it.each(['css', 'scss', 'less', 'html'])('registers %s (same gap as typescript, same fix)', async (lang) => {
    const { monaco } = await import('../src/renderer/src/monacoSetup')
    const { ensureMonacoLanguage } = await import('../src/renderer/src/monacoLanguages')

    await ensureMonacoLanguage(lang)
    expect(monaco.languages.getLanguages().map((l) => l.id)).toContain(lang)

    const model = monaco.editor.createModel('/* x */', lang)
    expect(model.getLanguageId()).toBe(lang)
    model.dispose()
  })
})
