import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { AgentRunner } from '../src/main/agentRunner'
import { KnowledgeEngine } from '../src/main/knowledge/engine'
import { SecretBroker } from '../src/main/secretBroker'
import { chooseModel } from '../src/main/modelRouter'

let root: string

function write(relativePath: string, content: string): void {
  const path = join(root, relativePath)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'woo-todo-benchmark-'))
  write('.noli/disabled', 'benchmark uses Woo knowledge only\n')
  write('src/todo.ts', `export interface Todo { id: string; title: string; completed: boolean }
export function addTodo(title: string): Todo { return { id: crypto.randomUUID(), title, completed: false } }
export function toggleTodo(todo: Todo): Todo { return { ...todo, completed: !todo.completed } }
`)
  write('src/todoStore.ts', `import type { Todo } from './todo'
export class TodoStore {
  private todos: Todo[] = []
  list(): Todo[] { return [...this.todos] }
  add(todo: Todo): void { this.todos.push(todo) }
}
`)
  write('.woo/knowledge/components/todo-domain.md', `---
title: Todo Domain
type: component
description: Todo entities support adding, listing, and toggling completion state.
relationships:
  - predicate: uses
    to: Todo Store
---
The Todo interface has id, title, and completed fields. New items start incomplete.
Changes should preserve immutable updates and keep completed toggles reversible.
`)
  write('.woo/knowledge/components/todo-store.md', `---
title: Todo Store
type: component
description: Todo Store owns the in-memory collection and exposes list and add operations.
relationships:
  - predicate: supports
    to: Todo Domain
---
TodoStore is the single owner of the collection. Keep persistence concerns outside this small demo.
`)
  write('.woo/knowledge/rules/todo-tests.md', `---
title: Todo Tests
type: rule
description: Todo changes require tests for adding items and toggling completion.
---
Tests should cover the initial incomplete state, the completed state, and a second toggle back.
`)
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('Todo project token and latency benchmark', () => {
  it('measures fresh, pinned, and repeated-task context with Woo retrieval', async () => {
    const knowledge = new KnowledgeEngine(root)
    const runner = new AgentRunner(root, new SecretBroker(root), knowledge)
    const tasks = [
      'add a todo item and test its initial incomplete state',
      'toggle a todo item and test completion state',
      'add a TodoStore list test'
    ]
    const measurements: Array<{ task: string; ms: number; tokens: number; docs: number }> = []

    for (const task of tasks) {
      const started = performance.now()
      const estimate = await runner.estimateContext(task)
      measurements.push({
        task,
        ms: performance.now() - started,
        tokens: estimate.totalTokens,
        docs: estimate.documentCount
      })
    }

    const firstPack = await knowledge.retrieve(tasks[0])
    expect(firstPack.tokenEstimate).toBeGreaterThan(0)
    expect(measurements.every((measurement) => measurement.tokens > 0)).toBe(true)
    expect(measurements.every((measurement) => measurement.docs <= 5)).toBe(true)

    runner.setPinned(true, firstPack)
    const pinned = await runner.estimateContext('toggle the same todo item')
    expect(pinned.pinned).toBe(true)
    expect(pinned.totalTokens).toBe(firstPack.tokenEstimate * 2)

    const pinnedRepeat = await runner.estimateContext('toggle the same todo item')
    expect(pinnedRepeat.pinned).toBe(true)
    runner.setPinned(false)
    const freshRepeat = await runner.estimateContext('toggle the same todo item')
    expect(freshRepeat.pinned).toBe(false)
    console.table([
      ...measurements.map(({ task, ms, tokens, docs }) => ({
        mode: 'fresh', task, ms: Number(ms.toFixed(2)), tokens, docs
      })),
      { mode: 'pinned', task: 'toggle the same todo item', ms: 0, tokens: pinned.totalTokens, docs: pinned.documentCount },
      { mode: 'pinned-repeat', task: 'toggle the same todo item', ms: 0, tokens: pinnedRepeat.totalTokens, docs: pinnedRepeat.documentCount },
      { mode: 'fresh-repeat', task: 'toggle the same todo item', ms: 0, tokens: freshRepeat.totalTokens, docs: freshRepeat.documentCount }
    ])

    const routing = tasks.flatMap((task) => {
      const context = measurements.find((measurement) => measurement.task === task)!
      return (['auto', 'light', 'standard', 'deep'] as const).map((mode) => {
        const choice = chooseModel('claude', task, {
          packTokens: context.tokens,
          packDocs: context.docs,
          force: mode === 'auto' ? undefined : mode
        })
        return { task, mode, tier: choice.tier, model: choice.model, contextTokens: context.tokens }
      })
    })
    console.table(routing)
    // Smart routing and an explicitly forced Standard model have the same
    // result for these ordinary Todo tasks; only the selected model tier
    // changes, not Woo's retrieved context.
    expect(routing.filter((row) => row.mode === 'auto').every((row) => row.tier === 'standard')).toBe(true)
    expect(routing.filter((row) => row.mode === 'auto').map((row) => row.contextTokens))
      .toEqual(routing.filter((row) => row.mode === 'standard').map((row) => row.contextTokens))
  })
})
