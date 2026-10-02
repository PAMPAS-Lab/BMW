import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_STATE = Object.freeze({
  agentControlGranted: false,
  sites: {}
})

export class PermissionStore {
  [key: string]: any

  constructor(filePath) {
    this.filePath = filePath
    this.state = structuredClone(DEFAULT_STATE)
    this.#load()
  }

  #load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'))
      this.state = {
        agentControlGranted: parsed.agentControlGranted === true,
        sites: parsed.sites && typeof parsed.sites === 'object' ? parsed.sites : {}
      }
    } catch (error) {
      if (error.code !== 'ENOENT') console.error('Failed to load permission store', error)
    }
  }

  #save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
    const temporary = `${this.filePath}.tmp`
    fs.writeFileSync(temporary, JSON.stringify(this.state, null, 2), { mode: 0o600 })
    fs.renameSync(temporary, this.filePath)
  }

  hasAgentControl() {
    return this.state.agentControlGranted
  }

  grantAgentControl() {
    this.state.agentControlGranted = true
    this.#save()
  }

  revokeAgentControl() {
    this.state.agentControlGranted = false
    this.#save()
  }

  getSitePermission(origin, permission) {
    return this.state.sites[origin]?.[permission]
  }

  setSitePermission(origin, permission, allowed) {
    this.state.sites[origin] ??= {}
    this.state.sites[origin][permission] = Boolean(allowed)
    this.#save()
  }

  snapshot() {
    return structuredClone(this.state)
  }
}
