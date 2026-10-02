import type { ScheduledTask, ScheduledTaskRun } from './scheduled-task-store.js'
import { ScheduledTaskStore } from './scheduled-task-store.js'

interface ScheduledTaskManagerOptions {
  store: ScheduledTaskStore
  execute: (task: ScheduledTask, run: ScheduledTaskRun) => Promise<unknown>
  onRun?: (run: ScheduledTaskRun, task: ScheduledTask) => void
  intervalMs?: number
}

export class ScheduledTaskManager {
  readonly store: ScheduledTaskStore
  readonly executeTask: ScheduledTaskManagerOptions['execute']
  readonly onRun?: ScheduledTaskManagerOptions['onRun']
  readonly intervalMs: number
  queue: Promise<void> = Promise.resolve()
  timer: NodeJS.Timeout | null = null
  stopped = true

  constructor({ store, execute, onRun, intervalMs = 30_000 }: ScheduledTaskManagerOptions) {
    this.store = store
    this.executeTask = execute
    this.onRun = onRun
    this.intervalMs = intervalMs
  }

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    this.store.recoverInterrupted()
    for (const run of this.store.pendingRuns()) this.enqueueExecution(run)
    void this.tick()
    this.timer = setInterval(() => { void this.tick() }, this.intervalMs)
    this.timer.unref?.()
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async tick(): Promise<void> {
    if (this.stopped) return
    for (const task of this.store.due()) {
      const run = this.store.enqueue(task.projectId, task.id, 'scheduled')
      this.enqueueExecution(run)
    }
  }

  create(project: { id: string; dshSessionId?: string | null }, input: Record<string, unknown>): ScheduledTask {
    return this.store.create(project, input)
  }

  list(projectId: string): { tasks: ScheduledTask[]; runs: ScheduledTaskRun[] } {
    return { tasks: this.store.list(projectId), runs: this.store.runs(projectId) }
  }

  update(projectId: string, taskId: string, input: Record<string, unknown>): ScheduledTask {
    return this.store.update(projectId, taskId, input)
  }

  remove(projectId: string, taskId: string): { removed: string } {
    return this.store.remove(projectId, taskId)
  }

  runNow(projectId: string, taskId: string): { accepted: true; run: ScheduledTaskRun } {
    const run = this.store.enqueue(projectId, taskId, 'manual')
    this.enqueueExecution(run)
    return { accepted: true, run }
  }

  disableProject(projectId: string): void {
    for (const task of this.store.list(projectId).filter((candidate) => candidate.enabled)) {
      this.store.update(projectId, task.id, { enabled: false })
    }
  }

  enqueueExecution(run: ScheduledTaskRun): void {
    this.queue = this.queue.then(async () => {
      if (this.stopped) return
      const current = this.store.pendingRuns().find((candidate) => candidate.id === run.id)
      if (!current) return
      const running = this.store.markRunning(run.id)
      const task = this.store.get(running.taskId)
      this.onRun?.(running, task)
      try {
        const output = await this.executeTask(structuredClone(task), running)
        const summary = typeof output === 'string' ? output : JSON.stringify(output ?? '')
        const completed = this.store.finish(run.id, 'completed', { summary })
        this.onRun?.(completed, task)
      } catch (error) {
        const failed = this.store.finish(run.id, 'failed', { error: (error as Error).message })
        this.onRun?.(failed, task)
      }
    }).catch((error) => console.error('BMW scheduled task queue failed', error))
  }
}
