import type { ScheduledTask, ScheduledTaskRun } from './scheduled-task-store.js'
import { ScheduledTaskStore } from './scheduled-task-store.js'
import {backgroundDiagnostic} from './background-admission.js'

interface ScheduledTaskManagerOptions {
  store: ScheduledTaskStore
  execute: (task: ScheduledTask, run: ScheduledTaskRun) => Promise<unknown>
  onRun?: (run: ScheduledTaskRun, task: ScheduledTask) => void
  intervalMs?: number
  canStart?:(task:ScheduledTask)=>boolean|string
}

export class ScheduledTaskManager {
  readonly store: ScheduledTaskStore
  readonly executeTask: ScheduledTaskManagerOptions['execute']
  readonly onRun?: ScheduledTaskManagerOptions['onRun']
  readonly intervalMs: number
  private readonly scheduled=new Set<string>()
  private readonly waitingReasons=new Map<string,string>()
  readonly canStart:ScheduledTaskManagerOptions['canStart']
  queue: Promise<void> = Promise.resolve()
  timer: NodeJS.Timeout | null = null
  stopped = true

  constructor({ store, execute, onRun, canStart, intervalMs = 30_000 }: ScheduledTaskManagerOptions) {
    this.canStart=canStart
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
    for(const run of this.store.pendingRuns())this.enqueueExecution(run)
    for (const task of this.store.due()) {
      const run = this.store.enqueue(task.projectId, task.id, 'scheduled')
      this.enqueueExecution(run)
    }
  }

  create(project: { id: string; sessionId?: string | null; driverId: string }, input: Record<string, unknown>): ScheduledTask {
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
    if(this.scheduled.has(run.id))return
    this.scheduled.add(run.id)
    this.queue = this.queue.then(async () => {
      if (this.stopped) return
      const current = this.store.pendingRuns().find((candidate) => candidate.id === run.id)
      if (!current) return
      const savedTask=this.store.get(current.taskId)
      const admission=this.canStart?.(structuredClone(savedTask))??true
      if(admission!==true){const reason=typeof admission==='string'?admission:'resources-busy';if(this.waitingReasons.get(run.id)!==reason){this.waitingReasons.set(run.id,reason);backgroundDiagnostic({kind:savedTask.intervalMinutes===60?'hourly':'scheduled',stage:'waiting',runId:run.id,taskId:run.taskId,queuedAt:current.queuedAt,reason})}return}
      this.waitingReasons.delete(run.id)
      const running = this.store.markRunning(run.id)
      const task = this.store.get(running.taskId)
      this.onRun?.(running, task)
      backgroundDiagnostic({kind:task.intervalMinutes===60?'hourly':'scheduled',stage:'started',runId:run.id,taskId:task.id,queuedAt:running.queuedAt,startedAt:running.startedAt,waitingMs:Date.parse(running.startedAt!)-Date.parse(running.queuedAt)})
      try {
        const output = await this.executeTask(structuredClone(task), running)
        const summary = typeof output === 'string' ? output : JSON.stringify(output ?? '')
        const completed = this.store.finish(run.id, 'completed', { summary })
        this.onRun?.(completed, task)
        this.logFinished(completed)
      } catch (error) {
        const failed = this.store.finish(run.id, 'failed', { error: (error as Error).message })
        this.onRun?.(failed, task)
        this.logFinished(failed)
      }
    }).catch((error) => console.error('BMW scheduled task queue failed', error)).finally(()=>{this.scheduled.delete(run.id)})
  }
  private logFinished(run:ScheduledTaskRun):void {backgroundDiagnostic({kind:'scheduled',stage:'finished',runId:run.id,status:run.status,queuedAt:run.queuedAt,startedAt:run.startedAt,finishedAt:run.finishedAt,waitingMs:run.startedAt?Date.parse(run.startedAt)-Date.parse(run.queuedAt):null,executionMs:run.startedAt&&run.finishedAt?Date.parse(run.finishedAt)-Date.parse(run.startedAt):null,hasError:Boolean(run.error)})}
}
