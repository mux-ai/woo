const loaded = new Set<string>()

const loaders: Record<string, () => Promise<unknown>> = {
  typescript: () => import('monaco-editor/esm/vs/language/typescript/monaco.contribution'),
  javascript: () => import('monaco-editor/esm/vs/language/typescript/monaco.contribution'),
  json: () => import('monaco-editor/esm/vs/language/json/monaco.contribution'),
  css: () => import('monaco-editor/esm/vs/language/css/monaco.contribution'),
  scss: () => import('monaco-editor/esm/vs/language/css/monaco.contribution'),
  less: () => import('monaco-editor/esm/vs/language/css/monaco.contribution'),
  html: () => import('monaco-editor/esm/vs/language/html/monaco.contribution'),
  markdown: () => import('monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution'),
  yaml: () => import('monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution'),
  ini: () => import('monaco-editor/esm/vs/basic-languages/ini/ini.contribution'),
  kotlin: () => import('monaco-editor/esm/vs/basic-languages/kotlin/kotlin.contribution'),
  python: () => import('monaco-editor/esm/vs/basic-languages/python/python.contribution'),
  go: () => import('monaco-editor/esm/vs/basic-languages/go/go.contribution'),
  rust: () => import('monaco-editor/esm/vs/basic-languages/rust/rust.contribution'),
  java: () => import('monaco-editor/esm/vs/basic-languages/java/java.contribution'),
  cpp: () => import('monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution'),
  csharp: () => import('monaco-editor/esm/vs/basic-languages/csharp/csharp.contribution'),
  ruby: () => import('monaco-editor/esm/vs/basic-languages/ruby/ruby.contribution'),
  php: () => import('monaco-editor/esm/vs/basic-languages/php/php.contribution'),
  swift: () => import('monaco-editor/esm/vs/basic-languages/swift/swift.contribution'),
  sql: () => import('monaco-editor/esm/vs/basic-languages/sql/sql.contribution'),
  xml: () => import('monaco-editor/esm/vs/basic-languages/xml/xml.contribution'),
  dockerfile: () => import('monaco-editor/esm/vs/basic-languages/dockerfile/dockerfile.contribution'),
  shell: () => import('monaco-editor/esm/vs/basic-languages/shell/shell.contribution')
}

export async function ensureMonacoLanguage(language: string): Promise<void> {
  const group = language === 'javascript' ? 'typescript'
    : language === 'scss' || language === 'less' ? 'css'
      : language
  if (loaded.has(group)) return
  const load = loaders[language]
  if (!load) return
  await load()
  loaded.add(group)
}
