// Shared types crossing the IPC bridge between main and renderer.

export interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileNode[]
}

export interface WorkspaceInfo {
  root: string
  name: string
  knowledgeReady: boolean
}

export interface SetupCheck {
  id: 'runtime' | 'native' | 'workspace' | 'knowledge' | 'provider'
  label: string
  status: 'pass' | 'action' | 'warning'
  detail: string
}

export interface SetupStatus {
  ready: boolean
  checks: SetupCheck[]
}

export interface PrivacyStatus {
  backupCount: number
  recoverableBufferCount: number
  crashReportCount: number
  telemetryEnabled: false
  agentShellEnabled: boolean
}

export interface WorkspaceBackup {
  id: string
  createdAt: string
  reason: string
  files: string[]
  totalBytes: number
  truncated: boolean
}

export interface RecoveryBuffer {
  path: string
  content: string
}

// ── Knowledge ────────────────────────────────────────────────────────────────

export interface KnowledgeDocSummary {
  id: string
  title: string
  type: string
  description?: string
  path?: string
}

export interface KnowledgeStatus {
  root: string
  documents: KnowledgeDocSummary[]
  byType: Record<string, KnowledgeDocSummary[]>
}

export interface KnowledgeSource {
  id: string
  seed: boolean
  score?: number
  distance?: number
  relationship?: string
}

export interface ContextPack {
  task: string
  context: string
  sources: KnowledgeSource[]
  tokenEstimate: number
  documents: KnowledgeDocSummary[]
}

export interface KnowledgeCompletionRequest {
  path: string
  language: string
  prefix: string
  terms: string[]
}

export interface KnowledgeCompletion {
  label: string
  insertText: string
  detail: string
  documentation: string
  sourcePath: string
  kind: 'reference' | 'path'
}

export interface ContextTokenEstimate {
  task: string
  planningTokens: number
  executionTokens: number
  totalTokens: number
  documentCount: number
  pinned: boolean
}

export interface KnowledgeSyncProposal {
  id: string
  documentId: string
  documentTitle: string
  path: string
  reason: string
  diff: string
  tokenDeltaEstimate: number
}

export interface KnowledgeSyncReview {
  id: string
  task: string
  changedFiles: string[]
  proposals: KnowledgeSyncProposal[]
}

export interface KnowledgeSyncApplyResult {
  updatedPaths: string[]
}

export interface GraphNode {
  id: string
  title: string
  type: string
  path?: string
  layer?: 'knowledge' | 'code'
}

export interface GraphEdge {
  from: string
  to: string
  predicate: string
  layer?: 'knowledge' | 'code'
}

export interface KnowledgeGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export type SourceGraph = KnowledgeGraph

// ── Diagnostics ─────────────────────────────────────────────────────────

export type Severity = 'error' | 'warning' | 'info'

export interface Diagnostic {
  ruleId: string
  message: string
  file: string
  line: number
  column: number
  severity: Severity
  source: string
  definedIn?: string
}

// ── Search ──────────────────────────────────────────────────────────────

export interface SearchMatch {
  file: string
  line: number
  column: number
  preview: string
}

export interface SearchOptions {
  regex?: boolean
  caseSensitive?: boolean
}

export interface SearchResult {
  matches: SearchMatch[]
  truncated?: boolean
  error?: string
}

export interface ReplaceResult {
  files: number
  replacements: number
  error?: string
}

// ── Git ─────────────────────────────────────────────────────────────────

export interface GitFileChange {
  path: string
  status: string
  staged: boolean
}

export interface GitStatus {
  isRepo: boolean
  branch?: string
  changes: GitFileChange[]
}

export interface GitDiff {
  path: string
  original: string
  modified: string
}

export interface GitLogEntry {
  hash: string
  author: string
  date: string
  subject: string
}

// ── Vault ───────────────────────────────────────────────────────────────

export interface VaultStatus {
  exists: boolean
  unlocked: boolean
  entryCount: number
}

export interface VaultEntry {
  key: string
  masked: string
}

// ── Secret broker ───────────────────────────────────────────────────────

export interface BrokerDecision {
  allowed: boolean
  reason?: string
  pattern?: string
}

export interface BrokerAuditEntry {
  timestamp: number
  action: 'denied-read' | 'scrubbed-output'
  path?: string
  pattern?: string
}

// ── Agent ───────────────────────────────────────────────────────────────

// 'opencode-go' is a second credential set under the same opencode CLI
// (open-weights models only — no claude/gpt) — see authService.ts.
export type AuthProvider = 'claude' | 'codex' | 'opencode' | 'opencode-go'

/** Providers with a skills directory convention Woo manages. */
export type SkillProvider = 'claude' | 'codex'

export interface AuthProviderStatus {
  provider: AuthProvider
  displayName: string
  installed: boolean
  authenticated: boolean
  /** False when a provider is intentionally gated behind an explicit opt-in. */
  available?: boolean
  authMethod?: string
  account?: string
  error?: string
}

export type SkillInstallTarget = SkillProvider | 'both'

export type SkillScope = 'account' | 'project'

export interface SkillInfo {
  provider: SkillProvider
  scope: SkillScope
  name: string
  description: string
  // Workspace-relative for project scope; absolute for account scope
  // (account skills live in the connected CLI's home dir).
  path: string
}

export interface AgentMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  toolName?: string
}

export interface AgentSessionEvent {
  // 'text-stream' carries the full scrubbed text of the in-progress
  // assistant message; the renderer replaces, not appends.
  type: 'text' | 'text-stream' | 'tool-use' | 'tool-denied' | 'context-pack' | 'knowledge-sync' | 'context-invalidated' | 'model-choice' | 'done' | 'error'
  text?: string
  toolName?: string
  toolInput?: string
  pack?: ContextPack
  sync?: KnowledgeSyncReview
  error?: string
}

export interface AgentPlan {
  task: string
  steps: string[]
}

// ── Model routing ───────────────────────────────────────────────────────

export type ModelTier = 'light' | 'standard' | 'deep'
export type ModelMode = 'auto' | ModelTier

export interface ModelChoice {
  provider: AuthProvider
  tier: ModelTier
  model: string // empty = provider default
  reason: string
}

// ── Account routing ─────────────────────────────────────────────────────
// Which connected account plans a task vs which executes it — decided by
// Woo, not picked manually (see modelRouter.chooseAccount).

export interface AccountChoice {
  planProvider: AuthProvider
  executeProvider: AuthProvider
  reason: string
}
