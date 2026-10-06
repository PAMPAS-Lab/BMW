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
  const task = store.create({ id: 'project-1',driverId:'fixture', sessionId: 'session-1' }, {
    name: 'Capture arena', prompt: 'Capture the latest @arena post.', time: '06:00', timeZone: 'Asia/Shanghai'
  })
  assert.equal(task.nextRunAt, '2026-08-23T22:00:00.000Z')
  assert.equal(nextDailyRunAt('06:00', 'Asia/Shanghai', new Date('2026-08-23T22:00:00.000Z')), '2026-08-24T22:00:00.000Z')
  const restored = new ScheduledTaskStore({ filePath: store.filePath })
  assert.equal(restored.get(task.id).prompt, 'Capture the latest @arena post.')
})

test('scheduled task runs are project isolated, durable, and recover interruption', (t) => {
  const { store } = fixture(t)
  const first = store.create({ id: 'project-1',sessionId:'session-1',driverId:'qoder-cn' }, { name: 'One', prompt: 'one', time: '06:00', timeZone: 'UTC' })
  const second = store.create({ id: 'project-2',sessionId:'session-2',driverId:'codex' }, { name: 'Two', prompt: 'two', time: '06:00', timeZone: 'UTC' })
  assert.equal(first.driverId,'qoder-cn');assert.equal(second.driverId,'codex')
  assert.throws(()=>store.create({id:'project-1',driverId:'fixture'},{name:'Unbound',prompt:'no',time:'06:00',timeZone:'UTC'}),/explicit BMW Session/)
  assert.throws(() => store.update('project-2', first.id, { enabled: false }), /another BMW Project/)
  const run = store.enqueue('project-1', first.id, 'manual')
  store.markRunning(run.id)
  assert.equal(store.recoverInterrupted()[0].status, 'interrupted')
  assert.equal(store.runs('project-1')[0].taskId, first.id)
  assert.equal(store.runs('project-2').length, 0)
  assert.equal(store.get(second.id).enabled, true)
})

test('scheduler serializes due and manual Agent task execution', async (t) => {
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
  const first = manager.create({ id: 'project-1',driverId:'fixture', sessionId: 'session-1' }, { name: 'Due', prompt: 'due', time: '06:00', timeZone: 'UTC' })
  const second = manager.create({ id: 'project-1',driverId:'fixture', sessionId: 'session-1' }, { name: 'Manual', prompt: 'manual', time: '07:00', timeZone: 'UTC' })
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
test('Schedules require explicit driver ownership and unbound tasks can only be enabled after a BMW binding',t=>{
 const {store}=fixture(t)
 const bound=store.create({id:'p',driverId:'codex',sessionId:'stable-bmw'},{name:'Bound',prompt:'status',time:'06:00',timeZone:'UTC'})
 const saved=JSON.parse(fs.readFileSync(store.filePath,'utf8'));delete saved.tasks[0].driverId
 fs.writeFileSync(store.filePath,JSON.stringify(saved));const before=fs.readFileSync(store.filePath,'utf8')
 assert.throws(()=>new ScheduledTaskStore({filePath:store.filePath}),/explicit scheduled driver/)
 assert.equal(fs.readFileSync(store.filePath,'utf8'),before)
 saved.tasks[0].driverId='codex';saved.tasks.push({...saved.tasks[0],id:'unbound',driverId:null,sessionId:null,enabled:false})
 fs.writeFileSync(store.filePath,JSON.stringify(saved))
 const restored=new ScheduledTaskStore({filePath:store.filePath})
 assert.equal(restored.get(bound.id).driverId,'codex');assert.equal(restored.get(bound.id).sessionId,'stable-bmw')
 assert.equal(restored.get('unbound').enabled,false)
 assert.throws(()=>restored.update('p','unbound',{enabled:true}),/explicit BMW Session/)
 restored.bindSession('unbound','qoder-bmw','qoder-cn');restored.update('p','unbound',{enabled:true})
 const run=restored.enqueue('p','unbound','manual')
 assert.throws(()=>restored.bindSession('unbound','other','codex'),/running or queued/)
 assert.equal(restored.get('unbound').sessionId,'qoder-bmw');assert.equal(restored.activeRun('unbound')?.id,run.id)
})
