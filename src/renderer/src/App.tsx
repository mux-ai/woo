import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AccountChoice,
  AgentSessionEvent,
  AuthProvider,
  ContextPack,
  ContextTokenEstimate,
  KnowledgeSyncReview,
  ModelMode,
  Diagnostic,
  FileNode,
  KnowledgeGraph,
  KnowledgeStatus,
  SourceGraph,
  SetupStatus,
  WorkspaceInfo
} from '../../shared/types'
import type { GitDiff } from '../../shared/types'
import { ActivityBar, type ViewId } from './components/ActivityBar'
import { FileExplorer, type FileOps } from './components/FileExplorer'
import { KnowledgePanel } from './components/KnowledgePanel'
import type { OpenFile, RuleActionHandlers } from './components/EditorArea'
import { ProblemsPanel } from './components/ProblemsPanel'
import { AgentPanel } from './components/AgentPanel'
import { AgentTaskView } from './components/AgentTaskView'
import { Resizer } from './components/Resizer'
import { GraphView } from './components/GraphView'
import { ContextPackView } from './components/ContextPackView'
import { StatusBar } from './components/StatusBar'
import { SearchPanel } from './components/SearchPanel'
import { GitPanel } from './components/GitPanel'
import { CommandPalette, type PaletteItem } from './components/CommandPalette'
import { SkillsPanel } from './components/SkillsPanel'
import { VaultPanel } from './components/VaultPanel'
import { SetupPanel } from './components/SetupPanel'
import { PrivacyPanel } from './components/PrivacyPanel'

const EditorArea = lazy(async () => ({
  default: (await import('./components/EditorArea')).EditorArea
}))
const DiffEditor = lazy(async () => ({
  default: (await import('@monaco-editor/react')).DiffEditor
}))

function EditorLoading() {
  return <div className="editor-empty">Loading editor…</div>
}

/** Comment token for a woo-ignore line, by file extension. */
function commentTokenFor(path: string): string {
  return /\.(py|sh|ya?ml|toml)$/.test(path) ? '#' : '//'
}

const PROVIDER_DISPLAY_NAME: Record<AuthProvider, string> = {
  claude: 'Claude',
  codex: 'Codex',
  opencode: 'OpenCode',
  'opencode-go': 'OpenCode Go'
}

export function App() {
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null)
  const [tree, setTree] = useState<FileNode[]>([])
  const [treeVersion, setTreeVersion] = useState(0)
  const [allPaths, setAllPaths] = useState<string[]>([])
  const [knowledgeStatus, setKnowledgeStatus] = useState<KnowledgeStatus | null>(null)
  const [graph, setGraph] = useState<KnowledgeGraph | null>(null)
  const [sourceGraph, setSourceGraph] = useState<SourceGraph | null>(null)
  const [view, setView] = useState<ViewId>('explorer')
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([])
  const [agentEvents, setAgentEvents] = useState<AgentSessionEvent[]>([])
  const [agentRunning, setAgentRunning] = useState(false)
  const [contextPack, setContextPack] = useState<ContextPack | null>(null)
  const [showAgent, setShowAgent] = useState(true)
  const [graphFocus, setGraphFocus] = useState<string | null>(null)
  const [output, setOutput] = useState<string[]>([])
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [gitDiff, setGitDiff] = useState<GitDiff | null>(null)
  const [maximized, setMaximized] = useState(false)
  const [ctxPinned, setCtxPinned] = useState(false)
  const [agentProvider, setAgentProvider] = useState<AuthProvider>('claude')
  const [knowledgeSyncReview, setKnowledgeSyncReview] = useState<KnowledgeSyncReview | null>(null)
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null)
  const [recoveryHydrated, setRecoveryHydrated] = useState(false)
  const [graphAffectedDocumentIds, setGraphAffectedDocumentIds] = useState<string[]>([])
  const [graphChangedFiles, setGraphChangedFiles] = useState<string[]>([])
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(210)
  const [agentPanelWidth, setAgentPanelWidth] = useState(330)
  const [problemsPanelHeight, setProblemsPanelHeight] = useState(260)
  // Agent chat (bottom AGENT tab) + drafted-plan editor tab — lifted out of
  // AgentPanel so the input lives in the tab strip and the plan lives in
  // the editor area, per user request 2026-08-11.
  const [agentTask, setAgentTask] = useState('')
  const [agentModelMode, setAgentModelMode] = useState<ModelMode>('auto')
  const [agentPlanning, setAgentPlanning] = useState(false)
  const [agentActiveTask, setAgentActiveTask] = useState('')
  const [agentPlanSteps, setAgentPlanSteps] = useState<string[] | null>(null)
  const [agentPlanText, setAgentPlanText] = useState('')
  const [agentPlanPreviousText, setAgentPlanPreviousText] = useState<string | null>(null)
  const [agentPlanImproving, setAgentPlanImproving] = useState(false)
  const [agentPlanError, setAgentPlanError] = useState<string | null>(null)
  const [agentEditingPlan, setAgentEditingPlan] = useState(false)
  const [agentAccountChoice, setAgentAccountChoice] = useState<AccountChoice | null>(null)
  const [agentEstimate, setAgentEstimate] = useState<ContextTokenEstimate | null>(null)
  // Which tab has focus in the shared editor tab strip — the drafted plan
  // (virtual tab) or a real file. Lets the plan stay open while browsing
  // files instead of blocking the editor entirely.
  const [agentTaskTabFocused, setAgentTaskTabFocused] = useState(false)
  const userSelectedView = useRef(false)

  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
  const resizeSidebar = useCallback(
    (delta: number) => setSidebarWidth((w) => clamp(w + delta, 150, 480)),
    []
  )
  const resizeAgentPanel = useCallback(
    (delta: number) => setAgentPanelWidth((w) => clamp(w - delta, 240, 600)),
    []
  )
  const resizeProblemsPanel = useCallback(
    (delta: number) => setProblemsPanelHeight((h) => clamp(h - delta, 120, 640)),
    []
  )

  useEffect(() => {
    window.woo.windowIsMaximized().then(setMaximized).catch(() => {})
    return window.woo.onWindowMaximized(setMaximized)
  }, [])

  const log = useCallback((line: string) => {
    const stamp = new Date().toLocaleTimeString()
    setOutput((prev) => [...prev.slice(-499), `[${stamp}] ${line}`])
  }, [])

  const togglePin = useCallback(() => {
    void window.woo
      .agentPin(agentProvider, !ctxPinned, contextPack?.task)
      .then(setCtxPinned)
  }, [agentProvider, contextPack?.task, ctxPinned])

  const refreshPack = useCallback(
    (task: string) => {
      void window.woo
        .knowledgeRetrieve(task)
        .then(setContextPack)
        .catch((err) => log(`Retrieve failed: ${String((err as Error).message ?? err)}`))
    },
    [log]
  )

  // Knowledge-base lint: dangling relationship edges land in Problems.
  const refreshKnowledgeLint = useCallback(() => {
    window.woo
      .knowledgeValidate()
      .then((diags) =>
        setDiagnostics((prev) => [...prev.filter((d) => d.source !== 'Knowledge Graph'), ...diags])
      )
      .catch(() => {})
  }, [])

  const refreshSetup = useCallback(() => {
    void window.woo.setupStatus().then(setSetupStatus).catch(() => setSetupStatus(null))
  }, [])

  useEffect(() => {
    window.woo.workspaceInfo().then(setWorkspace)
    window.woo.filesList().then(setTree)
    window.woo.knowledgeStatus().then(setKnowledgeStatus).catch(() => setKnowledgeStatus(null))
    window.woo.knowledgeGraph().then(setGraph).catch(() => setGraph(null))
    window.woo.sourceGraph().then(setSourceGraph).catch(() => setSourceGraph(null))
    refreshKnowledgeLint()
    window.woo.setupStatus().then((status) => {
      setSetupStatus(status)
      if (!status.ready && !userSelectedView.current) setView('setup')
    }).catch(() => {})
    return window.woo.onAgentEvent((event) => {
      setAgentEvents((prev) => {
        const last = prev[prev.length - 1]
        // Streaming deltas replace the previous partial; the final complete
        // 'text' message replaces the stream block outright.
        if (event.type === 'text-stream' && last?.type === 'text-stream') {
          return [...prev.slice(0, -1), event]
        }
        if (event.type === 'text' && last?.type === 'text-stream') {
          return [...prev.slice(0, -1), event]
        }
        return [...prev, event]
      })
      if (event.type === 'context-pack' && event.pack) setContextPack(event.pack)
      if (event.type === 'knowledge-sync' && event.sync) {
        setKnowledgeSyncReview(event.sync)
        setGraphAffectedDocumentIds(event.sync.proposals.map((proposal) => proposal.documentId))
        setGraphChangedFiles(event.sync.changedFiles)
      }
      if (event.type === 'context-invalidated') {
        setCtxPinned(false)
        setContextPack(null)
        log(event.text ?? 'Project knowledge changed; context was cleared.')
      }
      if (event.type === 'done' || event.type === 'error') setAgentRunning(false)
      if (event.type === 'done') log('Agent: task finished.')
      if (event.type === 'error') log(`Agent error: ${event.error}`)
    })
  }, [log, refreshKnowledgeLint])

  // Disk watcher: refresh tree, reload clean buffers, keep knowledge fresh.
  // Dirty buffers are never clobbered — conflict goes to the Output log.
  const openFilesRef = useRef<OpenFile[]>([])
  openFilesRef.current = openFiles
  const refreshTreeRef = useRef<() => Promise<void>>()
  useEffect(() => {
    return window.woo.onFsChanged((paths) => {
      void (async () => {
        await refreshTreeRef.current?.()
        if (paths.some((p) => p.startsWith('.woo/knowledge'))) {
          window.woo.knowledgeStatus().then(setKnowledgeStatus).catch(() => {})
          window.woo.knowledgeGraph().then(setGraph).catch(() => {})
          refreshKnowledgeLint()
        }
        if (paths.some((p) => /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(p))) {
          window.woo.sourceGraph().then(setSourceGraph).catch(() => {})
        }
        for (const p of paths) {
          const file = openFilesRef.current.find((f) => f.path === p)
          if (!file || file.content == null) continue
          if (file.dirty) {
            log(`Conflict: ${p} changed on disk while it has unsaved edits — keeping yours.`)
            continue
          }
          try {
            const content = await window.woo.filesRead(p)
            if (content === file.content) continue
            setOpenFiles((prev) =>
              prev.map((f) => (f.path === p ? { ...f, content, dirty: false } : f))
            )
            const diags = await window.woo.rulesCheck(p, content)
            setDiagnostics((prev) => [...prev.filter((d) => d.file !== p), ...diags])
            log(`Reloaded ${p} (changed on disk).`)
          } catch {
            // File vanished between batch and read — tree refresh covers it.
          }
        }
      })()
    })
  }, [log, refreshKnowledgeLint])

  // CLI `woo file.ts` — main forwards the file to open after load.
  const openFileRef = useRef<(path: string) => Promise<void>>()
  useEffect(() => {
    return window.woo.onOpenFile((path) => void openFileRef.current?.(path))
  }, [])

  // Palette file list: fetched when the palette opens, not on every fs
  // change batch — a full path walk per watcher batch scaled linearly with
  // repo size for a list nobody was looking at.
  useEffect(() => {
    if (!paletteOpen) return
    window.woo.filesAllPaths().then(setAllPaths).catch(() => setAllPaths([]))
  }, [paletteOpen])

  // Cmd/Ctrl+K opens the command palette. Capture phase, or Monaco eats
  // Ctrl+K as a chord prefix while the editor has focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        e.stopPropagation()
        setPaletteOpen((open) => !open)
      }
      if (e.key === 'Escape') setPaletteOpen(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const openFile = useCallback(
    async (path: string) => {
      let content: string
      try {
        content = await window.woo.filesRead(path)
      } catch (err) {
        log(`Open failed: ${path} — ${String((err as Error).message ?? err)}`)
        return
      }
      setGitDiff(null) // diff overlay must never swallow navigation
      setActivePath(path)
      setAgentTaskTabFocused(false)
      setView((v) => (v === 'graph' || v === 'context' ? 'explorer' : v))
      setOpenFiles((prev) => {
        if (prev.some((f) => f.path === path)) return prev.map((f) => (f.path === path ? { ...f, content } : f))
        return [...prev, { path, content }]
      })
      const diags = await window.woo.rulesCheck(path, content)
      setDiagnostics((prev) => [...prev.filter((d) => d.file !== path), ...diags])
      if (diags.length > 0) log(`Rules: ${diags.length} finding(s) in ${path}.`)
    },
    [log]
  )
  openFileRef.current = openFile

  const markDirty = useCallback((path: string, currentValue: string) => {
    setOpenFiles((prev) =>
      prev.map((f) =>
        f.path === path ? { ...f, dirty: f.content != null && currentValue !== f.content } : f
      )
    )
  }, [])

  const closeFile = useCallback(
    (path: string) => {
      const file = openFiles.find((f) => f.path === path)
      if (file?.dirty && !window.confirm(`${path} has unsaved changes. Close and discard them?`)) {
        return
      }
      setOpenFiles((prev) => {
        const next = prev.filter((f) => f.path !== path)
        setActivePath((current) =>
          current === path ? (next.length ? next[next.length - 1].path : null) : current
        )
        return next
      })
    },
    [openFiles]
  )

  // Warn on window close while unsaved changes exist. Main answers the
  // resulting will-prevent-unload with a native dialog.
  const hasDirty = openFiles.some((f) => f.dirty)

  useEffect(() => {
    if (!workspace?.root) return
    let cancelled = false
    setRecoveryHydrated(false)
    void window.woo.recoveryLoadBuffers().then(async (buffers) => {
      if (cancelled) return
      if (buffers.length > 0 && window.confirm(
        `Recover ${buffers.length} unsaved editor buffer${buffers.length === 1 ? '' : 's'} from the previous session?`
      )) {
        setOpenFiles(buffers.map((buffer) => ({ ...buffer, dirty: true })))
        setActivePath(buffers[0]?.path ?? null)
        log(`Recovered ${buffers.length} unsaved editor buffer(s).`)
      } else if (buffers.length > 0) {
        await window.woo.recoveryClearBuffers()
      }
      if (!cancelled) setRecoveryHydrated(true)
    }).catch(() => {
      if (!cancelled) setRecoveryHydrated(true)
    })
    return () => { cancelled = true }
  }, [log, workspace?.root])

  useEffect(() => {
    if (!recoveryHydrated) return
    const timer = setTimeout(() => {
      const buffers = openFiles
        .filter((file) => file.dirty && file.content != null)
        .map((file) => ({ path: file.path, content: file.content! }))
      void window.woo.recoverySaveBuffers(buffers).catch(() => {})
    }, 350)
    return () => clearTimeout(timer)
  }, [openFiles, recoveryHydrated])
  useEffect(() => {
    if (!hasDirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [hasDirty])

  const openWorkspace = useCallback(async () => {
    try {
      const switched = await window.woo.workspaceOpenFolder(hasDirty)
      if (!switched) return

      // The main process has atomically rebound its workspace services. Clear
      // all project-scoped renderer state before reading from the new session.
      setOpenFiles([])
      setActivePath(null)
      setAllPaths([])
      setDiagnostics([])
      setOutput([])
      setPaletteOpen(false)
      setAgentEvents([])
      setAgentRunning(false)
      setContextPack(null)
      setCtxPinned(false)
      setKnowledgeSyncReview(null)
      setGraphAffectedDocumentIds([])
      setGraphChangedFiles([])
      setGitDiff(null)
      setGraphFocus(null)
      setView('explorer')
      setSidebarCollapsed(false)
      setAgentTask('')
      setAgentActiveTask('')
      setAgentPlanning(false)
      setAgentPlanSteps(null)
      setAgentPlanText('')
      setAgentEditingPlan(false)
      setAgentAccountChoice(null)
      setAgentEstimate(null)

      const [nextWorkspace, nextTree, nextKnowledge, nextGraph, nextSourceGraph, nextDiagnostics] =
        await Promise.all([
          window.woo.workspaceInfo(),
          window.woo.filesList(),
          window.woo.knowledgeStatus().catch(() => null),
          window.woo.knowledgeGraph().catch(() => null),
          window.woo.sourceGraph().catch(() => null),
          window.woo.knowledgeValidate().catch(() => [])
        ])
      setWorkspace(nextWorkspace)
      setTree(nextTree)
      setTreeVersion((version) => version + 1)
      setKnowledgeStatus(nextKnowledge)
      setGraph(nextGraph)
      setSourceGraph(nextSourceGraph)
      setDiagnostics(nextDiagnostics)
      log(`Opened workspace ${nextWorkspace.root}.`)
    } catch (error) {
      log(`Open folder failed: ${String((error as Error).message ?? error)}`)
    }
  }, [hasDirty, log])

  const saveFile = useCallback(
    async (path: string, content: string) => {
      await window.woo.filesWrite(path, content)
      setOpenFiles((prev) =>
        prev.map((f) => (f.path === path ? { ...f, content, dirty: false } : f))
      )
      const diags = await window.woo.rulesCheck(path, content)
      setDiagnostics((prev) => [...prev.filter((d) => d.file !== path), ...diags])
      log(`Saved ${path} — ${diags.length} finding(s).`)
    },
    [log]
  )

  const runAgent = useCallback(
    (task: string, plan?: string, modelMode?: ModelMode) => {
      if (knowledgeSyncReview) {
        void window.woo.knowledgeSyncDismiss(knowledgeSyncReview.id)
        setKnowledgeSyncReview(null)
      }
      setGraphAffectedDocumentIds([])
      setGraphChangedFiles([])
      setAgentEvents([])
      setAgentRunning(true)
      void window.woo
        .agentChooseAccount(task)
        .then((choice) => {
          setAgentProvider(choice.executeProvider)
          const displayName = PROVIDER_DISPLAY_NAME[choice.executeProvider]
          log(
            `${displayName}: running "${task.slice(0, 80)}"${plan ? ' (with approved plan)' : ''} — auto (${choice.reason}).`
          )
          void window.woo.agentRun(choice.executeProvider, task, plan, modelMode)
        })
        .catch((err) => {
          const message = String((err as Error).message ?? err)
          setAgentRunning(false)
          setAgentEvents((prev) => [...prev, { type: 'error', error: message }])
          log(`Run failed: ${message}`)
        })
    },
    [knowledgeSyncReview, log]
  )

  // Debounced knowledge-token estimate for whatever's typed in the AGENT tab.
  useEffect(() => {
    const value = agentTask.trim()
    if (!value) {
      setAgentEstimate(null)
      return
    }
    let active = true
    const timer = window.setTimeout(() => {
      void window.woo
        .agentChooseAccount(value)
        .then((choice) => window.woo.agentEstimate(choice.executeProvider, value))
        .then((next) => {
          if (active && next.task === value) setAgentEstimate(next)
        })
        .catch(() => {
          if (active) setAgentEstimate(null)
        })
    }, 300)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [agentTask, ctxPinned])

  const startAgentTask = useCallback(() => {
    const t = agentTask.trim()
    if (!t || agentRunning || agentPlanning) return
    setAgentTask('')
    setAgentActiveTask(t)
    setAgentPlanning(true)
    setAgentPlanSteps(null)
    setAgentPlanPreviousText(null)
    setAgentPlanError(null)
    void (async () => {
      try {
        const choice = await window.woo.agentChooseAccount(t)
        setAgentAccountChoice(choice)
        const plan = await window.woo.agentPlan(choice.planProvider, t)
        if (plan.steps.length > 0) {
          setAgentPlanSteps(plan.steps)
          setAgentPlanText(plan.steps.map((s, i) => `${i + 1}. ${s}`).join('\n'))
          setAgentEditingPlan(false)
          setAgentTaskTabFocused(true)
        } else {
          // Model produced no parseable plan — run directly.
          runAgent(t, undefined, agentModelMode)
        }
      } catch {
        // Plan phase unavailable (e.g. no API key) — fall through to direct run.
        runAgent(t, undefined, agentModelMode)
      } finally {
        setAgentPlanning(false)
      }
    })()
  }, [agentTask, agentRunning, agentPlanning, agentModelMode, runAgent])

  const runAgentPlan = useCallback(() => {
    if (!agentActiveTask) return
    setAgentPlanSteps(null)
    setAgentEditingPlan(false)
    setAgentPlanPreviousText(null)
    setAgentPlanError(null)
    runAgent(agentActiveTask, agentPlanText, agentModelMode)
  }, [agentActiveTask, agentPlanText, agentModelMode, runAgent])

  const improveAgentPlan = useCallback(() => {
    if (!agentActiveTask || !agentPlanText.trim() || agentPlanImproving) return
    setAgentPlanImproving(true)
    setAgentPlanError(null)
    void (async () => {
      try {
        const choice = agentAccountChoice ?? await window.woo.agentChooseAccount(agentActiveTask)
        if (!agentAccountChoice) setAgentAccountChoice(choice)
        const revisionRequest = [
          agentActiveTask,
          '',
          'Revise the implementation plan below using relevant project knowledge. Preserve useful developer edits, remove unsupported assumptions, and return only a concise numbered implementation plan.',
          '',
          'Current plan:',
          agentPlanText.slice(0, 12_000)
        ].join('\n')
        const revised = await window.woo.agentPlan(choice.planProvider, revisionRequest)
        if (revised.steps.length === 0) throw new Error('The planner returned no usable steps.')
        setAgentPlanPreviousText(agentPlanText)
        setAgentPlanSteps(revised.steps)
        setAgentPlanText(revised.steps.map((step, index) => `${index + 1}. ${step}`).join('\n'))
        setAgentEditingPlan(true)
        log('Plan improved with retrieved project knowledge; review it before running.')
      } catch (error) {
        setAgentPlanError(String((error as Error).message ?? error))
      } finally {
        setAgentPlanImproving(false)
      }
    })()
  }, [agentActiveTask, agentPlanText, agentPlanImproving, agentAccountChoice, log])

  const undoAgentPlanImprovement = useCallback(() => {
    if (agentPlanPreviousText == null) return
    const previous = agentPlanPreviousText
    setAgentPlanText(previous)
    setAgentPlanSteps(
      previous.split('\n').map((line) => line.trim()).filter(Boolean)
        .map((line) => line.replace(/^\d+[.)]\s*/, ''))
    )
    setAgentPlanPreviousText(null)
    setAgentPlanError(null)
  }, [agentPlanPreviousText])

  const discardAgentPlan = useCallback(() => {
    setAgentPlanSteps(null)
    setAgentEditingPlan(false)
    setAgentPlanPreviousText(null)
    setAgentPlanError(null)
  }, [])

  const applyKnowledgeSync = useCallback(
    async (proposalIds: string[]) => {
      if (!knowledgeSyncReview) return
      const result = await window.woo.knowledgeSyncApply(knowledgeSyncReview.id, proposalIds)
      setKnowledgeSyncReview(null)
      setGraphAffectedDocumentIds([])
      setCtxPinned(false)
      setContextPack(null)
      const [status, freshGraph] = await Promise.all([
        window.woo.knowledgeStatus(),
        window.woo.knowledgeGraph()
      ])
      setKnowledgeStatus(status)
      setGraph(freshGraph)
      await refreshTreeRef.current?.()
      log(`Knowledge sync: updated ${result.updatedPaths.length} document(s).`)
    },
    [knowledgeSyncReview, log]
  )

  const dismissKnowledgeSync = useCallback(() => {
    if (!knowledgeSyncReview) return
    void window.woo.knowledgeSyncDismiss(knowledgeSyncReview.id)
    setKnowledgeSyncReview(null)
    log('Knowledge sync suggestions dismissed.')
  }, [knowledgeSyncReview, log])

  const stopAgent = useCallback(() => {
    void window.woo.agentStop(agentProvider)
    setAgentRunning(false)
    log(`${PROVIDER_DISPLAY_NAME[agentProvider]}: stopped.`)
  }, [agentProvider, log])

  const refreshTree = useCallback(async () => {
    setTree(await window.woo.filesList())
    setTreeVersion((v) => v + 1) // expanded dirs refetch their level
  }, [])
  refreshTreeRef.current = refreshTree

  const fileOps = useMemo<FileOps>(
    () => ({
      create: (path, type) => {
        void (async () => {
          try {
            if (type === 'directory') await window.woo.filesMkdir(path)
            else await window.woo.filesCreate(path)
            await refreshTree()
            if (type === 'file') await openFile(path)
            log(`Created ${type} ${path}.`)
          } catch (err) {
            log(`Create failed: ${String((err as Error).message ?? err)}`)
          }
        })()
      },
      rename: (from, to) => {
        void (async () => {
          try {
            await window.woo.filesRename(from, to)
            await refreshTree()
            // Patch open tabs: exact file match or files under a renamed dir.
            const remap = (p: string) =>
              p === from ? to : p.startsWith(from + '/') ? to + p.slice(from.length) : p
            setOpenFiles((prev) => prev.map((f) => ({ ...f, path: remap(f.path) })))
            setActivePath((p) => (p ? remap(p) : p))
            setDiagnostics((prev) => prev.map((d) => ({ ...d, file: remap(d.file) })))
            log(`Renamed ${from} to ${to}.`)
          } catch (err) {
            log(`Rename failed: ${String((err as Error).message ?? err)}`)
          }
        })()
      },
      remove: (path) => {
        void (async () => {
          try {
            await window.woo.filesDelete(path)
            await refreshTree()
            const gone = (p: string) => p === path || p.startsWith(path + '/')
            setOpenFiles((prev) => {
              const next = prev.filter((f) => !gone(f.path))
              setActivePath((current) =>
                current && gone(current) ? (next.length ? next[next.length - 1].path : null) : current
              )
              return next
            })
            setDiagnostics((prev) => prev.filter((d) => !gone(d.file)))
            log(`Moved ${path} to trash.`)
          } catch (err) {
            log(`Delete failed: ${String((err as Error).message ?? err)}`)
          }
        })()
      }
    }),
    [refreshTree, openFile, log]
  )

  const showDiff = useCallback(
    async (path: string) => {
      try {
        setGitDiff(await window.woo.gitDiff(path))
      } catch (err) {
        log(`Diff failed: ${String((err as Error).message ?? err)}`)
      }
    },
    [log]
  )

  const restoreLatestBackup = useCallback(async () => {
    try {
      const [latest] = await window.woo.recoveryBackups()
      if (!latest) {
        log('Recovery: no agent backups are available.')
        return
      }
      if (!window.confirm(
        `Restore ${latest.files.length} files from ${new Date(latest.createdAt).toLocaleString()}? A backup of the current workspace will be created first.`
      )) return
      const restored = await window.woo.recoveryRestore(latest.id)
      await refreshTree()
      log(`Recovery: restored ${restored.length} files from ${latest.id}.`)
    } catch (error) {
      log(`Recovery failed: ${String((error as Error).message ?? error)}`)
    }
  }, [log, refreshTree])

  const openGraphNode = useCallback((id: string) => {
    setGraphFocus(id)
    setView('graph')
  }, [])

  const initKnowledge = useCallback(async () => {
    const status = await window.woo.knowledgeInit()
    setKnowledgeStatus(status)
    const [info, freshGraph] = await Promise.all([
      window.woo.workspaceInfo(),
      window.woo.knowledgeGraph()
    ])
    setWorkspace(info)
    setGraph(freshGraph)
    await refreshTree()
    refreshSetup()
    log('Knowledge base initialized.')
  }, [log, refreshSetup, refreshTree])

  // ── Rule hover-card / code actions ────────────────────────────────────
  const ruleActions = useMemo<RuleActionHandlers>(
    () => ({
      quickFix: (d) => {
        const file = openFiles.find((f) => f.path === d.file)
        if (!file?.content) return
        const lines = file.content.split('\n')
        const line = lines[d.line - 1] ?? ''
        const ident = /([A-Za-z_][A-Za-z0-9_]*)\s*[:=]/.exec(line)?.[1]
        const envName = (ident ?? 'SECRET')
          .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
          .toUpperCase()
        const fixed = line.replace(
          /(['"])[A-Za-z0-9+/_-]{16,}\1/,
          `process.env.${envName} ?? ''`
        )
        if (fixed === line) {
          log(`Quick Fix: no mechanical fix found for ${d.ruleId} at ${d.file}:${d.line}.`)
          return
        }
        lines[d.line - 1] = fixed
        void saveFile(d.file, lines.join('\n'))
        log(`Quick Fix: replaced literal with process.env.${envName} in ${d.file}.`)
      },
      fixWithAgent: (d) => {
        setShowAgent(true)
        runAgent(`Fix ${d.ruleId} at ${d.file}:${d.line} — ${d.message}`)
      },
      proposeRuleChange: (d) => {
        if (d.definedIn && d.definedIn !== 'built-in') void openFile(d.definedIn)
      },
      suppress: (d) => {
        const file = openFiles.find((f) => f.path === d.file)
        if (!file?.content) return
        const lines = file.content.split('\n')
        const indent = /^\s*/.exec(lines[d.line - 1] ?? '')?.[0] ?? ''
        lines.splice(d.line - 1, 0, `${indent}${commentTokenFor(d.file)} woo-ignore ${d.ruleId}`)
        void saveFile(d.file, lines.join('\n'))
        log(`Suppressed ${d.ruleId} at ${d.file}:${d.line}.`)
      }
    }),
    [openFiles, saveFile, runAgent, openFile, log]
  )

  // ── Command palette ───────────────────────────────────────────────────
  const paletteItems = useMemo<PaletteItem[]>(() => {
    const items: PaletteItem[] = [
      { id: 'view-explorer', label: 'View: Explorer', hint: 'view', run: () => setView('explorer') },
      { id: 'view-search', label: 'View: Search', hint: 'view', run: () => setView('search') },
      { id: 'view-git', label: 'View: Git', hint: 'view', run: () => setView('git') },
      { id: 'recovery-restore', label: 'Recovery: Restore latest agent backup', hint: 'safety', run: () => void restoreLatestBackup() },
      { id: 'view-graph', label: 'View: Knowledge Graph', hint: 'view', run: () => setView('graph') },
      { id: 'view-context', label: 'View: Context Pack', hint: 'view', run: () => setView('context') },
      { id: 'view-skills', label: 'View: Skills', hint: 'view', run: () => setView('skills') },
      { id: 'view-vault', label: 'View: Vault', hint: 'view', run: () => setView('vault') },
      {
        id: 'open-folder',
        label: 'Open Folder…',
        hint: 'workspace',
        run: () => void openWorkspace()
      },
      {
        id: 'toggle-agent',
        label: 'Toggle Agent Panel',
        hint: 'panel',
        run: () => setShowAgent((s) => !s)
      },
      {
        id: 'init-knowledge',
        label: 'Knowledge: Initialize Base',
        hint: 'knowledge',
        run: () => void initKnowledge()
      }
    ]
    for (const path of allPaths) {
      items.push({
        id: `file-${path}`,
        label: path,
        hint: 'file',
        run: () => void openFile(path)
      })
    }
    return items
  }, [allPaths, initKnowledge, openFile, openWorkspace, restoreLatestBackup])

  const errors = diagnostics.filter((d) => d.severity === 'error').length
  const warnings = diagnostics.filter((d) => d.severity === 'warning').length
  const infos = diagnostics.filter((d) => d.severity === 'info').length

  return (
    <div className="app">
      <div className="titlebar" onDoubleClick={() => void window.woo.windowMaximizeToggle()}>
        <span className="titlebar-logo">◈</span>
        <span className="titlebar-name">Woo Studio</span>
        <span
          className="titlebar-workspace clickable"
          title="Open a different folder"
          onClick={() => void openWorkspace()}
        >
          {workspace?.name ?? ''} ▾
        </span>
        <span className="titlebar-hint" onClick={() => setPaletteOpen(true)}>
          ⌘K
        </span>
        <div className="window-controls" onDoubleClick={(e) => e.stopPropagation()}>
          <button
            className="window-btn"
            title="Minimize"
            aria-label="Minimize window"
            onClick={() => void window.woo.windowMinimize()}
          >
            &#x2013;
          </button>
          <button
            className="window-btn"
            title={maximized ? 'Restore' : 'Maximize'}
            aria-label={maximized ? 'Restore window' : 'Maximize window'}
            onClick={() => void window.woo.windowMaximizeToggle()}
          >
            {maximized ? '❐' : '□'}
          </button>
          <button
            className="window-btn close"
            title="Close"
            aria-label="Close window"
            onClick={() => void window.woo.windowClose()}
          >
            ×
          </button>
        </div>
      </div>
      <div className="body">
        <ActivityBar
          view={view}
          onSelect={(v) => {
            userSelectedView.current = true
            setGitDiff(null)
            if (v === view) {
              setSidebarCollapsed((collapsed) => !collapsed)
            } else {
              setView(v)
              setSidebarCollapsed(false)
            }
          }}
          onToggleAgent={() => setShowAgent((s) => !s)}
        />
        <div
          className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}
          style={sidebarCollapsed ? undefined : { width: sidebarWidth }}
        >
          {view === 'explorer' && (
            <FileExplorer
              tree={tree}
              version={treeVersion}
              onOpen={openFile}
              onOpenFolder={() => void openWorkspace()}
              activePath={activePath}
              ops={fileOps}
            />
          )}
          {view === 'search' && <SearchPanel onOpen={openFile} onLog={log} />}
          {view === 'git' && <GitPanel onOpen={openFile} onDiff={showDiff} />}
          {view === 'skills' && <SkillsPanel onOpen={openFile} onLog={log} />}
          {view === 'vault' && <VaultPanel onLog={log} />}
          {view === 'privacy' && (
            <div className="panel-section">
              <div className="panel-header">Data and privacy</div>
              <div className="panel-empty">Retention, provider boundaries, and deletion controls.</div>
            </div>
          )}
          {view === 'setup' && (
            <div className="panel-section">
              <div className="panel-header">Setup</div>
              <div className="panel-empty">
                Runtime, workspace, knowledge, and provider readiness.
              </div>
            </div>
          )}
          {(view === 'graph' || view === 'agent' || view === 'context') && (
            <KnowledgePanel status={knowledgeStatus} onOpenNode={openGraphNode} onInit={initKnowledge} />
          )}
        </div>
        {!sidebarCollapsed && <Resizer direction="horizontal" onResize={resizeSidebar} />}
        <div className="center">
          {gitDiff ? (
            <div className="diff-view">
              <div className="diff-header">
                <span className="diff-title">Diff: {gitDiff.path}</span>
                <span className="diff-hint">HEAD ⟷ working copy</span>
                <button className="btn" onClick={() => setGitDiff(null)}>
                  ✕ Close
                </button>
              </div>
              <div className="editor-host">
                <Suspense fallback={<EditorLoading />}>
                  <DiffEditor
                    original={gitDiff.original}
                    modified={gitDiff.modified}
                    theme="woo-dark"
                    options={{ readOnly: true, renderSideBySide: true, automaticLayout: true, fontSize: 13 }}
                  />
                </Suspense>
              </div>
            </div>
          ) : view === 'graph' ? (
            <GraphView
              graph={graph}
              sourceGraph={sourceGraph}
              focus={graphFocus}
              impact={{
                contextDocumentIds: contextPack?.documents.map((document) => document.id) ?? [],
                affectedDocumentIds: graphAffectedDocumentIds,
                changedFiles: graphChangedFiles
              }}
              onOpen={openFile}
            />
          ) : view === 'context' ? (
            <ContextPackView
              pack={contextPack}
              pinned={ctxPinned}
              onTogglePin={togglePin}
              onRefresh={refreshPack}
              onUse={runAgent}
              onOpen={openFile}
            />
          ) : view === 'setup' ? (
            <SetupPanel
              status={setupStatus}
              onRefresh={refreshSetup}
              onInitializeKnowledge={() => void initKnowledge()}
            />
          ) : view === 'privacy' ? (
            <PrivacyPanel onLog={log} />
          ) : (
            <Suspense fallback={<EditorLoading />}>
              <EditorArea
                files={openFiles}
                activePath={activePath}
                onSelect={(path) => {
                  setActivePath(path)
                  setAgentTaskTabFocused(false)
                }}
                onClose={closeFile}
                onSave={saveFile}
                onDirty={markDirty}
                diagnostics={diagnostics}
                ruleActions={ruleActions}
                virtualTab={
                  agentPlanSteps != null && !agentRunning
                    ? {
                        label: '◈ Agent Task · Plan',
                        focused: agentTaskTabFocused,
                        onFocus: () => setAgentTaskTabFocused(true),
                        onClose: discardAgentPlan,
                        content: (
                          <AgentTaskView
                            planText={agentPlanText}
                            onPlanTextChange={setAgentPlanText}
                            editingPlan={agentEditingPlan}
                            onToggleEditingPlan={() => setAgentEditingPlan((e) => !e)}
                            accountChoice={agentAccountChoice}
                            improvingPlan={agentPlanImproving}
                            improveError={agentPlanError}
                            canUndoImprovement={agentPlanPreviousText != null}
                            onImprovePlan={improveAgentPlan}
                            onUndoImprovement={undoAgentPlanImprovement}
                            onRunPlan={runAgentPlan}
                            onDiscard={discardAgentPlan}
                          />
                        )
                      }
                    : null
                }
              />
            </Suspense>
          )}
          <Resizer direction="vertical" onResize={resizeProblemsPanel} />
          <ProblemsPanel
            height={problemsPanelHeight}
            diagnostics={diagnostics}
            output={output}
            onJump={openFile}
            agentEvents={agentEvents}
            agentRunning={agentRunning}
            agentPlanning={agentPlanning}
            agentTask={agentTask}
            onAgentTaskChange={setAgentTask}
            agentModelMode={agentModelMode}
            onAgentModelModeChange={setAgentModelMode}
            agentEstimate={agentEstimate}
            onAgentSubmit={startAgentTask}
            onAgentStop={stopAgent}
          />
        </div>
        {showAgent && (
          <>
            <Resizer direction="horizontal" onResize={resizeAgentPanel} />
            <AgentPanel
              key={workspace?.root ?? 'workspace-loading'}
              width={agentPanelWidth}
              running={agentRunning}
              planning={agentPlanning}
              provider={agentProvider}
              pack={contextPack}
              syncReview={knowledgeSyncReview}
              pinned={ctxPinned}
              onTogglePin={togglePin}
              onApplyKnowledgeSync={applyKnowledgeSync}
              onDismissKnowledgeSync={dismissKnowledgeSync}
              onViewContext={() => setView('context')}
            />
          </>
        )}
      </div>
      <StatusBar errors={errors} warnings={warnings} infos={infos} knowledgeReady={!!workspace?.knowledgeReady} />
      {paletteOpen && <CommandPalette items={paletteItems} onClose={() => setPaletteOpen(false)} />}
    </div>
  )
}
