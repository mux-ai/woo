import { contextBridge, ipcRenderer } from 'electron'
import type {
  AgentSessionEvent,
  AuthProvider,
  KnowledgeCompletionRequest,
  SkillProvider
} from '../shared/types'

/**
 * IPC Bridge, renderer side. Typed surface only — no raw ipcRenderer leak.
 */
const api = {
  workspaceInfo: () => ipcRenderer.invoke('workspace:info'),
  workspaceOpenFolder: (hasUnsavedChanges = false) =>
    ipcRenderer.invoke('workspace:openFolder', hasUnsavedChanges),

  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowMaximizeToggle: () => ipcRenderer.invoke('window:maximizeToggle'),
  windowClose: () => ipcRenderer.invoke('window:close'),
  windowIsMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  onWindowMaximized: (cb: (maximized: boolean) => void) => {
    const listener = (_: unknown, maximized: boolean) => cb(maximized)
    ipcRenderer.on('window:maximized', listener)
    return () => ipcRenderer.removeListener('window:maximized', listener)
  },

  authStatus: () => ipcRenderer.invoke('auth:status'),
  authLogin: (provider: AuthProvider) => ipcRenderer.invoke('auth:login', provider),
  authDisconnect: (provider: AuthProvider) => ipcRenderer.invoke('auth:disconnect', provider),
  setupStatus: () => ipcRenderer.invoke('setup:status'),

  filesTree: () => ipcRenderer.invoke('files:tree'),
  filesList: (dir?: string) => ipcRenderer.invoke('files:list', dir),
  filesRead: (path: string) => ipcRenderer.invoke('files:read', path),
  filesWrite: (path: string, content: string) =>
    ipcRenderer.invoke('files:write', path, content),
  filesCreate: (path: string) => ipcRenderer.invoke('files:create', path),
  filesMkdir: (path: string) => ipcRenderer.invoke('files:mkdir', path),
  filesRename: (from: string, to: string) => ipcRenderer.invoke('files:rename', from, to),
  filesDelete: (path: string) => ipcRenderer.invoke('files:delete', path),

  knowledgeStatus: () => ipcRenderer.invoke('knowledge:status'),
  knowledgeRetrieve: (task: string) => ipcRenderer.invoke('knowledge:retrieve', task),
  knowledgeComplete: (request: KnowledgeCompletionRequest) =>
    ipcRenderer.invoke('knowledge:complete', request),
  knowledgeGraph: (id?: string) => ipcRenderer.invoke('knowledge:graph', id),
  sourceGraph: () => ipcRenderer.invoke('source:graph'),
  knowledgeGet: (id: string) => ipcRenderer.invoke('knowledge:get', id),
  knowledgeInit: () => ipcRenderer.invoke('knowledge:init'),
  knowledgeValidate: () => ipcRenderer.invoke('knowledge:validate'),
  knowledgeSyncApply: (reviewId: string, proposalIds: string[]) =>
    ipcRenderer.invoke('knowledge:syncApply', reviewId, proposalIds),
  knowledgeSyncDismiss: (reviewId: string) =>
    ipcRenderer.invoke('knowledge:syncDismiss', reviewId),

  rulesCheck: (path: string, content: string) =>
    ipcRenderer.invoke('rules:check', path, content),

  brokerAudit: () => ipcRenderer.invoke('broker:audit'),
  recoveryBackups: () => ipcRenderer.invoke('recovery:backups'),
  recoveryRestore: (id: string) => ipcRenderer.invoke('recovery:restore', id),
  recoveryLoadBuffers: () => ipcRenderer.invoke('recovery:loadBuffers'),
  recoverySaveBuffers: (buffers: { path: string; content: string }[]) =>
    ipcRenderer.invoke('recovery:saveBuffers', buffers),
  recoveryClearBuffers: () => ipcRenderer.invoke('recovery:clearBuffers'),
  privacyStatus: () => ipcRenderer.invoke('privacy:status'),
  privacyClearWorkspaceData: () => ipcRenderer.invoke('privacy:clearWorkspaceData'),
  privacyClearCrashReports: () => ipcRenderer.invoke('privacy:clearCrashReports'),

  vaultStatus: () => ipcRenderer.invoke('vault:status'),
  vaultCreate: (passphrase: string) => ipcRenderer.invoke('vault:create', passphrase),
  vaultUnlock: (passphrase: string) => ipcRenderer.invoke('vault:unlock', passphrase),
  vaultLock: () => ipcRenderer.invoke('vault:lock'),
  vaultList: () => ipcRenderer.invoke('vault:list'),
  vaultGet: (key: string) => ipcRenderer.invoke('vault:get', key),
  vaultSet: (key: string, value: string) => ipcRenderer.invoke('vault:set', key, value),
  vaultDelete: (key: string) => ipcRenderer.invoke('vault:delete', key),
  vaultDestroy: (passphrase: string) => ipcRenderer.invoke('vault:destroy', passphrase),
  vaultImportEnv: (path: string) => ipcRenderer.invoke('vault:importEnv', path),
  vaultApplyToTerminal: () => ipcRenderer.invoke('vault:applyToTerminal'),

  searchQuery: (query: string, opts?: { regex?: boolean; caseSensitive?: boolean }) =>
    ipcRenderer.invoke('search:query', query, opts),
  searchReplace: (
    query: string,
    replacement: string,
    opts?: { regex?: boolean; caseSensitive?: boolean }
  ) => ipcRenderer.invoke('search:replace', query, replacement, opts),
  filesAllPaths: () => ipcRenderer.invoke('files:allPaths'),

  gitStatus: () => ipcRenderer.invoke('git:status'),
  gitInit: () => ipcRenderer.invoke('git:init'),
  gitStage: (path: string) => ipcRenderer.invoke('git:stage', path),
  gitUnstage: (path: string) => ipcRenderer.invoke('git:unstage', path),
  gitCommit: (message: string) => ipcRenderer.invoke('git:commit', message),
  gitDiff: (path: string) => ipcRenderer.invoke('git:diff', path),
  gitLog: () => ipcRenderer.invoke('git:log'),
  gitBranches: () => ipcRenderer.invoke('git:branches'),
  gitCheckout: (branch: string) => ipcRenderer.invoke('git:checkout', branch),
  gitCreateBranch: (branch: string) => ipcRenderer.invoke('git:createBranch', branch),
  gitPush: () => ipcRenderer.invoke('git:push'),
  gitPull: () => ipcRenderer.invoke('git:pull'),

  terminalStart: (cols: number, rows: number) =>
    ipcRenderer.invoke('terminal:start', cols, rows),
  terminalInput: (data: string) => ipcRenderer.invoke('terminal:input', data),
  terminalResize: (cols: number, rows: number) =>
    ipcRenderer.invoke('terminal:resize', cols, rows),
  terminalKill: () => ipcRenderer.invoke('terminal:kill'),
  onOpenFile: (cb: (path: string) => void) => {
    const listener = (_: unknown, path: string) => cb(path)
    ipcRenderer.on('open-file', listener)
    return () => ipcRenderer.removeListener('open-file', listener)
  },
  onFsChanged: (cb: (paths: string[]) => void) => {
    const listener = (_: unknown, paths: string[]) => cb(paths)
    ipcRenderer.on('fs:changed', listener)
    return () => ipcRenderer.removeListener('fs:changed', listener)
  },

  onTerminalData: (cb: (data: string) => void) => {
    const listener = (_: unknown, data: string) => cb(data)
    ipcRenderer.on('terminal:data', listener)
    return () => ipcRenderer.removeListener('terminal:data', listener)
  },
  onTerminalExit: (cb: () => void) => {
    const listener = () => cb()
    ipcRenderer.on('terminal:exit', listener)
    return () => ipcRenderer.removeListener('terminal:exit', listener)
  },

  skillsList: () => ipcRenderer.invoke('skills:list'),
  skillsCreate: (provider: SkillProvider, scope: 'account' | 'project', name: string) =>
    ipcRenderer.invoke('skills:create', provider, scope, name),
  skillsDelete: (path: string) => ipcRenderer.invoke('skills:delete', path),
  skillsOpenExternal: (path: string) => ipcRenderer.invoke('skills:openExternal', path),
  skillsInstall: (target: SkillProvider | 'both', scope: 'account' | 'project') =>
    ipcRenderer.invoke('skills:install', target, scope),

  agentChooseAccount: (task: string) => ipcRenderer.invoke('agent:chooseAccount', task),
  agentPlan: (provider: AuthProvider, task: string) =>
    ipcRenderer.invoke('agent:plan', provider, task),
  agentEstimate: (provider: AuthProvider, task: string) =>
    ipcRenderer.invoke('agent:estimate', provider, task),
  agentPin: (provider: AuthProvider, pinned: boolean, task?: string) =>
    ipcRenderer.invoke('agent:pin', provider, pinned, task),
  agentRun: (
    provider: AuthProvider,
    task: string,
    plan?: string,
    modelMode?: 'auto' | 'light' | 'standard' | 'deep'
  ) => ipcRenderer.invoke('agent:run', provider, task, plan, modelMode),
  agentStop: (provider: AuthProvider) => ipcRenderer.invoke('agent:stop', provider),
  onAgentEvent: (cb: (e: AgentSessionEvent) => void) => {
    const listener = (_: unknown, event: AgentSessionEvent) => cb(event)
    ipcRenderer.on('agent:event', listener)
    return () => ipcRenderer.removeListener('agent:event', listener)
  }
}

contextBridge.exposeInMainWorld('woo', api)

export type WooApi = typeof api
