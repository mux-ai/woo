import { useEffect, useRef, useState, type ReactNode } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import { monaco } from '../monacoSetup'
import { ensureMonacoLanguage } from '../monacoLanguages'
import { Markdown } from './Markdown'
import type { Diagnostic } from '../../../shared/types'

export interface OpenFile {
  path: string
  content: string | null // last saved content
  dirty?: boolean
}

export interface RuleActionHandlers {
  quickFix: (d: Diagnostic) => void
  fixWithAgent: (d: Diagnostic) => void
  proposeRuleChange: (d: Diagnostic) => void
  suppress: (d: Diagnostic) => void
}

/** A non-file tab sharing the editor's tab strip (e.g. a drafted agent
 *  plan) — no save/dirty semantics, just focus + close. */
export interface VirtualTab {
  label: string
  focused: boolean
  onFocus: () => void
  onClose: () => void
  content: ReactNode
}

const LANG_BY_EXT: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  md: 'markdown',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'ini',
  kt: 'kotlin',
  kts: 'kotlin',
  py: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java',
  c: 'cpp',
  cc: 'cpp',
  cpp: 'cpp',
  cxx: 'cpp',
  h: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  rb: 'ruby',
  php: 'php',
  swift: 'swift',
  sql: 'sql',
  xml: 'xml',
  gradle: 'java', // monaco has no groovy grammar; java is the closest fit
  dockerfile: 'dockerfile',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell'
}

function language(path: string): string {
  const ext = path.split('.').pop() ?? ''
  return LANG_BY_EXT[ext] ?? 'plaintext'
}

function isMarkdown(path: string): boolean {
  return language(path) === 'markdown'
}

const SEVERITY_MAP = {
  error: monaco.MarkerSeverity.Error,
  warning: monaco.MarkerSeverity.Warning,
  info: monaco.MarkerSeverity.Info
} as const

// ── Rule hover cards + code actions ─────────────────────────────────────
// Providers and commands are global to Monaco, so they register once and
// route through mutable refs to reach the current React handlers/state.

let currentHandlers: RuleActionHandlers | null = null
let currentDiagnostics: Diagnostic[] = []
let providersRegistered = false
let knowledgeCompletionRequested = false

function nearbyCompletionTerms(
  model: import('monaco-editor').editor.ITextModel,
  position: import('monaco-editor').Position
): string[] {
  const startLineNumber = Math.max(1, position.lineNumber - 8)
  const context = model.getValueInRange({
    startLineNumber,
    startColumn: 1,
    endLineNumber: position.lineNumber,
    endColumn: position.column
  })
  const matches = context.match(/[A-Za-z_$][A-Za-z0-9_$]{2,}/g) ?? []
  return [...new Set(matches.reverse())].slice(0, 32)
}

function modelPath(model: { uri: { path: string } }): string {
  return model.uri.path.replace(/^\//, '')
}

function diagnosticsAtLine(path: string, line: number): Diagnostic[] {
  return currentDiagnostics.filter((d) => d.file === path && d.line === line)
}

/** Actions that make sense for a given diagnostic. */
function actionsFor(d: Diagnostic): { id: string; title: string }[] {
  const actions: { id: string; title: string }[] = []
  if (d.ruleId === 'SEC-BUILTIN') actions.push({ id: 'woo.quickFix', title: 'Quick Fix' })
  actions.push({ id: 'woo.fixWithAgent', title: 'Fix with Agent' })
  if (d.definedIn && d.definedIn !== 'built-in') {
    actions.push({ id: 'woo.proposeRuleChange', title: 'Propose Rule Change' })
  }
  // JSON has no comments — a woo-ignore line would corrupt the file.
  if (!d.file.endsWith('.json')) actions.push({ id: 'woo.suppress', title: 'Suppress' })
  return actions
}

function registerRuleProviders(): void {
  if (providersRegistered) return
  providersRegistered = true

  const commandOf: Record<string, keyof RuleActionHandlers> = {
    'woo.quickFix': 'quickFix',
    'woo.fixWithAgent': 'fixWithAgent',
    'woo.proposeRuleChange': 'proposeRuleChange',
    'woo.suppress': 'suppress'
  }
  for (const [id, key] of Object.entries(commandOf)) {
    monaco.editor.registerCommand(id, (_accessor, diag: Diagnostic) => {
      currentHandlers?.[key](diag)
    })
  }

  monaco.languages.registerHoverProvider('*', {
    provideHover(model, position) {
      const diags = diagnosticsAtLine(modelPath(model), position.lineNumber)
      if (diags.length === 0) return null
      const contents = diags.map((d) => {
        const links = actionsFor(d)
          .map(
            (a) =>
              `[${a.title}](command:${a.id}?${encodeURIComponent(JSON.stringify([d]))})`
          )
          .join(' · ')
        const definedIn =
          d.definedIn && d.definedIn !== 'built-in' ? `\n\nDefined in \`${d.definedIn}\`` : ''
        return {
          value: `**${d.ruleId}** — ${d.message.replace(`${d.ruleId}: `, '')}${definedIn}\n\n${links}`,
          isTrusted: true
        }
      })
      return { contents }
    }
  })

  monaco.languages.registerCodeActionProvider('*', {
    provideCodeActions(model, range) {
      const path = modelPath(model)
      const actions: import('monaco-editor').languages.CodeAction[] = []
      for (let line = range.startLineNumber; line <= range.endLineNumber; line++) {
        for (const d of diagnosticsAtLine(path, line)) {
          for (const a of actionsFor(d)) {
            actions.push({
              title: `${a.title}: ${d.ruleId}`,
              kind: 'quickfix',
              command: { id: a.id, title: a.title, arguments: [d] }
            })
          }
        }
      }
      return { actions, dispose: () => {} }
    }
  })

  monaco.languages.registerCompletionItemProvider('*', {
    async provideCompletionItems(model, position, _context, token) {
      // The custom Ctrl/Cmd+Space action sets this flag. Normal typing keeps
      // Monaco's own language suggestions but does not query project knowledge.
      if (!knowledgeCompletionRequested) return { suggestions: [] }
      knowledgeCompletionRequested = false
      const word = model.getWordUntilPosition(position)
      try {
        const suggestions = await window.woo.knowledgeComplete({
          path: modelPath(model),
          language: model.getLanguageId(),
          prefix: word.word,
          terms: nearbyCompletionTerms(model, position)
        })
        if (token.isCancellationRequested) return { suggestions: [] }
        const range = new monaco.Range(
          position.lineNumber,
          word.startColumn,
          position.lineNumber,
          word.endColumn
        )
        return {
          suggestions: suggestions.map((suggestion, index) => ({
            label: suggestion.label,
            insertText: suggestion.insertText,
            detail: suggestion.detail,
            documentation: {
              value: `${suggestion.documentation}\n\nSource: \`${suggestion.sourcePath}\``
            },
            kind: suggestion.kind === 'path'
              ? monaco.languages.CompletionItemKind.File
              : monaco.languages.CompletionItemKind.Reference,
            range,
            sortText: `10-knowledge-${String(index).padStart(2, '0')}`
          }))
        }
      } catch {
        return { suggestions: [] }
      }
    }
  })
}

export function EditorArea({
  files,
  activePath,
  onSelect,
  onClose,
  onSave,
  onDirty,
  diagnostics,
  ruleActions,
  virtualTab
}: {
  files: OpenFile[]
  activePath: string | null
  onSelect: (path: string) => void
  onClose: (path: string) => void
  onSave: (path: string, content: string) => void
  onDirty: (path: string, currentValue: string) => void
  diagnostics: Diagnostic[]
  ruleActions: RuleActionHandlers
  virtualTab?: VirtualTab | null
}) {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null)
  const active = files.find((f) => f.path === activePath)
  // Markdown files default to a rendered "reading" view; per-file override
  // once the user explicitly picks Source or Preview for that path.
  const [previewOverride, setPreviewOverride] = useState<Record<string, boolean>>({})
  const previewing = active
    ? (previewOverride[active.path] ?? isMarkdown(active.path))
    : false

  // Keep the module-level refs the Monaco providers read in sync.
  currentHandlers = ruleActions
  currentDiagnostics = diagnostics

  // Push rule violations into Monaco markers for the active file.
  useEffect(() => {
    const editor = editorRef.current
    if (!editor || !activePath) return
    const model = editor.getModel()
    if (!model) return
    const markers = diagnostics
      .filter((d) => d.file === activePath)
      .map((d) => ({
        severity: SEVERITY_MAP[d.severity],
        message: `${d.message}${d.definedIn ? `\nDefined in: ${d.definedIn}` : ''}`,
        startLineNumber: d.line,
        startColumn: d.column,
        endLineNumber: d.line,
        endColumn: model.getLineMaxColumn(Math.min(d.line, model.getLineCount())),
        source: d.source
      }))
    monaco.editor.setModelMarkers(model, 'woo-rules', markers)
  }, [diagnostics, activePath, active?.content])

  const handleMount: OnMount = (editor) => {
    editorRef.current = editor
    registerRuleProviders()
    const path = editor.getModel()?.uri.path.replace(/^\//, '')
    const selectedLanguage = path ? language(path) : 'plaintext'
    void ensureMonacoLanguage(selectedLanguage).then(() => {
      const model = editor.getModel()
      if (model && model.getLanguageId() !== selectedLanguage) {
        monaco.editor.setModelLanguage(model, selectedLanguage)
      }
    })
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      const path = editor.getModel()?.uri.path.replace(/^\//, '')
      if (path) onSave(path, editor.getValue())
    })
    editor.addAction({
      id: 'woo.knowledgeCompletion',
      label: 'Knowledge: Suggest Completion',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Space],
      run: (activeEditor) => {
        knowledgeCompletionRequested = true
        activeEditor.trigger('woo.knowledgeCompletion', 'editor.action.triggerSuggest', {})
      }
    })
  }

  useEffect(() => {
    if (!activePath) return
    const selectedLanguage = language(activePath)
    void ensureMonacoLanguage(selectedLanguage).then(() => {
      const model = editorRef.current?.getModel()
      if (model && model.getLanguageId() !== selectedLanguage) {
        monaco.editor.setModelLanguage(model, selectedLanguage)
      }
    })
  }, [activePath])

  return (
    <div className="editor-area">
      <div className="tabs">
        {virtualTab && (
          <div className={`tab ${virtualTab.focused ? 'active' : ''}`}>
            <button
              className="tab-select"
              role="tab"
              aria-selected={virtualTab.focused}
              onClick={virtualTab.onFocus}
            >
              <span>{virtualTab.label}</span>
            </button>
            <button
              className="tab-close"
              aria-label={`Close ${virtualTab.label}`}
              onClick={(e) => {
                e.stopPropagation()
                virtualTab.onClose()
              }}
            >
              ×
            </button>
          </div>
        )}
        {files.map((f) => (
          <div
            key={f.path}
            className={`tab ${!virtualTab?.focused && f.path === activePath ? 'active' : ''}`}
          >
            <button
              className="tab-select"
              role="tab"
              aria-selected={!virtualTab?.focused && f.path === activePath}
              onClick={() => onSelect(f.path)}
            >
              <span>{f.path.split('/').pop()}</span>
              {f.dirty && <span className="tab-dirty" title="Unsaved changes">●</span>}
            </button>
            <button
              className="tab-close"
              aria-label={`Close ${f.path}`}
              onClick={(e) => {
                e.stopPropagation()
                onClose(f.path)
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      {virtualTab?.focused ? (
        virtualTab.content
      ) : active ? (
        <>
          <div className="breadcrumbs">
            <span>{active.path.split('/').join(' › ')}</span>
            {!previewing && (
              <button
                className="editor-knowledge-completion"
                title="Show local, source-attributed project knowledge suggestions"
                onClick={() => {
                  const editor = editorRef.current
                  if (!editor) return
                  editor.focus()
                  knowledgeCompletionRequested = true
                  editor.trigger('woo.knowledgeCompletion', 'editor.action.triggerSuggest', {})
                }}
              >
                ◈ Suggest <kbd>⌘/Ctrl+Space</kbd>
              </button>
            )}
            {isMarkdown(active.path) && (
              <div className="editor-mode-toggle">
                <button
                  className={previewing ? 'active' : ''}
                  onClick={() => setPreviewOverride((prev) => ({ ...prev, [active.path]: true }))}
                >
                  👁 Preview
                </button>
                <button
                  className={!previewing ? 'active' : ''}
                  onClick={() => setPreviewOverride((prev) => ({ ...prev, [active.path]: false }))}
                >
                  {'</>'} Source
                </button>
              </div>
            )}
          </div>
          {previewing ? (
            <div className="markdown-preview">
              <Markdown text={active.content ?? ''} />
            </div>
          ) : (
            <div className="editor-host">
              <Editor
                path={active.path}
                language={language(active.path)}
                value={active.content ?? ''}
                theme="woo-dark"
                onChange={(value) => onDirty(active.path, value ?? '')}
                onMount={handleMount}
                options={{
                  minimap: { enabled: true },
                  fontSize: 13,
                  automaticLayout: true,
                  scrollBeyondLastLine: false,
                  renderLineHighlight: 'all',
                  suggest: { showStatusBar: true }
                }}
              />
            </div>
          )}
        </>
      ) : (
        <div className="editor-empty">
          <div className="editor-empty-logo">◈</div>
          <div>Open a file from the Explorer, or ask the Agent for a change.</div>
          <div className="editor-empty-hint">Ctrl+S saves · rules re-check on save</div>
        </div>
      )}
    </div>
  )
}
