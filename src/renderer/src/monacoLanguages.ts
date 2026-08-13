import type * as monacoTypes from 'monaco-editor'
import { monaco } from './monacoSetup'

const loaded = new Set<string>()

type GrammarModule = {
  conf: monacoTypes.languages.LanguageConfiguration
  language: monacoTypes.languages.IMonarchLanguage
}

// The basic-languages *.contribution modules register the language id +
// extensions but attach the Monarch tokenizer through a LAZY factory whose
// internal dynamic import stalls in the packaged file:// renderer (verified
// live: language id registered, models tagged 'typescript', yet every token
// stayed mtk1 and monaco.editor.colorize() fell back to plaintext, with zero
// console errors — the factory's chunk load simply never completed). So each
// loader here imports the grammar module eagerly and registers the tokenizer
// + language configuration explicitly; setMonarchTokensProvider replaces the
// stalled factory and recolors open editors immediately (verified live).
async function registerGrammar(id: string, mod: Promise<unknown>): Promise<void> {
  const grammar = (await mod) as GrammarModule
  monaco.languages.setMonarchTokensProvider(id, grammar.language)
  monaco.languages.setLanguageConfiguration(id, grammar.conf)
}

// The language-SERVICE contributions (language/{typescript,css,html,json})
// have the same stall one layer deeper: their onLanguage hook lazy-imports a
// mode chunk (tsMode/cssMode/htmlMode/jsonMode) that never finishes loading,
// so no worker ever starts — no IntelliSense, no diagnostics (verified live:
// getTypeScriptWorker() threw "TypeScript not registered!" and only
// editor.worker was running). Importing the same chunk eagerly here warms
// Vite's module/preload caches so the contribution's own import resolves.
const loaders: Record<string, () => Promise<void>> = {
  typescript: async () => {
    await Promise.all([
      import('monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution'),
      import('monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution'),
      import('monaco-editor/esm/vs/language/typescript/monaco.contribution'),
      import('monaco-editor/esm/vs/language/typescript/tsMode')
    ])
    await Promise.all([
      registerGrammar('typescript', import('monaco-editor/esm/vs/basic-languages/typescript/typescript')),
      registerGrammar('javascript', import('monaco-editor/esm/vs/basic-languages/javascript/javascript'))
    ])
  },
  // json/monaco.contribution registers the language itself; tokenization and
  // the worker both live in jsonMode, so the warm-up import covers them.
  json: async () => {
    await Promise.all([
      import('monaco-editor/esm/vs/language/json/monaco.contribution'),
      import('monaco-editor/esm/vs/language/json/jsonMode')
    ])
  },
  css: async () => {
    await Promise.all([
      import('monaco-editor/esm/vs/basic-languages/css/css.contribution'),
      import('monaco-editor/esm/vs/basic-languages/scss/scss.contribution'),
      import('monaco-editor/esm/vs/basic-languages/less/less.contribution'),
      import('monaco-editor/esm/vs/language/css/monaco.contribution'),
      import('monaco-editor/esm/vs/language/css/cssMode')
    ])
    await Promise.all([
      registerGrammar('css', import('monaco-editor/esm/vs/basic-languages/css/css')),
      registerGrammar('scss', import('monaco-editor/esm/vs/basic-languages/scss/scss')),
      registerGrammar('less', import('monaco-editor/esm/vs/basic-languages/less/less'))
    ])
  },
  html: async () => {
    await Promise.all([
      import('monaco-editor/esm/vs/basic-languages/html/html.contribution'),
      import('monaco-editor/esm/vs/language/html/monaco.contribution'),
      import('monaco-editor/esm/vs/language/html/htmlMode')
    ])
    await registerGrammar('html', import('monaco-editor/esm/vs/basic-languages/html/html'))
  },
  markdown: async () => {
    await import('monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution')
    await registerGrammar('markdown', import('monaco-editor/esm/vs/basic-languages/markdown/markdown'))
  },
  yaml: async () => {
    await import('monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution')
    await registerGrammar('yaml', import('monaco-editor/esm/vs/basic-languages/yaml/yaml'))
  },
  ini: async () => {
    await import('monaco-editor/esm/vs/basic-languages/ini/ini.contribution')
    await registerGrammar('ini', import('monaco-editor/esm/vs/basic-languages/ini/ini'))
  },
  kotlin: async () => {
    await import('monaco-editor/esm/vs/basic-languages/kotlin/kotlin.contribution')
    await registerGrammar('kotlin', import('monaco-editor/esm/vs/basic-languages/kotlin/kotlin'))
  },
  python: async () => {
    await import('monaco-editor/esm/vs/basic-languages/python/python.contribution')
    await registerGrammar('python', import('monaco-editor/esm/vs/basic-languages/python/python'))
  },
  go: async () => {
    await import('monaco-editor/esm/vs/basic-languages/go/go.contribution')
    await registerGrammar('go', import('monaco-editor/esm/vs/basic-languages/go/go'))
  },
  rust: async () => {
    await import('monaco-editor/esm/vs/basic-languages/rust/rust.contribution')
    await registerGrammar('rust', import('monaco-editor/esm/vs/basic-languages/rust/rust'))
  },
  java: async () => {
    await import('monaco-editor/esm/vs/basic-languages/java/java.contribution')
    await registerGrammar('java', import('monaco-editor/esm/vs/basic-languages/java/java'))
  },
  cpp: async () => {
    await import('monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution')
    await registerGrammar('cpp', import('monaco-editor/esm/vs/basic-languages/cpp/cpp'))
  },
  csharp: async () => {
    await import('monaco-editor/esm/vs/basic-languages/csharp/csharp.contribution')
    await registerGrammar('csharp', import('monaco-editor/esm/vs/basic-languages/csharp/csharp'))
  },
  ruby: async () => {
    await import('monaco-editor/esm/vs/basic-languages/ruby/ruby.contribution')
    await registerGrammar('ruby', import('monaco-editor/esm/vs/basic-languages/ruby/ruby'))
  },
  php: async () => {
    await import('monaco-editor/esm/vs/basic-languages/php/php.contribution')
    await registerGrammar('php', import('monaco-editor/esm/vs/basic-languages/php/php'))
  },
  swift: async () => {
    await import('monaco-editor/esm/vs/basic-languages/swift/swift.contribution')
    await registerGrammar('swift', import('monaco-editor/esm/vs/basic-languages/swift/swift'))
  },
  sql: async () => {
    await import('monaco-editor/esm/vs/basic-languages/sql/sql.contribution')
    await registerGrammar('sql', import('monaco-editor/esm/vs/basic-languages/sql/sql'))
  },
  xml: async () => {
    await import('monaco-editor/esm/vs/basic-languages/xml/xml.contribution')
    await registerGrammar('xml', import('monaco-editor/esm/vs/basic-languages/xml/xml'))
  },
  dockerfile: async () => {
    await import('monaco-editor/esm/vs/basic-languages/dockerfile/dockerfile.contribution')
    await registerGrammar('dockerfile', import('monaco-editor/esm/vs/basic-languages/dockerfile/dockerfile'))
  },
  shell: async () => {
    await import('monaco-editor/esm/vs/basic-languages/shell/shell.contribution')
    await registerGrammar('shell', import('monaco-editor/esm/vs/basic-languages/shell/shell'))
  }
}

export async function ensureMonacoLanguage(language: string): Promise<void> {
  const group = language === 'javascript' ? 'typescript'
    : language === 'scss' || language === 'less' ? 'css'
      : language
  if (loaded.has(group)) return
  const load = loaders[group]
  if (!load) return
  await load()
  loaded.add(group)
}
