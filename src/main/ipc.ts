import { app, ipcMain, shell, dialog, BrowserWindow } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { join } from 'path'
import { constants, promises as fs } from 'fs'
import { FileService } from './fileService'
import { KnowledgeEngine } from './knowledge/engine'
import { SecretBroker } from './secretBroker'
import { AgentRunner } from './agentRunner'
import { CodexAgentRunner } from './codexAgentRunner'
import { OpencodeAgentRunner } from './opencodeAgentRunner'
import { RuleChecker } from './ruleChecker'
import { GitService } from './gitService'
import { TerminalService } from './terminalService'
import { WatcherService } from './watcherService'
import { AuthService, FileConnectionStore } from './authService'
import { SkillsService } from './skillsService'
import { VaultService } from './vaultService'
import { KnowledgeSyncService } from './knowledge/syncService'
import { KnowledgeCompletionService } from './knowledge/completionService'
import { InlineCompletionService } from './inlineCompletionService'
import { ManualKnowledgeSync } from './knowledge/manualSyncService'
import { SourceGraphService } from './sourceGraphService'
import { chooseAccount } from './modelRouter'
import { EditorRecoveryService, WorkspaceBackupService } from './backupService'
import { workspaceDataRoot } from './localData'
import type { CrashService } from './crashService'
import { agentShellEnabled } from './agentSecurity'
import type { AuthProvider, KnowledgeCompletionRequest, RecoveryBuffer } from '../shared/types'

/**
 * 'opencode' (Zen) and 'opencode-go' are two credential sets under ONE
 * `opencode serve` process — both keys point at the SAME runner instance;
 * ipc.ts's applyOpencodeVariant() tells it which one the next call routes
 * to. Two AuthProvider values, one subprocess.
 */
function makeAgents(root: string, broker: SecretBroker, knowledge: KnowledgeEngine) {
  const opencode = new OpencodeAgentRunner(root, broker, knowledge)
  return {
    claude: new AgentRunner(root, broker, knowledge),
    codex: new CodexAgentRunner(root, broker, knowledge),
    opencode,
    'opencode-go': opencode
  }
}

/**
 * IPC Bridge, main side (UI-001). Every channel validates its payload here;
 * there is no generic eval/exec channel.
 */
export function registerIpc(
  workspaceRoot: string,
  win: BrowserWindow,
  crashes?: CrashService,
  onWorkspaceChanged: (root: string) => void = () => {}
): void {
  type IpcHandler = (event: IpcMainInvokeEvent, ...args: any[]) => any
  const handle = (channel: string, listener: IpcHandler): void => {
    ipcMain.handle(channel, (event, ...args) => {
      if (
        event.sender !== win.webContents ||
        event.senderFrame !== win.webContents.mainFrame
      ) {
        throw new Error('Rejected IPC from an untrusted renderer.')
      }
      return listener(event, ...args)
    })
  }

  let currentWorkspaceRoot = workspaceRoot
  let currentDataRoot = workspaceDataRoot(app.getPath('userData'), workspaceRoot)
  let workspaceGeneration = 0
  let files = new FileService(workspaceRoot)
  let knowledge = new KnowledgeEngine(workspaceRoot, currentDataRoot)
  let broker = new SecretBroker(workspaceRoot)
  let agents = makeAgents(workspaceRoot, broker, knowledge)
  let inlineCompletion = new InlineCompletionService(workspaceRoot, broker, knowledge)
  let knowledgeSync = new KnowledgeSyncService(workspaceRoot, knowledge, currentDataRoot)
  // Manual-edit AI sync: reviews arrive through the same agent-event channel
  // and the same apply/dismiss handlers as agent-task sync reviews.
  const notifyManualSync = (review: import('../shared/types').KnowledgeSyncReview): void => {
    if (!win.isDestroyed()) {
      win.webContents.send('agent:event', { type: 'knowledge-sync', sync: review })
    }
  }
  let manualSync = new ManualKnowledgeSync(
    workspaceRoot, broker, knowledge, knowledgeSync, notifyManualSync,
    undefined, undefined, currentDataRoot
  )
  // Resume what the previous session left behind (queued saves / an
  // un-actioned review) once the renderer can actually show it.
  win.webContents.once('did-finish-load', () => {
    setTimeout(() => { void manualSync.restore() }, 2_000)
  })
  let sourceGraph = new SourceGraphService(workspaceRoot)
  let rules = new RuleChecker(knowledge)
  let git = new GitService(workspaceRoot)
  let terminal = new TerminalService(workspaceRoot)
  let skills = new SkillsService(workspaceRoot)
  let vault = new VaultService(workspaceRoot, () => {
    terminal.setExtraEnv({})
    terminal.kill()
  })
  let backups = new WorkspaceBackupService(workspaceRoot, currentDataRoot)
  let recovery = new EditorRecoveryService(workspaceRoot, currentDataRoot)

  const makeWatcher = (root: string, secretBroker: SecretBroker) =>
    new WatcherService(root, secretBroker, (paths) => {
      if (!win.isDestroyed()) win.webContents.send('fs:changed', paths)
      if (paths.some((path) => path.startsWith('.woo/knowledge'))) {
        agents.claude.invalidateContext()
        agents.codex.invalidateContext()
        agents.opencode.invalidateContext()
        if (!win.isDestroyed()) {
          win.webContents.send('agent:event', {
            type: 'context-invalidated',
            text: 'Project knowledge changed; pinned context was cleared.'
          })
        }
      }
    })
  const attachTerminal = (service: TerminalService) => {
    service.attach(
      (data) => {
        if (!win.isDestroyed()) win.webContents.send('terminal:data', data)
      },
      () => {
        if (!win.isDestroyed()) win.webContents.send('terminal:exit')
      }
    )
  }
  let watcher = makeWatcher(workspaceRoot, broker)
  watcher.start()
  attachTerminal(terminal)
  const auth = new AuthService(
    undefined,
    new FileConnectionStore(join(app.getPath('userData'), 'auth-connections.json'))
  )
  // auth.statuses() spawns a CLI subprocess per provider — chooseAccount is
  // called on every debounced keystroke pause (context estimate) plus once
  // per plan/run, so the connected-provider list is cached briefly rather
  // than re-spawning claude/codex/opencode CLIs on every call.
  const CONNECTED_TTL_MS = 5000
  let connectedCache: { at: number; value: AuthProvider[] } | null = null
  const connectedProviders = async (): Promise<AuthProvider[]> => {
    if (connectedCache && Date.now() - connectedCache.at < CONNECTED_TTL_MS) return connectedCache.value
    const value = (await auth.statuses()).filter((status) => status.authenticated).map((status) => status.provider)
    connectedCache = { at: Date.now(), value }
    return value
  }
  win.on('closed', () => {
    agents.claude.stop()
    agents.codex.stop()
    agents.opencode.stop()
    terminal.kill()
    void watcher.stop()
  })

  const replaceWorkspace = async (nextRoot: string): Promise<void> => {
    if (nextRoot === currentWorkspaceRoot) return

    // Construct the replacement before tearing down the current session so a
    // constructor failure cannot strand the existing workspace.
    const nextDataRoot = workspaceDataRoot(app.getPath('userData'), nextRoot)
    const nextFiles = new FileService(nextRoot)
    const nextKnowledge = new KnowledgeEngine(nextRoot, nextDataRoot)
    const nextBroker = new SecretBroker(nextRoot)
    const nextAgents = makeAgents(nextRoot, nextBroker, nextKnowledge)
    const nextKnowledgeSync = new KnowledgeSyncService(nextRoot, nextKnowledge, nextDataRoot)
    const nextSourceGraph = new SourceGraphService(nextRoot)
    const nextRules = new RuleChecker(nextKnowledge)
    const nextGit = new GitService(nextRoot)
    const nextTerminal = new TerminalService(nextRoot)
    const nextSkills = new SkillsService(nextRoot)
    const nextVault = new VaultService(nextRoot, () => {
      nextTerminal.setExtraEnv({})
      nextTerminal.kill()
    })
    const nextBackups = new WorkspaceBackupService(nextRoot, nextDataRoot)
    const nextRecovery = new EditorRecoveryService(nextRoot, nextDataRoot)
    const nextWatcher = makeWatcher(nextRoot, nextBroker)

    agents.claude.stop()
    agents.codex.stop()
    agents.opencode.stop()
    inlineCompletion.stop()
    terminal.kill()
    await watcher.stop()

    currentWorkspaceRoot = nextRoot
    currentDataRoot = nextDataRoot
    onWorkspaceChanged(nextRoot)
    workspaceGeneration++
    files = nextFiles
    knowledge = nextKnowledge
    broker = nextBroker
    agents = nextAgents
    inlineCompletion = new InlineCompletionService(nextRoot, nextBroker, nextKnowledge)
    knowledgeSync = nextKnowledgeSync
    manualSync.stop()
    manualSync = new ManualKnowledgeSync(
      nextRoot, nextBroker, nextKnowledge, nextKnowledgeSync, notifyManualSync,
      undefined, undefined, nextDataRoot
    )
    void manualSync.restore()
    sourceGraph = nextSourceGraph
    rules = nextRules
    git = nextGit
    terminal = nextTerminal
    skills = nextSkills
    vault = nextVault
    backups = nextBackups
    recovery = nextRecovery
    watcher = nextWatcher
    attachTerminal(terminal)
    watcher.start()
  }

  const assertString = (v: unknown, name: string): string => {
    if (typeof v !== 'string') throw new Error(`${name} must be a string`)
    return v
  }
  const assertProvider = (v: unknown): AuthProvider => {
    if (v !== 'claude' && v !== 'codex' && v !== 'opencode' && v !== 'opencode-go') {
      throw new Error('provider must be claude, codex, opencode or opencode-go')
    }
    return v
  }
  const PROVIDER_DISPLAY_NAME: Record<AuthProvider, string> = {
    claude: 'Claude',
    codex: 'Codex',
    opencode: 'OpenCode',
    'opencode-go': 'OpenCode Go'
  }
  // 'opencode' and 'opencode-go' are two credential sets under ONE `opencode
  // serve` process (see opencodeAgentRunner.ts) — both keys below point at
  // the same runner instance; this tells it which credential/model set the
  // next call should route to.
  const applyOpencodeVariant = (selected: AuthProvider): void => {
    if (selected === 'opencode') agents.opencode.setVariant('zen')
    else if (selected === 'opencode-go') agents.opencode.setVariant('go')
  }
  const assertSkillProvider = (v: unknown): 'claude' | 'codex' => {
    if (v !== 'claude' && v !== 'codex') throw new Error('skill provider must be claude or codex')
    return v
  }

  handle('auth:status', () => auth.statuses())
  handle('auth:login', (_e, provider) => auth.login(assertProvider(provider)))
  handle('auth:disconnect', (_e, provider) => auth.disconnect(assertProvider(provider)))
  handle('setup:status', async () => {
    const [knowledgeReady, providerStatuses, workspaceWritable] = await Promise.all([
      knowledge.available(),
      auth.statuses(),
      fs.access(currentWorkspaceRoot, constants.W_OK).then(() => true, () => false)
    ])
    const enabledProviders = providerStatuses.filter((status) => status.available !== false)
    const authenticated = enabledProviders.filter((status) => status.authenticated)
    const installed = enabledProviders.filter((status) => status.installed)
    const checks = [
      {
        id: 'runtime' as const,
        label: 'Electron runtime',
        status: 'pass' as const,
        detail: `Electron ${process.versions.electron ?? 'development'} · Node ${process.versions.node}`
      },
      {
        id: 'native' as const,
        label: 'Integrated terminal',
        status: 'pass' as const,
        detail: 'Electron-compatible node-pty loaded successfully.'
      },
      {
        id: 'workspace' as const,
        label: 'Workspace access',
        status: workspaceWritable ? 'pass' as const : 'warning' as const,
        detail: workspaceWritable
          ? 'Workspace is writable.'
          : 'Workspace is read-only; editing and knowledge initialization will fail.'
      },
      {
        id: 'knowledge' as const,
        label: 'Project knowledge',
        status: knowledgeReady ? 'pass' as const : 'action' as const,
        detail: knowledgeReady
          ? 'Project knowledge is initialized.'
          : 'Initialize .woo/knowledge before running grounded tasks.'
      },
      {
        id: 'provider' as const,
        label: 'Agent account',
        status: authenticated.length > 0 ? 'pass' as const : 'action' as const,
        detail: authenticated.length > 0
          ? `${authenticated.map((status) => status.displayName).join(', ')} connected.`
          : installed.length > 0
            ? 'A provider CLI is installed; complete sign-in under Accounts.'
            : 'Install Claude Code or Codex CLI, then sign in.'
      }
    ]
    return {
      ready: checks.every((check) => check.status === 'pass'),
      checks
    }
  })

  // Frameless window controls. Close goes through win.close() so the
  // unsaved-changes guard (will-prevent-unload) still runs.
  handle('window:minimize', () => win.minimize())
  handle('window:maximizeToggle', () => {
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return win.isMaximized()
  })
  handle('window:close', () => win.close())
  handle('window:isMaximized', () => win.isMaximized())
  win.on('maximize', () => {
    if (!win.isDestroyed()) win.webContents.send('window:maximized', true)
  })
  win.on('unmaximize', () => {
    if (!win.isDestroyed()) win.webContents.send('window:maximized', false)
  })

  // Swap every workspace-bound service while keeping the BrowserWindow and
  // renderer alive. The renderer reports dirty buffers so the native discard
  // confirmation happens before the old Secret Broker/session is disposed.
  handle('workspace:openFolder', async (_event, hasUnsavedChanges) => {
    const picked = await dialog.showOpenDialog(win, {
      title: 'Open Workspace',
      properties: ['openDirectory']
    })
    if (picked.canceled || picked.filePaths.length === 0) return false
    const nextWorkspace = picked.filePaths[0]
    if (hasUnsavedChanges === true) {
      const choice = dialog.showMessageBoxSync(win, {
        type: 'question',
        buttons: ['Discard Changes', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        title: 'Unsaved changes',
        message: 'There are unsaved changes. Discard them and open another folder?'
      })
      if (choice !== 0) return false
    }
    await replaceWorkspace(nextWorkspace)
    return true
  })

  handle('workspace:info', async () => ({
    root: currentWorkspaceRoot,
    name: files.workspaceName(),
    knowledgeReady: await knowledge.available()
  }))

  handle('files:tree', () => files.readTree())
  handle('files:list', (_e, dir) =>
    files.list(dir == null ? '' : assertString(dir, 'dir'))
  )
  handle('files:read', (_e, p) => files.readFile(assertString(p, 'path')))
  handle('files:write', async (_e, p, content) => {
    const path = assertString(p, 'path')
    await files.writeFile(path, assertString(content, 'content'))
    // Manual save: queue for the debounced AI knowledge review. Agent edits
    // never pass through this channel (the SDK writes to disk directly).
    manualSync.noteSaved(path)
  })

  handle('files:create', (_e, p) => files.createFile(assertString(p, 'path')))
  handle('files:mkdir', (_e, p) => files.createDir(assertString(p, 'path')))
  handle('files:rename', (_e, from, to) =>
    files.rename(assertString(from, 'from'), assertString(to, 'to'))
  )
  // Delete goes to the OS trash — reversible, never rm.
  handle('files:delete', (_e, p) =>
    shell.trashItem(files.absolute(assertString(p, 'path')))
  )

  handle('knowledge:status', () => knowledge.status())
  handle('knowledge:retrieve', (_e, task) =>
    knowledge.retrieve(assertString(task, 'task'))
  )
  handle('knowledge:complete', async (_e, value) => {
    if (value == null || typeof value !== 'object') {
      throw new Error('completion request must be an object')
    }
    const request = value as Record<string, unknown>
    const path = assertString(request.path, 'completion path')
    files.absolute(path)
    if (!broker.checkPath(path).allowed) return []
    const language = assertString(request.language, 'completion language').slice(0, 40)
    const prefix = assertString(request.prefix, 'completion prefix').slice(0, 120)
    if (!Array.isArray(request.terms) || request.terms.length > 32) {
      throw new Error('completion terms must be an array of at most 32 strings')
    }
    const terms = request.terms.map((term, index) =>
      assertString(term, `completion term ${index}`).slice(0, 80)
    )
    return new KnowledgeCompletionService(knowledge).complete({
      path,
      language,
      prefix,
      terms
    } satisfies KnowledgeCompletionRequest)
  })
  handle('agent:inlineComplete', async (_e, value) => {
    if (value == null || typeof value !== 'object') {
      throw new Error('completion request must be an object')
    }
    const request = value as Record<string, unknown>
    const path = assertString(request.path, 'completion path')
    files.absolute(path)
    if (!broker.checkPath(path).allowed) return ''
    const language = assertString(request.language, 'completion language').slice(0, 40)
    const prefix = assertString(request.prefix, 'completion prefix').slice(-2_000)
    const suffix = assertString(request.suffix, 'completion suffix').slice(0, 500)
    if (!Array.isArray(request.terms) || request.terms.length > 32) {
      throw new Error('completion terms must be an array of at most 32 strings')
    }
    const terms = request.terms.map((term, index) =>
      assertString(term, `completion term ${index}`).slice(0, 80)
    )
    return inlineCompletion.complete({ path, language, prefix, suffix, terms })
  })
  handle('knowledge:graph', (_e, id) =>
    knowledge.graph(id == null ? undefined : assertString(id, 'id'))
  )
  handle('source:graph', () => sourceGraph.graph())
  handle('knowledge:get', (_e, id) => knowledge.getDocument(assertString(id, 'id')))
  handle('knowledge:validate', () => knowledge.validate())
  handle('knowledge:init', async () => {
    await knowledge.initialize()
    return knowledge.status()
  })
  handle('knowledge:syncApply', async (_e, reviewId, proposalIds) => {
    if (!Array.isArray(proposalIds) || proposalIds.some((id) => typeof id !== 'string')) {
      throw new Error('proposalIds must be an array of strings')
    }
    const result = await knowledgeSync.apply(
      assertString(reviewId, 'reviewId'),
      proposalIds
    )
    agents.claude.invalidateContext()
    agents.codex.invalidateContext()
    agents.opencode.invalidateContext()
    if (!win.isDestroyed()) {
      win.webContents.send('agent:event', {
        type: 'context-invalidated',
        text: 'Approved knowledge updates were applied; pinned context was cleared.'
      })
    }
    return result
  })
  handle('knowledge:syncDismiss', (_e, reviewId) =>
    knowledgeSync.dismiss(assertString(reviewId, 'reviewId'))
  )

  handle('rules:check', (_e, p, content) =>
    rules.check(assertString(p, 'path'), assertString(content, 'content'))
  )

  handle('broker:audit', () => broker.getAudit())
  handle('recovery:backups', () => backups.list())
  handle('recovery:restore', (_event, id) =>
    backups.restore(assertString(id, 'backup id'))
  )
  handle('recovery:loadBuffers', () => recovery.load())
  handle('recovery:saveBuffers', (_event, value) => {
    if (!Array.isArray(value)) throw new Error('buffers must be an array')
    const buffers: RecoveryBuffer[] = value.map((buffer, index) => {
      if (buffer == null || typeof buffer !== 'object') {
        throw new Error(`buffer ${index} must be an object`)
      }
      const record = buffer as Record<string, unknown>
      const path = assertString(record.path, `buffer ${index} path`)
      files.absolute(path)
      return { path, content: assertString(record.content, `buffer ${index} content`) }
    })
    return recovery.save(buffers)
  })
  handle('recovery:clearBuffers', () => recovery.clear())
  handle('privacy:status', async () => ({
    backupCount: (await backups.list()).length,
    recoverableBufferCount: (await recovery.load()).length,
    crashReportCount: crashes?.count() ?? 0,
    telemetryEnabled: false as const,
    agentShellEnabled: agentShellEnabled()
  }))
  handle('privacy:clearWorkspaceData', async () => {
    await Promise.all([backups.clear(), recovery.clear()])
  })
  handle('privacy:clearCrashReports', () => crashes?.clear())

  // ── Vault (Claypso pattern) ────────────────────────────────────────────
  // Values registered into the broker scrub set the moment they exist;
  // terminal injection is explicit and applies on next shell spawn.
  const registerVaultSecrets = () => {
    try {
      broker.addSecretValues(Object.values(vault.values()))
    } catch {
      /* locked */
    }
  }
  handle('vault:status', () => vault.status())
  handle('vault:create', async (_e, passphrase) => {
    const status = await vault.create(assertString(passphrase, 'passphrase'))
    registerVaultSecrets()
    return status
  })
  handle('vault:unlock', async (_e, passphrase) => {
    const status = await vault.unlock(assertString(passphrase, 'passphrase'))
    registerVaultSecrets()
    return status
  })
  handle('vault:lock', () => {
    terminal.setExtraEnv({})
    return vault.lock()
  })
  handle('vault:list', () => vault.list())
  handle('vault:get', (_e, key) => vault.get(assertString(key, 'key')))
  handle('vault:set', async (_e, key, value) => {
    await vault.set(assertString(key, 'key'), assertString(value, 'value'))
    registerVaultSecrets()
  })
  handle('vault:delete', (_e, key) => vault.remove(assertString(key, 'key')))
  handle('vault:destroy', async (_e, passphrase) => {
    terminal.setExtraEnv({})
    terminal.kill()
    await vault.destroy(assertString(passphrase, 'passphrase'))
  })
  handle('vault:importEnv', async (_e, relPath) => {
    // Reads via FileService (human channel); source file left untouched.
    const content = await files.readFile(assertString(relPath, 'path'))
    const count = await vault.importEnv(content)
    registerVaultSecrets()
    return count
  })
  handle('vault:applyToTerminal', () => {
    terminal.setExtraEnv(vault.values())
    terminal.kill() // next Terminal tab open spawns with vault env
  })

  const searchOpts = (o: unknown) => {
    const opts = (o ?? {}) as Record<string, unknown>
    return { regex: opts.regex === true, caseSensitive: opts.caseSensitive === true }
  }
  handle('search:query', (_e, q, o) =>
    files.search(assertString(q, 'query'), searchOpts(o))
  )
  handle('search:replace', (_e, q, r, o) =>
    files.replaceAll(assertString(q, 'query'), assertString(r, 'replacement'), searchOpts(o))
  )
  handle('files:allPaths', () => files.allPaths())

  handle('git:status', () => git.status())
  handle('git:init', () => git.init())
  handle('git:stage', (_e, p) => git.stage(assertString(p, 'path')))
  handle('git:unstage', (_e, p) => git.unstage(assertString(p, 'path')))
  handle('git:commit', (_e, m) => git.commit(assertString(m, 'message')))
  handle('git:diff', (_e, p) => git.diff(assertString(p, 'path')))
  handle('git:log', () => git.log())
  handle('git:branches', () => git.branches())
  handle('git:checkout', (_e, b) => git.checkout(assertString(b, 'branch')))
  handle('git:createBranch', (_e, b) => git.createBranch(assertString(b, 'branch')))
  handle('git:push', () => git.push())
  handle('git:pull', () => git.pull())

  const assertNumber = (v: unknown, name: string): number => {
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${name} must be a number`)
    return v
  }
  handle('terminal:start', (_e, cols, rows) =>
    terminal.start(assertNumber(cols, 'cols'), assertNumber(rows, 'rows'))
  )
  handle('terminal:input', (_e, data) => terminal.input(assertString(data, 'data')))
  handle('terminal:resize', (_e, cols, rows) =>
    terminal.resize(assertNumber(cols, 'cols'), assertNumber(rows, 'rows'))
  )
  handle('terminal:kill', () => terminal.kill())

  const assertTarget = (v: unknown): 'claude' | 'codex' | 'both' => {
    if (v !== 'claude' && v !== 'codex' && v !== 'both') {
      throw new Error('target must be claude, codex or both')
    }
    return v
  }
  const assertScope = (v: unknown): 'account' | 'project' => {
    if (v !== 'account' && v !== 'project') throw new Error('scope must be account or project')
    return v
  }
  handle('skills:list', () => skills.list())
  handle('skills:create', (_e, provider, scope, name) =>
    skills.create(assertSkillProvider(provider), assertScope(scope), assertString(name, 'name'))
  )
  // Delete goes to the OS trash — reversible, never rm. resolveSkillFolder
  // validates the path sits inside a known skills dir (account or project)
  // and returns the skill FOLDER, never a bare parent dir.
  handle('skills:delete', (_e, p) =>
    shell.trashItem(skills.resolveSkillFolder(assertString(p, 'path')))
  )
  // Account skills live outside the workspace — open with the system editor
  // (the in-app editor is workspace-scoped by design, UI-001).
  handle('skills:openExternal', (_e, p) => {
    const folder = skills.resolveSkillFolder(assertString(p, 'path'))
    return shell.openPath(join(folder, 'SKILL.md'))
  })
  handle('skills:install', async (_e, target, scope) => {
    const t = assertTarget(target)
    const s = assertScope(scope)
    const picked = await dialog.showOpenDialog(win, {
      title: 'Choose a skill folder (must contain SKILL.md)',
      properties: ['openDirectory']
    })
    if (picked.canceled || picked.filePaths.length === 0) return { canceled: true, installed: [] }
    return { canceled: false, installed: await skills.install(picked.filePaths[0], t, s) }
  })

  handle('agent:chooseAccount', async (_e, task) => {
    const t = assertString(task, 'task')
    const connected = await connectedProviders()
    if (connected.length === 0) {
      throw new Error('No connected accounts. Connect Claude, Codex, or OpenCode under Accounts first.')
    }
    return chooseAccount(t, connected)
  })
  handle('agent:plan', (_e, provider, task) => {
    const selected = assertProvider(provider)
    if (auth.isDisconnected(selected)) {
      throw new Error(`${PROVIDER_DISPLAY_NAME[selected]} is disconnected from Woo.`)
    }
    applyOpencodeVariant(selected)
    return agents[selected].plan(assertString(task, 'task'))
  })
  handle('agent:estimate', (_e, provider, task) =>
    // estimateContext() never touches model/variant selection — no
    // applyOpencodeVariant() needed, and skipping it avoids racing a
    // concurrent plan()/runTask() call's variant read on the shared runner.
    agents[assertProvider(provider)].estimateContext(assertString(task, 'task'))
  )
  handle('agent:pin', async (_e, provider, pinned, task) => {
    // setPinned() only caches a ContextPack — same no-variant-needed logic
    // as agent:estimate above.
    const runner = agents[assertProvider(provider)]
    if (pinned !== true) return runner.setPinned(false)
    const pack = task == null
      ? undefined
      : await knowledge.retrieve(assertString(task, 'task'))
    return runner.setPinned(true, pack)
  })
  const assertModelMode = (v: unknown): 'auto' | 'light' | 'standard' | 'deep' => {
    if (v == null) return 'auto'
    if (v !== 'auto' && v !== 'light' && v !== 'standard' && v !== 'deep') {
      throw new Error('modelMode must be auto, light, standard or deep')
    }
    return v
  }
  handle('agent:run', async (_e, provider, task, plan, modelMode) => {
    const selected = assertProvider(provider)
    const t = assertString(task, 'task')
    const p = plan == null ? undefined : assertString(plan, 'plan')
    const mode = assertModelMode(modelMode)
    // Deterministic packaged-app smoke mode. This deliberately performs no
    // provider or filesystem tool call; it exercises retrieval and the real
    // renderer event channel without requiring a paid/external account.
    if (process.env.WOO_SMOKE_TEST === '1') {
      const pack = await knowledge.retrieve(t)
      if (!win.isDestroyed()) {
        win.webContents.send('agent:event', { type: 'context-pack', pack })
        win.webContents.send('agent:event', {
          type: 'text',
          text: 'Packaged smoke agent completed without external provider access.'
        })
        win.webContents.send('agent:event', { type: 'done' })
      }
      return
    }
    if (auth.isDisconnected(selected)) {
      if (!win.isDestroyed()) {
        win.webContents.send('agent:event', {
          type: 'error',
          error: `${PROVIDER_DISPLAY_NAME[selected]} is disconnected from Woo. Reconnect it under Accounts to run tasks.`
        })
      }
      return
    }
    // Locked in synchronously, before any await — runTask() reads
    // this.variant in its own synchronous prologue, so there's no window
    // for a concurrent call to stomp on it (see applyOpencodeVariant).
    applyOpencodeVariant(selected)
    // Fire-and-stream; after the provider finishes, compare the bounded
    // workspace snapshot and offer deterministic knowledge updates.
    const generation = workspaceGeneration
    const runner = agents[selected]
    const sync = knowledgeSync
    void (async () => {
      const backup = await backups.create(`Before agent task: ${t.slice(0, 160)}`)
      if (!win.isDestroyed()) {
        win.webContents.send('agent:event', {
          type: 'text',
          text: `Recovery backup created (${backup.files.length} files).`
        })
      }
      const before = await sync.snapshot()
      await runner.runTask(
        t,
        (event) => {
          if (workspaceGeneration === generation && !win.isDestroyed()) {
            win.webContents.send('agent:event', event)
          }
        },
        p,
        mode
      )
      if (workspaceGeneration !== generation) return
      const review = await sync.review(t, before)
      if (review && workspaceGeneration === generation && !win.isDestroyed()) {
        win.webContents.send('agent:event', { type: 'knowledge-sync', sync: review })
      }
    })().catch((error) => {
      if (workspaceGeneration === generation && !win.isDestroyed()) {
        win.webContents.send('agent:event', {
          type: 'error',
          error: `Knowledge sync failed: ${String(error?.message ?? error)}`
        })
      }
    })
  })
  handle('agent:stop', (_e, provider) => agents[assertProvider(provider)].stop())
}
