import { spawn, type IPty } from 'node-pty'
import { mergePtyEnv } from './terminalEnv'

const SCROLLBACK_LIMIT = 200 * 1024

/**
 * PTY terminal, main-process only (UI-001). Strictly human-facing:
 * output streams to the renderer terminal tab and NEVER into the agent
 * transcript — the agent has no channel into this service. One shell
 * session per window; a scrollback buffer replays when the tab remounts.
 */
export class TerminalService {
  private pty: IPty | null = null
  // Chunk ring buffer: appending is O(chunk); the old string+slice approach
  // copied the whole 200KB scrollback on every output chunk.
  private chunks: string[] = []
  private chunkBytes = 0
  private onData: ((data: string) => void) | null = null
  private onExit: (() => void) | null = null
  // Vault values injected at PTY spawn only (Claypso `pull --inject`
  // equivalent) — merged at spawn time, NEVER written to process.env, so
  // agent subprocess environments can never inherit them.
  private extraEnv: Record<string, string> = {}

  constructor(private workspaceRoot: string) {}

  /** Applies to the NEXT shell spawn; kill() + reopen tab to take effect. */
  setExtraEnv(env: Record<string, string>): void {
    this.extraEnv = env
  }

  attach(onData: (data: string) => void, onExit: () => void): void {
    this.onData = onData
    this.onExit = onExit
  }

  private scrollback(): string {
    return this.chunks.join('')
  }

  /** Ensure a session exists; returns scrollback for replay. */
  start(cols: number, rows: number): string {
    if (this.pty) {
      this.resize(cols, rows)
      return this.scrollback()
    }
    const shell = process.env.SHELL || '/bin/bash'
    const pty = spawn(shell, [], {
      name: 'xterm-256color',
      cwd: this.workspaceRoot,
      env: mergePtyEnv(process.env, this.extraEnv),
      cols,
      rows
    })
    this.pty = pty
    pty.onData((data) => {
      this.chunks.push(data)
      this.chunkBytes += data.length
      while (this.chunkBytes > SCROLLBACK_LIMIT && this.chunks.length > 1) {
        this.chunkBytes -= this.chunks.shift()!.length
      }
      this.onData?.(data)
    })
    pty.onExit(() => {
      if (this.pty === pty) this.pty = null
      this.onExit?.()
    })
    return this.scrollback()
  }

  input(data: string): void {
    this.pty?.write(data)
  }

  resize(cols: number, rows: number): void {
    if (cols > 0 && rows > 0) this.pty?.resize(cols, rows)
  }

  kill(): void {
    this.pty?.kill()
    this.pty = null
    this.chunks = []
    this.chunkBytes = 0
  }
}
