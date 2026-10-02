// @ts-nocheck -- BMW TypeScript migration baseline for legacy test doubles.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { ProductProfileImporter } from '../src/product-profile-importer.js'
import { ProjectStore } from '../src/project-store.js'

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bmw-profile-import-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const sourceRoot = path.join(root, 'BMW')
  const sourceDirectory = path.join(sourceRoot, 'projects', 'source-1')
  fs.mkdirSync(path.join(sourceDirectory, 'memory'), { recursive: true })
  fs.mkdirSync(path.join(sourceDirectory, 'artifacts'), { recursive: true })
  fs.mkdirSync(path.join(sourceDirectory, 'test-runs', 'run-1'), { recursive: true })
  fs.mkdirSync(path.join(sourceDirectory, 'src'), { recursive: true })
  fs.writeFileSync(path.join(sourceDirectory, 'AGENTS.md'), '# Imported rules\n')
  fs.writeFileSync(path.join(sourceDirectory, 'MEMORY.md'), '# Imported memory\n')
  fs.writeFileSync(path.join(sourceDirectory, 'TASKS.md'), '# Imported tasks\n')
  for (const name of ['decisions', 'entities', 'preferences', 'history']) fs.writeFileSync(path.join(sourceDirectory, 'memory', `${name}.md`), `# ${name}\n`)
  fs.writeFileSync(path.join(sourceDirectory, 'artifacts', 'selected.png'), 'image')
  fs.writeFileSync(path.join(sourceDirectory, 'artifacts', 'private.png'), 'private')
  fs.writeFileSync(path.join(sourceDirectory, 'test-runs', 'run-1', 'report.json'), '{"status":"passed"}')
  fs.writeFileSync(path.join(sourceDirectory, 'index.html'), '<h1>Imported</h1>')
  fs.writeFileSync(path.join(sourceDirectory, 'src', 'main.js'), 'console.log("BMWDev")')
  fs.writeFileSync(path.join(sourceRoot, 'projects.json'), JSON.stringify({
    version: 1,
    projects: [{ id: 'source-1', name: 'Research', directory: sourceDirectory, homeUrl: 'https://example.com/', tabState: { urls: ['https://example.com/a'], activeUrl: 'https://example.com/a' }, archivedAt: null }]
  }))
  fs.writeFileSync(path.join(sourceRoot, 'session-continuity.json'), JSON.stringify({ sites: { 'https://example.com': {} } }))

  const targetRoot = path.join(root, 'BMWDev')
  const projectStore = new ProjectStore({
    filePath: path.join(targetRoot, 'projects.json'),
    projectsDirectory: path.join(targetRoot, 'projects'),
    legacyWorkspacePath: path.join(targetRoot, 'workspace')
  })
  const runtimeImports = []
  const importer = new ProductProfileImporter({
    sourceRoot,
    targetProductId: 'bmw-dev',
    projectStore,
    webRuntime: {
      openWorkspace: async () => {},
      importFiles: async (snapshot) => { runtimeImports.push(snapshot) }
    },
    session: { cookies: { set: async () => {} } },
    sessionContinuity: { setForUrl: async () => {} },
    safeStorage: { isEncryptionAvailable: () => false }
  })
  return { importer, projectStore, runtimeImports }
}

test('profile import preview exposes selectable data, not secrets or DSH execution state', (t) => {
  const { importer } = fixture(t)
  const preview = importer.preview()
  assert.equal(preview.available, true)
  assert.deepEqual(preview.cookieOrigins, ['https://example.com'])
  assert.deepEqual(preview.projects[0].artifacts.map((artifact) => artifact.id).sort(), ['private.png', 'selected.png'])
  assert.equal(Object.hasOwn(preview.projects[0], 'connectors'), false)
  assert.equal(Object.hasOwn(preview.projects[0], 'dshSessionId'), false)
})

test('explicit import copies selected platform data and moves source only into OPFS', async (t) => {
  const { importer, projectStore, runtimeImports } = fixture(t)
  const result = await importer.importProject({
    projectId: 'source-1', includeDocuments: true, includeHomeUrl: true, includeTabs: true,
    includeSource: true, includeLegacyEvidence: true, artifactIds: ['selected.png'], cookieOrigins: []
  })
  const project = projectStore.get(result.project.id)
  assert.equal(project.dshSessionId, null)
  assert.deepEqual(project.connectors, {})
  assert.equal(projectStore.readDocument(project.id, 'instructions').content, '# Imported rules\n')
  assert.equal(fs.existsSync(path.join(project.directory, 'artifacts', 'selected.png')), true)
  assert.equal(fs.existsSync(path.join(project.directory, 'artifacts', 'private.png')), false)
  assert.equal(fs.existsSync(path.join(project.directory, 'legacy-evidence', 'test-runs', 'run-1', 'report.json')), true)
  assert.equal(fs.existsSync(path.join(project.directory, 'index.html')), false)
  assert.deepEqual(runtimeImports[0].files.map((file) => file.path).sort(), ['index.html', 'src/main.js'])
  assert.equal(result.sourceFiles, 2)
})

test('profile importer refuses Project directories outside the Base profile', (t) => {
  const { importer } = fixture(t)
  const statePath = path.join(importer.sourceRoot, 'projects.json')
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
  state.projects[0].directory = os.tmpdir()
  fs.writeFileSync(statePath, JSON.stringify(state))
  assert.equal(importer.preview().projects.length, 0)
  assert.throws(() => importer.sourceProject('source-1'), /outside/)
})

test('cookie import restores only explicitly selected origins and enables target re-encryption', async (t) => {
  const { importer } = fixture(t)
  fs.writeFileSync(path.join(importer.sourceRoot, 'session-cookies.enc'), Buffer.from(JSON.stringify({
    version: 1,
    cookies: [
      { origin: 'https://example.com', name: 'session', value: 'selected', path: '/', secure: true, httpOnly: true, sameSite: 'lax', hostOnly: true, session: true },
      { origin: 'https://other.example', name: 'session', value: 'not-selected', path: '/', secure: true, hostOnly: true, session: true }
    ]
  })))
  const set = []
  const continuity = []
  importer.safeStorage = { isEncryptionAvailable: () => true, decryptString: (value) => value.toString() }
  importer.session = { cookies: { set: async (cookie) => { set.push(cookie) } } }
  importer.sessionContinuity = { setForUrl: async (origin) => { continuity.push(origin) } }
  const count = await importer.importCookies(['https://example.com'])
  assert.equal(count, 1)
  assert.equal(set[0].value, 'selected')
  assert.deepEqual(continuity, ['https://example.com'])
})
