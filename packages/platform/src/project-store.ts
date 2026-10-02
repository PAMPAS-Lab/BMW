import crypto from 'node:crypto'
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

const MAX_DOCUMENT_BYTES = 256 * 1024

function cleanName(value) {
  const name = String(value ?? '').trim().replace(/\s+/g, ' ')
  if (!name) throw new Error('Project name is required.')
  if (name.length > 80) throw new Error('Project name must be 80 characters or fewer.')
  return name
}

function cleanHomeUrl(value) {
  const input = String(value ?? '').trim()
  if (!input) return ''
  const url = new URL(input)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Project home URL must use HTTP(S).')
  return url.toString()
}

function writeAtomically(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 })
  const temporary = `${filePath}.tmp`
  fs.writeFileSync(temporary, content, { mode: 0o600 })
  fs.renameSync(temporary, filePath)
}

function ensureConnectors(project) {
  let changed = false
  if (!project.connectors || typeof project.connectors !== 'object') {
    project.connectors = {}
    changed = true
  }
  if (!Object.hasOwn(project, 'dshSessionId')) {
    project.dshSessionId = null
    changed = true
  }
  return changed
}

function documentTemplate(kind, projectName) {
  if (kind === 'instructions') return `# ${projectName} — Agent Instructions

## Purpose

Describe the project outcome and boundaries here.

## Working rules

- Browser is the capability boundary.
- Prefer background tabs unless the user needs to watch or take over.
- Never claim evidence that was not observed.
- Ask before irreversible or externally visible actions.
`
  if (kind === 'memory') return `# ${projectName} — Project Memory

Durable, verified facts that should survive across sessions. Keep entries concise and include provenance or a date when useful.
`
  if (kind === 'tasks') return `# ${projectName} — Tasks

## Active

## Completed
`
  const title = kind[0].toUpperCase() + kind.slice(1)
  return `# ${projectName} — ${title}\n\n`
}

export class ProjectStore {
  [key: string]: any

  constructor({ filePath, projectsDirectory, legacyWorkspacePath, onState }) {
    this.filePath = filePath
    this.projectsDirectory = projectsDirectory
    this.legacyWorkspacePath = legacyWorkspacePath
    this.onState = onState
    this.state = { version: 1, activeProjectId: null, projects: [], initialSetupPending: false }
    this.load()
    this.ensureInitialProject()
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'))
      if (parsed?.version === 1 && Array.isArray(parsed.projects)) {
        this.state = { ...parsed, initialSetupPending: parsed.initialSetupPending === true }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') console.error('Failed to load BMW projects', error)
    }
  }

  save() {
    writeAtomically(this.filePath, `${JSON.stringify(this.state, null, 2)}\n`)
    this.onState?.(this.snapshot())
  }

  ensureInitialProject() {
    if (this.state.projects.length) {
      let changed = false
      for (const project of this.state.projects) {
        changed = ensureConnectors(project) || changed
        this.ensureProjectFiles(project)
      }
      if (!this.get(this.state.activeProjectId, { includeArchived: false })) {
        this.state.activeProjectId = this.state.projects.find((project) => !project.archivedAt)?.id || null
        changed = true
      }
      if (changed) this.save()
      return
    }
    const project = this.makeProject({
      name: 'Untitled Project',
      homeUrl: '',
      directory: this.legacyWorkspacePath
    })
    this.state.projects.push(project)
    this.state.activeProjectId = project.id
    this.state.initialSetupPending = true
    this.ensureProjectFiles(project)
    this.save()
  }

  makeProject({ name, homeUrl, directory }) {
    const now = new Date().toISOString()
    return {
      id: crypto.randomUUID(),
      name: cleanName(name),
      directory,
      homeUrl: cleanHomeUrl(homeUrl),
      dshWorkspaceId: null,
      dshSessionId: null,
      connectors: {},
      tabState: { urls: [], activeUrl: null },
      createdAt: now,
      updatedAt: now,
      archivedAt: null
    }
  }

  ensureProjectFiles(project) {
    fs.mkdirSync(project.directory, { recursive: true, mode: 0o700 })
    fs.mkdirSync(path.join(project.directory, 'memory'), { recursive: true, mode: 0o700 })
    fs.mkdirSync(path.join(project.directory, 'artifacts'), { recursive: true, mode: 0o700 })
    for (const [kind, relativePath] of Object.entries(DOCUMENTS)) {
      const filePath = path.join(project.directory, relativePath)
      if (!fs.existsSync(filePath)) writeAtomically(filePath, documentTemplate(kind, project.name))
    }
  }

  snapshot() {
    return {
      activeProjectId: this.state.activeProjectId,
      initialSetupPending: this.state.initialSetupPending === true,
      projects: structuredClone(this.state.projects.filter((project) => !project.archivedAt))
    }
  }

  list({ includeArchived = false } = {}) {
    return this.state.projects.filter((project) => includeArchived || !project.archivedAt)
  }

  get(id, { includeArchived = true } = {}) {
    const project = this.state.projects.find((candidate) => candidate.id === id)
    if (!project || (!includeArchived && project.archivedAt)) return null
    return project
  }

  active() {
    const project = this.get(this.state.activeProjectId, { includeArchived: false })
    if (!project) throw new Error('BMW has no active project.')
    return project
  }

  needsInitialSetup() {
    return this.state.initialSetupPending === true
  }

  completeInitialSetup({ name, homeUrl }) {
    if (!this.needsInitialSetup()) throw new Error('BMW initial project setup is already complete.')
    const project = this.active()
    project.name = cleanName(name)
    project.homeUrl = cleanHomeUrl(homeUrl)
    project.updatedAt = new Date().toISOString()
    for (const [kind, relativePath] of Object.entries(DOCUMENTS)) {
      writeAtomically(path.join(project.directory, relativePath), documentTemplate(kind, project.name))
    }
    this.state.initialSetupPending = false
    this.save()
    return { ...project }
  }

  create({ name, homeUrl }) {
    const normalizedName = cleanName(name)
    if (this.list().some((project) => project.name.toLowerCase() === normalizedName.toLowerCase())) {
      throw new Error(`A project named “${normalizedName}” already exists.`)
    }
    const id = crypto.randomUUID()
    const directory = path.join(this.projectsDirectory, id)
    const project = this.makeProject({ name: normalizedName, homeUrl, directory })
    project.id = id
    this.state.projects.unshift(project)
    this.state.activeProjectId = project.id
    this.ensureProjectFiles(project)
    this.save()
    return { ...project }
  }

  switch(id) {
    const project = this.get(id, { includeArchived: false })
    if (!project) throw new Error(`Unknown or archived project: ${id}`)
    this.state.activeProjectId = project.id
    project.updatedAt = new Date().toISOString()
    this.save()
    return { ...project }
  }

  update(id, { name, homeUrl }) {
    const project = this.get(id, { includeArchived: false })
    if (!project) throw new Error(`Unknown or archived project: ${id}`)
    if (name !== undefined) {
      const normalizedName = cleanName(name)
      if (this.list().some((candidate) => candidate.id !== id && candidate.name.toLowerCase() === normalizedName.toLowerCase())) {
        throw new Error(`A project named “${normalizedName}” already exists.`)
      }
      project.name = normalizedName
    }
    if (homeUrl !== undefined) project.homeUrl = cleanHomeUrl(homeUrl)
    project.updatedAt = new Date().toISOString()
    this.save()
    return { ...project }
  }

  setDshWorkspaceId(id, workspaceId) {
    const project = this.get(id)
    if (!project) throw new Error(`Unknown project: ${id}`)
    if (project.dshWorkspaceId === workspaceId) return
    project.dshWorkspaceId = workspaceId
    project.updatedAt = new Date().toISOString()
    this.save()
  }

  setDshSessionId(id, sessionId) {
    const project = this.get(id)
    if (!project) throw new Error(`Unknown project: ${id}`)
    if (project.dshSessionId === sessionId) return
    project.dshSessionId = sessionId
    project.updatedAt = new Date().toISOString()
    this.save()
  }

  connector(id, name) {
    const project = this.get(id, { includeArchived: false })
    if (!project) throw new Error(`Unknown or archived project: ${id}`)
    ensureConnectors(project)
    return structuredClone(project.connectors[name] || {})
  }

  updateConnector(id, name, value) {
    const project = this.get(id, { includeArchived: false })
    if (!project) throw new Error(`Unknown or archived project: ${id}`)
    ensureConnectors(project)
    project.connectors[name] = { ...(project.connectors[name] || {}), ...value }
    project.updatedAt = new Date().toISOString()
    this.save()
    return this.connector(id, name)
  }

  archive(id) {
    const project = this.get(id, { includeArchived: false })
    if (!project) throw new Error(`Unknown or archived project: ${id}`)
    if (this.list().length === 1) throw new Error('BMW must keep at least one active project.')
    project.archivedAt = new Date().toISOString()
    if (this.state.activeProjectId === id) this.state.activeProjectId = this.list().find((candidate) => candidate.id !== id)?.id || null
    this.save()
    return this.active()
  }

  documentPath(id, kind) {
    const project = this.get(id, { includeArchived: false })
    const relativePath = DOCUMENTS[kind]
    if (!project || !relativePath) throw new Error('Unknown project document.')
    return path.join(project.directory, relativePath)
  }

  readDocument(id, kind) {
    const content = fs.readFileSync(this.documentPath(id, kind), 'utf8')
    return { kind, content, maxBytes: MAX_DOCUMENT_BYTES }
  }

  writeDocument(id, kind, content) {
    if (typeof content !== 'string') throw new Error('Project document content must be text.')
    if (Buffer.byteLength(content, 'utf8') > MAX_DOCUMENT_BYTES) throw new Error('Project document exceeds the 256 KiB limit.')
    const filePath = this.documentPath(id, kind)
    writeAtomically(filePath, content.endsWith('\n') ? content : `${content}\n`)
    const project = this.get(id)
    project.updatedAt = new Date().toISOString()
    this.save()
    return this.readDocument(id, kind)
  }

  appendDocument(id, kind, content) {
    if (!['memory', 'tasks', 'decisions', 'entities', 'preferences', 'history'].includes(kind)) {
      throw new Error('This project document cannot be appended by the Agent.')
    }
    const current = this.readDocument(id, kind).content
    const timestamp = new Date().toISOString()
    return this.writeDocument(id, kind, `${current.trimEnd()}\n\n## ${timestamp}\n\n${String(content).trim()}\n`)
  }

  updateTabState(id, tabState) {
    const project = this.get(id)
    if (!project) return
    project.tabState = {
      urls: [...new Set((tabState.urls || []).filter((url) => /^https?:/i.test(url)))].slice(0, 20),
      activeUrl: /^https?:/i.test(tabState.activeUrl || '') ? tabState.activeUrl : null
    }
    project.updatedAt = new Date().toISOString()
    this.save()
  }
}

export const projectStoreInternals = { cleanHomeUrl, cleanName, DOCUMENTS }
