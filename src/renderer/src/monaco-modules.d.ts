// Deep monaco-editor ESM modules that ship without declaration files.
// Grammar modules all export { conf, language }; mode modules are imported
// for side effects / cache warm-up only (see monacoLanguages.ts).
declare module 'monaco-editor/esm/vs/basic-languages/*' {
  import type { languages } from 'monaco-editor'
  export const conf: languages.LanguageConfiguration
  export const language: languages.IMonarchLanguage
}
declare module 'monaco-editor/esm/vs/language/typescript/tsMode'
declare module 'monaco-editor/esm/vs/language/json/jsonMode'
declare module 'monaco-editor/esm/vs/language/css/cssMode'
declare module 'monaco-editor/esm/vs/language/html/htmlMode'
