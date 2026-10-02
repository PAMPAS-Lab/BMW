import fs from 'node:fs'
import path from 'node:path'

const DOCUMENTS = Object.freeze({
  instructions: 'AGENTS.md',
  memory: 'MEMORY.md',
  tasks: 'TASKS.md',
  decisions: 'memory/decisions.md',
  entities: 'memory/entities.md',
  preferences: 'memory/preferences.md',
  history: 'memory/history.md'
})
const SOURCE_EXCLUDES = new Set([
  ...Object.values(DOCUMENTS),
  'artifacts', 'test-runs', 'tests', 'memory', 'node_modules', '.git', '.DS_Store'
])
const MAX_SOURCE_IMPORT_BYTES = 50 * 1024 * 1024

function readJson(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')) } catch { return fallback }
}

function inside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function safeSourceDirectory(sourceRoot, directory) {
  if (!inside(sourceRoot, directory)) throw new Error('The source Project directory is outside the BMW profile.')
  const stat = fs.lstatSync(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('The source Project directory is not importable.')
  return directory
}

function listImmediateFiles(directory) {
  try {
    return fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && !entry.isSymbolicLink())
      .map((entry) => ({ id: entry.name, bytes: fs.statSync(path.join(directory, entry.name)).size }))
  } catch { return [] }
}

function copyTreeReadOnly(source, target) {
  if (!fs.existsSync(source)) return 0
  let count = 0
  fs.mkdirSync(target, { recursive: true, mode: 0o700 })
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue
    const sourcePath = path.join(source, entry.name)
    const targetPath = path.join(target, entry.name)
    if (entry.isDirectory()) count += copyTreeReadOnly(sourcePath, targetPath)
    else if (entry.isFile()) {
      fs.copyFileSync(sourcePath, targetPath)
      fs.chmodSync(targetPath, 0o400)
      count += 1
    }
  }
  return count
}

function collectRuntimeFiles(directory, prefix = '', result = { files: [], bytes: 0 }) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || SOURCE_EXCLUDES.has(prefix ? `${prefix}/${entry.name}` : entry.name) || SOURCE_EXCLUDES.has(entry.name)) continue
    const fullPath = path.join(directory, entry.name)
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) collectRuntimeFiles(fullPath, relativePath, result)
    else if (entry.isFile()) {
      const bytes = fs.statSync(fullPath).size
      result.bytes += bytes
      if (result.bytes > MAX_SOURCE_IMPORT_BYTES) throw new Error('Selected source exceeds the 50 MB BMWDev OPFS import limit.')
      result.files.push({ path: relativePath, base64: fs.readFileSync(fullPath).toString('base64') })
    }
  }
  return result
}

function cookieUrl(cookie, origin) {
  const fallback = new URL(origin)
  const hostname = String(cookie.domain || fallback.hostname).replace(/^\./, '')
  const protocol = cookie.secure ? 'https:' : fallback.protocol
  const pathname = String(cookie.path || '/').startsWith('/') ? cookie.path || '/' : `/${cookie.path}`
  return `${protocol}//${hostname}${pathname}`
}

export class ProductProfileImporter {
  [key: string]: any

  constructor({ sourceRoot, targetProductId, projectStore, webRuntime, session, sessionContinuity, safeStorage }) {
    this.sourceRoot = path.resolve(sourceRoot)
    this.targetProductId = targetProductId
    this.projectStore = projectStore
    this.webRuntime = webRuntime
    this.session = session
    this.sessionContinuity = sessionContinuity
    this.safeStorage = safeStorage
  }

  sourceState() {
    const state = readJson(path.join(this.sourceRoot, 'projects.json'), null)
    if (!state || state.version !== 1 || !Array.isArray(state.projects)) return { projects: [] }
    return state
  }

  preview() {
    if (this.targetProductId === 'bmw') return { available: false, reason: 'BMW is the source profile.', projects: [], cookieOrigins: [] }
    const state = this.sourceState()
    const projects = state.projects.filter((project) => !project.archivedAt).flatMap((project) => {
      try {
        const directory = safeSourceDirectory(this.sourceRoot, project.directory)
        return [{
          id: project.id,
          name: project.name,
          homeUrl: project.homeUrl || '',
          tabCount: (project.tabState?.urls || []).length,
          artifacts: listImmediateFiles(path.join(directory, 'artifacts')),
          hasLegacyEvidence: fs.existsSync(path.join(directory, 'test-runs')),
          canImportSource: this.targetProductId === 'bmw-dev'
        }]
      } catch { return [] }
    })
    const continuity = readJson(path.join(this.sourceRoot, 'session-continuity.json'), { sites: {} })
    return { available: projects.length > 0, projects, cookieOrigins: Object.keys(continuity.sites || {}).sort() }
  }

  sourceProject(projectId) {
    const project = this.sourceState().projects.find((candidate) => candidate.id === projectId && !candidate.archivedAt)
    if (!project) throw new Error('The selected BMW Project is unavailable.')
    return { ...project, directory: safeSourceDirectory(this.sourceRoot, project.directory) }
  }

  uniqueName(input) {
    const base = String(input || 'Imported Project').trim().slice(0, 70) || 'Imported Project'
    const existing = new Set(this.projectStore.list().map((project) => project.name.toLowerCase()))
    if (!existing.has(base.toLowerCase())) return base
    for (let index = 2; index < 100; index += 1) {
      const candidate = `${base} (${index})`
      if (!existing.has(candidate.toLowerCase())) return candidate
    }
    throw new Error('Could not create a unique imported Project name.')
  }

  async importCookies(origins) {
    const selected = new Set((origins || []).map(String))
    if (!selected.size) return 0
    if (!this.safeStorage.isEncryptionAvailable()) throw new Error('OS-protected encryption is required to import cookies.')
    const allowed = new Set(this.preview().cookieOrigins)
    for (const origin of selected) if (!allowed.has(origin)) throw new Error(`Cookie origin was not selected from BMW: ${origin}`)
    const encrypted = fs.readFileSync(path.join(this.sourceRoot, 'session-cookies.enc'))
    const snapshot = JSON.parse(this.safeStorage.decryptString(encrypted))
    let imported = 0
    for (const cookie of snapshot.cookies || []) {
      if (!selected.has(cookie.origin)) continue
      const details: Record<string, any> = {
        url: cookieUrl(cookie, cookie.origin), name: cookie.name, value: cookie.value,
        path: cookie.path || '/', secure: cookie.secure === true, httpOnly: cookie.httpOnly === true,
        sameSite: cookie.sameSite || 'unspecified'
      }
      if (!cookie.hostOnly && cookie.domain) details.domain = cookie.domain
      if (!cookie.session && cookie.expirationDate) details.expirationDate = cookie.expirationDate
      await this.session.cookies.set(details)
      imported += 1
    }
    for (const origin of selected) await this.sessionContinuity.setForUrl(origin, true, { keepalive: true })
    return imported
  }

  async importProject(input) {
    const source = this.sourceProject(String(input?.projectId || ''))
    const name = this.uniqueName(input?.name || source.name)
    const project = this.projectStore.needsInitialSetup()
      ? this.projectStore.completeInitialSetup({ name, homeUrl: input.includeHomeUrl === false ? '' : source.homeUrl })
      : this.projectStore.create({ name, homeUrl: input.includeHomeUrl === false ? '' : source.homeUrl })

    if (input.includeDocuments !== false) {
      for (const [kind, relativePath] of Object.entries(DOCUMENTS)) {
        const sourcePath = path.join(source.directory, relativePath)
        if (fs.existsSync(sourcePath) && fs.lstatSync(sourcePath).isFile()) {
          this.projectStore.writeDocument(project.id, kind, fs.readFileSync(sourcePath, 'utf8'))
        }
      }
    }
    if (input.includeTabs === true) this.projectStore.updateTabState(project.id, source.tabState || {})

    const selectedArtifacts = new Set((input.artifactIds || []).map((value) => path.basename(String(value))))
    let artifacts = 0
    for (const artifact of listImmediateFiles(path.join(source.directory, 'artifacts'))) {
      if (!selectedArtifacts.has(artifact.id)) continue
      fs.copyFileSync(path.join(source.directory, 'artifacts', artifact.id), path.join(project.directory, 'artifacts', artifact.id))
      artifacts += 1
    }

    let legacyEvidence = 0
    if (this.targetProductId === 'bmw-dev' && input.includeLegacyEvidence === true) {
      const target = path.join(project.directory, 'legacy-evidence', 'test-runs')
      legacyEvidence = copyTreeReadOnly(path.join(source.directory, 'test-runs'), target)
      fs.writeFileSync(path.join(project.directory, 'legacy-evidence.json'), `${JSON.stringify({
        version: 1, sourceProjectId: source.id, importedAt: new Date().toISOString(), readOnly: true, resumable: false
      }, null, 2)}\n`, { mode: 0o400 })
    }

    let sourceFiles = 0
    if (this.targetProductId === 'bmw-dev' && input.includeSource === true) {
      if (!this.webRuntime) throw new Error('BMWDev Web Runtime is unavailable for OPFS import.')
      const snapshot = collectRuntimeFiles(source.directory)
      await this.webRuntime.openWorkspace(project.id)
      await this.webRuntime.importFiles(snapshot)
      sourceFiles = snapshot.files.length
    }
    const cookies = await this.importCookies(input.cookieOrigins || [])
    return { project: this.projectStore.get(project.id), artifacts, legacyEvidence, sourceFiles, cookies }
  }
}

export const productProfileImporterInternals = { collectRuntimeFiles, inside, safeSourceDirectory }
