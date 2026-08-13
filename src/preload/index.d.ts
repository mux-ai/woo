import type {
  AccountChoice,
  AgentPlan,
  AgentSessionEvent,
  AuthProvider,
  AuthProviderStatus,
  BrokerAuditEntry,
  ContextPack,
  ContextTokenEstimate,
  Diagnostic,
  FileNode,
  GitDiff,
  GitLogEntry,
  GitStatus,
  InlineCompletionRequest,
  KnowledgeGraph,
  KnowledgeCompletion,
  KnowledgeCompletionRequest,
  KnowledgeSyncApplyResult,
  ModelMode,
  KnowledgeStatus,
  ReplaceResult,
  PrivacyStatus,
  RecoveryBuffer,
  SearchOptions,
  SearchResult,
  SkillInfo,
  SkillInstallTarget,
  SkillProvider,
  VaultEntry,
  VaultStatus,
  SkillScope,
  SourceGraph,
  SetupStatus,
  WorkspaceBackup,
  WorkspaceInfo
} from '../shared/types'

declare global {
  interface Window {
    woo: {
      workspaceInfo: () => Promise<WorkspaceInfo>
      workspaceOpenFolder: (hasUnsavedChanges?: boolean) => Promise<boolean>
      windowMinimize: () => Promise<void>
      windowMaximizeToggle: () => Promise<boolean>
      windowClose: () => Promise<void>
      windowIsMaximized: () => Promise<boolean>
      onWindowMaximized: (cb: (maximized: boolean) => void) => () => void
      authStatus: () => Promise<AuthProviderStatus[]>
      authLogin: (provider: AuthProvider) => Promise<AuthProviderStatus>
      authDisconnect: (provider: AuthProvider) => Promise<AuthProviderStatus>
      setupStatus: () => Promise<SetupStatus>
      filesTree: () => Promise<FileNode[]>
      filesList: (dir?: string) => Promise<FileNode[]>
      filesRead: (path: string) => Promise<string>
      filesWrite: (path: string, content: string) => Promise<void>
      filesCreate: (path: string) => Promise<void>
      filesMkdir: (path: string) => Promise<void>
      filesRename: (from: string, to: string) => Promise<void>
      filesDelete: (path: string) => Promise<void>
      knowledgeStatus: () => Promise<KnowledgeStatus>
      knowledgeRetrieve: (task: string) => Promise<ContextPack>
      knowledgeComplete: (request: KnowledgeCompletionRequest) => Promise<KnowledgeCompletion[]>
      inlineComplete: (request: InlineCompletionRequest) => Promise<string>
      knowledgeGraph: (id?: string) => Promise<KnowledgeGraph>
      sourceGraph: () => Promise<SourceGraph>
      knowledgeGet: (id: string) => Promise<{ id: string; title: string; content: string }>
      knowledgeInit: () => Promise<KnowledgeStatus>
      knowledgeValidate: () => Promise<Diagnostic[]>
      knowledgeSyncApply: (
        reviewId: string,
        proposalIds: string[]
      ) => Promise<KnowledgeSyncApplyResult>
      knowledgeSyncDismiss: (reviewId: string) => Promise<void>
      rulesCheck: (path: string, content: string) => Promise<Diagnostic[]>
      brokerAudit: () => Promise<BrokerAuditEntry[]>
      recoveryBackups: () => Promise<WorkspaceBackup[]>
      recoveryRestore: (id: string) => Promise<string[]>
      recoveryLoadBuffers: () => Promise<RecoveryBuffer[]>
      recoverySaveBuffers: (buffers: RecoveryBuffer[]) => Promise<void>
      recoveryClearBuffers: () => Promise<void>
      privacyStatus: () => Promise<PrivacyStatus>
      privacyClearWorkspaceData: () => Promise<void>
      privacyClearCrashReports: () => Promise<void>
      vaultStatus: () => Promise<VaultStatus>
      vaultCreate: (passphrase: string) => Promise<VaultStatus>
      vaultUnlock: (passphrase: string) => Promise<VaultStatus>
      vaultLock: () => Promise<VaultStatus>
      vaultList: () => Promise<VaultEntry[]>
      vaultGet: (key: string) => Promise<string>
      vaultSet: (key: string, value: string) => Promise<void>
      vaultDelete: (key: string) => Promise<void>
      vaultDestroy: (passphrase: string) => Promise<void>
      vaultImportEnv: (path: string) => Promise<number>
      vaultApplyToTerminal: () => Promise<void>
      searchQuery: (query: string, opts?: SearchOptions) => Promise<SearchResult>
      searchReplace: (
        query: string,
        replacement: string,
        opts?: SearchOptions
      ) => Promise<ReplaceResult>
      filesAllPaths: () => Promise<string[]>
      gitStatus: () => Promise<GitStatus>
      gitInit: () => Promise<void>
      gitStage: (path: string) => Promise<void>
      gitUnstage: (path: string) => Promise<void>
      gitCommit: (message: string) => Promise<string>
      gitDiff: (path: string) => Promise<GitDiff>
      gitLog: () => Promise<GitLogEntry[]>
      gitBranches: () => Promise<string[]>
      gitCheckout: (branch: string) => Promise<void>
      gitCreateBranch: (branch: string) => Promise<void>
      gitPush: () => Promise<string>
      gitPull: () => Promise<string>
      terminalStart: (cols: number, rows: number) => Promise<string>
      terminalInput: (data: string) => Promise<void>
      terminalResize: (cols: number, rows: number) => Promise<void>
      terminalKill: () => Promise<void>
      onOpenFile: (cb: (path: string) => void) => () => void
      onFsChanged: (cb: (paths: string[]) => void) => () => void
      onTerminalData: (cb: (data: string) => void) => () => void
      onTerminalExit: (cb: () => void) => () => void
      skillsList: () => Promise<SkillInfo[]>
      skillsCreate: (
        provider: SkillProvider,
        scope: SkillScope,
        name: string
      ) => Promise<string>
      skillsDelete: (path: string) => Promise<void>
      skillsOpenExternal: (path: string) => Promise<string>
      skillsInstall: (
        target: SkillInstallTarget,
        scope: SkillScope
      ) => Promise<{ canceled: boolean; installed: string[] }>
      agentChooseAccount: (task: string) => Promise<AccountChoice>
      agentPlan: (provider: AuthProvider, task: string) => Promise<AgentPlan>
      agentEstimate: (provider: AuthProvider, task: string) => Promise<ContextTokenEstimate>
      agentPin: (provider: AuthProvider, pinned: boolean, task?: string) => Promise<boolean>
      agentRun: (
        provider: AuthProvider,
        task: string,
        plan?: string,
        modelMode?: ModelMode
      ) => Promise<void>
      agentStop: (provider: AuthProvider) => Promise<void>
      onAgentEvent: (cb: (e: AgentSessionEvent) => void) => () => void
    }
  }
}

export {}
