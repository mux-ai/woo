// Bundle monaco locally — no CDN (offline desktop app).
//
// Editor features are bundled once; language implementations are registered
// on demand by monacoLanguages.ts. This avoids shipping Monaco's complete
// language catalog while preserving offline operation.
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
import 'monaco-editor/esm/vs/editor/editor.all'
import { loader } from '@monaco-editor/react'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

self.MonacoEnvironment = {
  getWorker(_: unknown, label: string) {
    if (label === 'json') return new jsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker()
    if (label === 'typescript' || label === 'javascript') return new tsWorker()
    return new editorWorker()
  }
}

loader.config({ monaco })

// Expose for e2e probes/debugging (matches what monaco's own AMD build does).
;(globalThis as { monaco?: typeof monaco }).monaco = monaco

monaco.editor.defineTheme('woo-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#0d1117',
    'editor.lineHighlightBackground': '#161b2266',
    'editorLineNumber.foreground': '#3d444d',
    'editorGutter.background': '#0d1117'
  }
})

export { monaco }
