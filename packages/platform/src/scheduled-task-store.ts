import {readStateFile,stateRecord} from './state-load.js'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export type ScheduledTaskRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'interrupted'
export type ScheduledTaskRunTrigger = 'scheduled' | 'manual'

export interface ScheduledTaskRun {
  id: string
  taskId: string
  projectId: string
  trigger: ScheduledTaskRunTrigger
  status: ScheduledTaskRunStatus
  queuedAt: string
  startedAt: string | null
  finishedAt: string | null
  summary: string
  error: string
}

export interface ScheduledTask {
  id: string
  projectId: string
  sessionId: string | null
  driverId: string | null
  name: string
  prompt: string
  schedule: { kind: 'daily'; time: string; timeZone: string }
  enabled: boolean
  nextRunAt: string | null
  lastRunAt: string | null
  lastRunStatus: ScheduledTaskRunStatus | null
  lastError: string
  createdAt: string
  updatedAt: string
}

interface ScheduledTaskState {
  version: 2
  tasks: ScheduledTask[]
  runs: ScheduledTaskRun[]
}

interface ScheduledTaskStoreOptions {
  filePath: string
  now?: () => Date
  onState?: (snapshot: { tasks: ScheduledTask[] }) => void
}

const MAX_TASKS = 100
const MAX_RUNS = 500
const ACTIVE_RUN_STATUSES = new Set<ScheduledTaskRunStatus>(['queued', 'running'])

function writeAtomically(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 })
  const temporary = `${filePath}.tmp`
  fs.writeFileSync(temporary, content, { mode: 0o600 })
  fs.renameSync(temporary, filePath)
}

function cleanText(value: unknown, label: string, maximum: number): string {
  const text = String(value ?? '').trim()
  if (!text) throw new Error(`${label} is required.`)
  if (text.length > maximum) throw new Error(`${label} must be ${maximum} characters or fewer.`)
  return text
}

function cleanTime(value: unknown): string {
  const time = String(value ?? '').trim()
  const match = /^(\d{2}):(\d{2})$/.exec(time)
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) {
    throw new Error('Scheduled task time must use 24-hour HH:mm format.')
  }
  return time
}

function cleanTimeZone(value: unknown): string {
  const timeZone = String(value || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC').trim()
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date())
  } catch {
    throw new Error(`Unknown scheduled task time zone: ${timeZone}`)
  }
  return timeZone
}

function partsAt(epoch: number, timeZone: string): Record<string, number> {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(epoch))
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]))
}

function zonedEpoch(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): number {
  const desired = Date.UTC(year, month - 1, day, hour, minute, 0)
  let candidate = desired
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const actual = partsAt(candidate, timeZone)
    const represented = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second)
    const adjustment = desired - represented
    candidate += adjustment
    if (!adjustment) break
  }
  return candidate
}

export function nextDailyRunAt(time: string, timeZone: string, after = new Date()): string {
  const normalizedTime = cleanTime(time)
  const normalizedTimeZone = cleanTimeZone(timeZone)
  const [hour, minute] = normalizedTime.split(':').map(Number)
  const local = partsAt(after.getTime(), normalizedTimeZone)
  for (let offset = 0; offset < 3; offset += 1) {
    const day = new Date(Date.UTC(local.year, local.month - 1, local.day + offset))
    const candidate = zonedEpoch(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hour, minute, normalizedTimeZone)
    if (candidate > after.getTime()) return new Date(candidate).toISOString()
  }
  throw new Error('Could not calculate the next scheduled task occurrence.')
}

export function parseScheduledTaskState(raw:unknown):ScheduledTaskState {
      const value = stateRecord(raw)
      if (value.version !== 2 || !Array.isArray(value.tasks) || !Array.isArray(value.runs)) throw new Error('Unsupported or malformed scheduled task state.')
      const ids = new Set<string>()
      for (const rawTask of value.tasks) {
        const task = stateRecord(rawTask), schedule = stateRecord(task.schedule)
        if (typeof task.id !== 'string' || !task.id || ids.has(task.id) || typeof task.projectId !== 'string' || !task.projectId || typeof task.enabled !== 'boolean' || schedule.kind !== 'daily') throw new Error('Invalid scheduled task identity or schedule.')
        cleanText(task.name, 'name', 120); cleanText(task.prompt, 'prompt', 20_000)
        cleanTime(schedule.time); cleanTimeZone(schedule.timeZone)
        if(task.sessionId!==null&&(typeof task.sessionId!=='string'||!task.sessionId||task.sessionId.length>4096))throw new Error('Invalid scheduled Session binding.')
        if(task.driverId===undefined)throw new Error('An explicit scheduled driver is required.')
        if(task.driverId!==null&&(typeof task.driverId!=='string'||!/^[a-z0-9-]{1,64}$/u.test(task.driverId)))throw new Error('Invalid scheduled driver binding.')
        if(!task.sessionId||!task.driverId){task.enabled=false;task.nextRunAt=null;task.lastError='Select an explicit BMW Session and driver before enabling this task.'}
        ids.add(task.id)
      }
      const runIds = new Set<string>()
      for (const rawRun of value.runs) {
        const run = stateRecord(rawRun)
        if (typeof run.id !== 'string' || !run.id || runIds.has(run.id) || typeof run.taskId !== 'string' || !['queued','running','completed','failed','interrupted'].includes(String(run.status))) throw new Error('Invalid scheduled task run.')
        const task = value.tasks.find(raw => stateRecord(raw).id === run.taskId)
        if (typeof run.projectId !== 'string' || (task && stateRecord(task).projectId !== run.projectId)) throw new Error('Scheduled run Project mismatch.')
        if (!task && ACTIVE_RUN_STATUSES.has(run.status as ScheduledTaskRunStatus)) throw new Error('Active scheduled run has no task.')
        runIds.add(run.id)
      }
      return value as unknown as ScheduledTaskState
}

export class ScheduledTaskStore {
  readonly filePath: string
  readonly now: () => Date
  readonly onState?: ScheduledTaskStoreOptions['onState']
  state: ScheduledTaskState = { version: 2, tasks: [], runs: [] }

  constructor({ filePath, now = () => new Date(), onState }: ScheduledTaskStoreOptions) {
    this.filePath = filePath
    this.now = now
    this.onState = onState
    this.load()
  }

  load(): void {
    const loaded = readStateFile(this.filePath,parseScheduledTaskState)
    if (loaded) this.state = loaded
  }

  save(): void {
    this.state.runs = this.state.runs.slice(-MAX_RUNS)
    writeAtomically(this.filePath, `${JSON.stringify(this.state, null, 2)}\n`)
    this.onState?.(this.snapshot())
  }

  snapshot(projectId?: string): { tasks: ScheduledTask[] } {
    return { tasks: this.list(projectId) }
  }

  list(projectId?: string): ScheduledTask[] {
    return structuredClone(this.state.tasks
      .filter((task) => !projectId || task.projectId === projectId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt)))
  }

  get(taskId: string): ScheduledTask {
    const task = this.state.tasks.find((candidate) => candidate.id === taskId)
    if (!task) throw new Error(`Unknown scheduled task: ${taskId}`)
    return task
  }

  getForProject(projectId: string, taskId: string): ScheduledTask {
    const task = this.get(taskId)
    if (task.projectId !== projectId) throw new Error('The scheduled task belongs to another BMW Project.')
    return task
  }

  create(project: { id: string; sessionId?: string | null; driverId: string }, input: Record<string, unknown>): ScheduledTask {
    if (this.state.tasks.length >= MAX_TASKS) throw new Error(`BMW supports at most ${MAX_TASKS} scheduled tasks per product profile.`)
    const now = this.now()
    if(!project.sessionId)throw new Error('A scheduled task must be pinned to an explicit BMW Session.')
    const driverId=project.driverId
    if(!driverId)throw new Error('An explicit scheduled driver is required.')
    if(!/^[a-z0-9-]{1,64}$/u.test(driverId))throw new Error('Invalid scheduled driver binding.')
    const enabled = input.enabled !== false
    const time = cleanTime(input.time)
    const timeZone = cleanTimeZone(input.timeZone)
    const task: ScheduledTask = {
      id: crypto.randomUUID(),
      projectId: project.id,
      sessionId: project.sessionId || null,
      driverId,
      name: cleanText(input.name, 'Scheduled task name', 80),
      prompt: cleanText(input.prompt, 'Scheduled task prompt', 8_000),
      schedule: { kind: 'daily', time, timeZone },
      enabled,
      nextRunAt: enabled ? nextDailyRunAt(time, timeZone, now) : null,
      lastRunAt: null,
      lastRunStatus: null,
      lastError: '',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    }
    this.state.tasks.push(task)
    this.save()
    return structuredClone(task)
  }

  update(projectId: string, taskId: string, input: Record<string, unknown>): ScheduledTask {
    const task = this.getForProject(projectId, taskId)
    if(input.enabled===true&&(!task.sessionId||!task.driverId))throw new Error('Select an explicit BMW Session and driver before enabling this task.')
    if (input.name !== undefined) task.name = cleanText(input.name, 'Scheduled task name', 80)
    if (input.prompt !== undefined) task.prompt = cleanText(input.prompt, 'Scheduled task prompt', 8_000)
    if (input.time !== undefined) task.schedule.time = cleanTime(input.time)
    if (input.timeZone !== undefined) task.schedule.timeZone = cleanTimeZone(input.timeZone)
    if (input.enabled !== undefined) task.enabled = input.enabled === true
    task.nextRunAt = task.enabled ? nextDailyRunAt(task.schedule.time, task.schedule.timeZone, this.now()) : null
    task.updatedAt = this.now().toISOString()
    this.save()
    return structuredClone(task)
  }

  bindSession(taskId: string, sessionId: string, driverId?: string): ScheduledTask {
    const task = this.get(taskId)
    if(this.activeRun(taskId))throw new Error('Cannot change the binding of a running or queued task.')
    const driver=driverId??task.driverId
    if(!driver||!/^[a-z0-9-]{1,64}$/u.test(driver))throw new Error('An explicit scheduled driver is required.')
    task.sessionId = cleanText(sessionId, 'Agent Session id', 200)
    task.driverId=driver
    task.updatedAt = this.now().toISOString()
    this.save()
    return structuredClone(task)
  }

  remove(projectId: string, taskId: string): { removed: string } {
    this.getForProject(projectId, taskId)
    if (this.activeRun(taskId)) throw new Error('A running or queued scheduled task cannot be removed.')
    this.state.tasks = this.state.tasks.filter((task) => task.id !== taskId)
    this.save()
    return { removed: taskId }
  }

  due(at = this.now()): ScheduledTask[] {
    const timestamp = at.getTime()
    return this.list().filter((task) => task.enabled && task.nextRunAt && Date.parse(task.nextRunAt) <= timestamp && !this.activeRun(task.id))
  }

  activeRun(taskId: string): ScheduledTaskRun | null {
    return this.state.runs.find((run) => run.taskId === taskId && ACTIVE_RUN_STATUSES.has(run.status)) || null
  }

  enqueue(projectId: string, taskId: string, trigger: ScheduledTaskRunTrigger): ScheduledTaskRun {
    const task = this.getForProject(projectId, taskId)
    const active = this.activeRun(taskId)
    if (active) return structuredClone(active)
    const now = this.now()
    const run: ScheduledTaskRun = {
      id: crypto.randomUUID(), taskId, projectId, trigger, status: 'queued',
      queuedAt: now.toISOString(), startedAt: null, finishedAt: null, summary: '', error: ''
    }
    this.state.runs.push(run)
    if (trigger === 'scheduled') task.nextRunAt = nextDailyRunAt(task.schedule.time, task.schedule.timeZone, now)
    task.updatedAt = now.toISOString()
    this.save()
    return structuredClone(run)
  }

  pendingRuns(): ScheduledTaskRun[] {
    return structuredClone(this.state.runs.filter((run) => run.status === 'queued'))
  }

  markRunning(runId: string): ScheduledTaskRun {
    const run = this.state.runs.find((candidate) => candidate.id === runId)
    if (!run || run.status !== 'queued') throw new Error('Scheduled task run is not queued.')
    run.status = 'running'
    run.startedAt = this.now().toISOString()
    this.save()
    return structuredClone(run)
  }

  finish(runId: string, status: 'completed' | 'failed', input: { summary?: unknown; error?: unknown } = {}): ScheduledTaskRun {
    const run = this.state.runs.find((candidate) => candidate.id === runId)
    if (!run || !['queued', 'running'].includes(run.status)) throw new Error('Scheduled task run is not active.')
    const task = this.get(run.taskId)
    const now = this.now().toISOString()
    run.status = status
    run.finishedAt = now
    run.summary = String(input.summary || '').slice(0, 20_000)
    run.error = String(input.error || '').slice(0, 4_000)
    task.lastRunAt = now
    task.lastRunStatus = status
    task.lastError = run.error
    task.updatedAt = now
    this.save()
    return structuredClone(run)
  }

  recoverInterrupted(): ScheduledTaskRun[] {
    const recovered: ScheduledTaskRun[] = []
    const now = this.now().toISOString()
    for (const run of this.state.runs) {
      if (run.status !== 'running') continue
      run.status = 'interrupted'
      run.finishedAt = now
      run.error = 'BMW restarted before this scheduled task completed.'
      const task = this.state.tasks.find((candidate) => candidate.id === run.taskId)
      if (task) {
        task.lastRunAt = now
        task.lastRunStatus = 'interrupted'
        task.lastError = run.error
        task.updatedAt = now
      }
      recovered.push(structuredClone(run))
    }
    if (recovered.length) this.save()
    return recovered
  }

  runs(projectId: string, taskId?: string, limit = 20): ScheduledTaskRun[] {
    return structuredClone(this.state.runs
      .filter((run) => run.projectId === projectId && (!taskId || run.taskId === taskId))
      .slice(-Math.min(Math.max(limit, 1), 100))
      .reverse())
  }
}

export const scheduledTaskStoreInternals = { cleanTime, cleanTimeZone, partsAt, zonedEpoch }
