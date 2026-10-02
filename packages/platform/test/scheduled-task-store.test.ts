import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { ScheduledTaskManager } from '../src/scheduled-task-manager.js'
import { nextDailyRunAt, ScheduledTaskStore } from '../src/scheduled-task-store.js'

function fixture(t, initial = '2026-08-23T21:59:00.000Z') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bmw-scheduled-tasks-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  let now = new Date(initial)
  const store = new ScheduledTaskStore({ filePath: path.join(root, 'scheduled-tasks.json'), now: () => now })
  return { store, setNow: (value) => { now = new Date(value) } }
}

test('daily scheduled tasks use their IANA time zone and survive restart', (t) => {
  const { store } = fixture(t)
  const task = store.create({ id: 'project-1', dshSessionId: 'session-1' }, {
    name: 'Capture arena', prompt: 'Capture the latest @arena post.', time: '06:00', timeZone: 'Asia/Shanghai'
  })
  assert.equal(task.nextRunAt, '2026-08-23T22:00:00.000Z')
  assert.equal(nextDailyRunAt('06:00', 'Asia/Shanghai', new Date('2026-08-23T22:00:00.000Z')), '2026-08-24T22:00:00.000Z')
  const restored = new ScheduledTaskStore({ filePath: store.filePath })
  assert.equal(restored.get(task.id).prompt, 'Capture the latest @arena post.')
})

test('scheduled task runs are project isolated, durable, and recover interruption', (t) => {
  const { store } = fixture(t)
  const first = store.create({ id: 'project-1' }, { name: 'One', prompt: 'one', time: '06:00', timeZone: 'UTC' })
  const second = store.create({ id: 'project-2' }, { name: 'Two', prompt: 'two', time: '06:00', timeZone: 'UTC' })
  assert.throws(() => store.update('project-2', first.id, { enabled: false }), /another BMW Project/)
  const run = store.enqueue('project-1', first.id, 'manual')
  store.markRunning(run.id)
  assert.equal(store.recoverInterrupted()[0].status, 'interrupted')
  assert.equal(store.runs('project-1')[0].taskId, first.id)
  assert.equal(store.runs('project-2').length, 0)
  assert.equal(store.get(second.id).enabled, true)
})

test('scheduler serializes due and manual DSH task execution', async (t) => {
  const { store, setNow } = fixture(t, '2026-08-23T05:59:00.000Z')
  const order: string[] = []
  const manager = new ScheduledTaskManager({
    store,
    intervalMs: 60_000,
    execute: async (task) => {
      order.push(`start:${task.name}`)
      await new Promise((resolve) => setTimeout(resolve, 5))
      order.push(`end:${task.name}`)
      return `${task.name} done`
    }
  })
  const first = manager.create({ id: 'project-1', dshSessionId: 'session-1' }, { name: 'Due', prompt: 'due', time: '06:00', timeZone: 'UTC' })
  const second = manager.create({ id: 'project-1', dshSessionId: 'session-1' }, { name: 'Manual', prompt: 'manual', time: '07:00', timeZone: 'UTC' })
  manager.start()
  setNow('2026-08-23T06:00:01.000Z')
  await manager.tick()
  manager.runNow('project-1', second.id)
  await manager.queue
  manager.stop()
  assert.deepEqual(order, ['start:Due', 'end:Due', 'start:Manual', 'end:Manual'])
  assert.equal(store.runs('project-1', first.id)[0].status, 'completed')
  assert.equal(store.runs('project-1', second.id)[0].summary, 'Manual done')
})
