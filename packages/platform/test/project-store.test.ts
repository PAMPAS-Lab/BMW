// @ts-nocheck -- BMW TypeScript migration baseline for legacy test doubles.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { ProjectStore } from '../src/project-store.js'

function createStore(t, { completeSetup = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bmw-projects-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const store = new ProjectStore({
    filePath: path.join(root, 'projects.json'),
    projectsDirectory: path.join(root, 'projects'),
    initialWorkspacePath: path.join(root, 'legacy-workspace')
  })
  if (completeSetup) store.completeInitialSetup({ name: 'BMW Browser', homeUrl: 'https://www.google.com/' })
  return {
    root,
    store
  }
}

test('requires the first real Project name without leaving a default BMW Browser project', (t) => {
  const { store } = createStore(t, { completeSetup: false })
  assert.equal(store.needsInitialSetup(), true)
  assert.equal(store.snapshot().initialSetupPending, true)

  const project = store.completeInitialSetup({ name: 'First Research Project', homeUrl: '' })

  assert.equal(project.name, 'First Research Project')
  assert.equal(project.homeUrl, '')
  assert.equal(store.needsInitialSetup(), false)
  assert.equal(store.list().length, 1)
  assert.equal(fs.existsSync(path.join(project.directory, 'AGENTS.md')), true)
  assert.match(fs.readFileSync(path.join(project.directory, 'AGENTS.md'), 'utf8'), /First Research Project/)
  assert.equal(fs.existsSync(path.join(project.directory, 'MEMORY.md')), true)
  assert.equal(fs.existsSync(path.join(project.directory, 'TASKS.md')), true)
  assert.equal(fs.existsSync(path.join(project.directory, 'memory', 'decisions.md')), true)
  assert.equal(fs.statSync(path.join(project.directory, 'artifacts')).isDirectory(), true)
  assert.throws(() => store.completeInitialSetup({ name: 'Again' }), /already complete/)
})

test('does not send existing BMW installations back through first-project setup', (t) => {
  const { root, store } = createStore(t)
  const statePath = path.join(root, 'projects.json')
  const legacyState = JSON.parse(fs.readFileSync(statePath, 'utf8'))
  delete legacyState.initialSetupPending
  fs.writeFileSync(statePath, JSON.stringify(legacyState))

  const reloaded = new ProjectStore({
    filePath: statePath,
    projectsDirectory: path.join(root, 'projects'),
    initialWorkspacePath: path.join(root, 'legacy-workspace')
  })
  assert.equal(reloaded.needsInitialSetup(), false)
  assert.equal(reloaded.active().id, store.active().id)
})

test('creates, switches, updates and archives projects without deleting their files', (t) => {
  const { store } = createStore(t)
  const first = store.active()
  const second = store.create({ name: 'Research', homeUrl: 'https://example.com/start' })

  assert.equal(store.active().id, second.id)
  assert.equal(second.homeUrl, 'https://example.com/start')
  assert.throws(() => store.create({ name: 'research', homeUrl: 'https://example.com/' }), /already exists/)

  store.update(second.id, { name: 'Research Lab', homeUrl: 'https://example.org/' })
  store.writeDocument(second.id, 'memory', '# Verified memory\n\n- Fact with provenance.')
  assert.match(store.readDocument(second.id, 'memory').content, /Verified memory/)

  store.switch(first.id)
  store.archive(second.id)
  assert.equal(store.list().length, 1)
  assert.equal(fs.existsSync(path.join(second.directory, 'MEMORY.md')), true)
})

test('new projects accept an empty home URL and use a blank-page preference', (t) => {
  const { store } = createStore(t)
  const project = store.create({ name: 'Blank Workspace' })

  assert.equal(project.homeUrl, '')
  assert.equal(store.update(project.id, { homeUrl: '' }).homeUrl, '')
  assert.throws(() => store.update(project.id, { homeUrl: 'file:///private/data' }), /HTTP\(S\)/)
})

test('agent append is limited to memory documents and records provenance time', (t) => {
  const { store } = createStore(t)
  const project = store.active()
  store.appendDocument(project.id, 'memory', 'Observed example.com title: Example Domain.')

  const memory = store.readDocument(project.id, 'memory').content
  assert.match(memory, /Observed example\.com title/)
  assert.match(memory, /## \d{4}-\d{2}-\d{2}T/)
  assert.throws(() => store.appendDocument(project.id, 'instructions', 'replace policy'), /cannot be appended/)
})

test('tab state keeps only bounded HTTP(S) URLs', (t) => {
  const { store } = createStore(t)
  const project = store.active()
  store.updateTabState(project.id, {
    urls: ['https://example.com/', 'file:///secret', 'https://example.com/'],
    activeUrl: 'https://example.com/'
  })

  assert.deepEqual(store.active().tabState, {
    urls: ['https://example.com/'],
    activeUrl: 'https://example.com/'
  })
})

test('Project persistence contains only BMW ownership and keeps independent documents across reload',t=>{
 const {store,root}=createStore(t),first=store.active(),second=store.create({name:'Second Project'})
 store.writeDocument(first.id,'memory','First facts');store.writeDocument(second.id,'memory','Second facts')
 const saved=JSON.parse(fs.readFileSync(path.join(root,'projects.json'),'utf8'))
 assert.equal(saved.version,2)
 for(const project of saved.projects)for(const key of ['agentBindings','dshWorkspaceId','dshSessionId','connectors'])assert.equal(Object.hasOwn(project,key),false)
 const restored=new ProjectStore({filePath:store.filePath,projectsDirectory:path.join(root,'projects'),initialWorkspacePath:path.join(root,'workspace')})
 assert.equal(restored.active().id,second.id);restored.switch(first.id)
 assert.equal(restored.readDocument(first.id,'memory').content,'First facts\n')
 assert.equal(restored.readDocument(second.id,'memory').content,'Second facts\n')
})
