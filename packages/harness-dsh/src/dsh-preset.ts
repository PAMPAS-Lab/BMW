import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const MANAGED_MARKER = '.bmw-managed'
const PRESET_FILES = ['agent.cordis.yml', 'preset.yml']
const PRESET_DIRECTORIES = ['plugins']
const MANAGED_THEME_SETTINGS = `ui-theme:
  preference: system
`

function productSettings(presetId) {
  return `ui-onboarding:\n  welcomeNoticeVersion: 2026-08-22.1\nagent-presets:\n  default: ${presetId}\n`
}

function writeAtomically(destination, content) {
  const temporary = `${destination}.tmp`
  fs.writeFileSync(temporary, content, { mode: 0o600 })
  fs.renameSync(temporary, destination)
}

export function resolveDshHome(env = process.env) {
  return env.DSH_HOME ? path.resolve(env.DSH_HOME) : path.join(os.homedir(), '.dsh')
}

export function installManagedDshPreset({ sourceDirectory, dshHome = resolveDshHome(), presetId = 'bmw' }) {
  const destination = path.join(dshHome, '.agent-presets', presetId)
  const marker = path.join(destination, MANAGED_MARKER)
  if (fs.existsSync(destination) && !fs.existsSync(marker)) {
    throw new Error(`Refusing to overwrite unmanaged DSH preset: ${destination}`)
  }

  fs.mkdirSync(destination, { recursive: true, mode: 0o700 })
  for (const file of PRESET_FILES) {
    writeAtomically(path.join(destination, file), fs.readFileSync(path.join(sourceDirectory, file), 'utf8'))
  }
  for (const directory of PRESET_DIRECTORIES) {
    const source = path.join(sourceDirectory, directory)
    if (!fs.existsSync(source)) continue
    fs.cpSync(source, path.join(destination, directory), {
      recursive: true,
      force: true,
      mode: fs.constants.COPYFILE_FICLONE
    })
  }
  const adapterDirectory = path.resolve(import.meta.dirname, '../dsh/plugins/browser-mcp')
  fs.cpSync(adapterDirectory, path.join(destination, 'plugins', 'browser-mcp'), { recursive: true, force: true })
  writeAtomically(marker, 'Managed by BMW. Safe to replace on product updates.\n')
  const plugins = fs.readFileSync(path.join(destination, 'agent.cordis.yml'), 'utf8')
    .replace(/(name:\s*)['"]?(\.\/plugins\/[^'"\s]+)['"]?/g,
      (_, prefix, relative) => `${prefix}${JSON.stringify(path.resolve(destination, relative))}`)
  writeAtomically(path.join(destination, 'profile.patch.yml'),
    `- insert:\n    - id: bmw-managed-preset\n      name: '@deepseek-ai/dsh-agent-preset'\n      config:\n        id: ${JSON.stringify(presetId)}\n        name: ${JSON.stringify(presetId)}\n        plugins:\n${plugins.split('\n').map((line) => `          ${line}`).join('\n')}\n`)
  return destination
}

function ensureProductWorkspace(productHome, workspacePath, workspaceTitle) {
  fs.mkdirSync(workspacePath, { recursive: true, mode: 0o700 })
  const storageDirectory = path.join(productHome, 'storages')
  const storagePath = path.join(storageDirectory, 'workspace.json')
  let existing
  try {
    existing = JSON.parse(fs.readFileSync(storagePath, 'utf8'))
  } catch {}
  if (existing?.global?.workspaceIds?.length > 0) return

  const workspaceId = randomUUID()
  const now = new Date().toISOString()
  fs.mkdirSync(storageDirectory, { recursive: true, mode: 0o700 })
  writeAtomically(storagePath, `${JSON.stringify({
    unit: { name: 'workspace', version: 2 },
    global: { initialized: true, workspaceIds: [workspaceId], archivedSessionIds: [] },
    tables: {
      workspaces: {
        [workspaceId]: {
          path: fs.realpathSync(workspacePath),
          title: workspaceTitle,
          sessionIds: [],
          createdAt: now,
          updatedAt: now
        }
      }
    }
  }, null, 2)}\n`)
}

function ensureProductSettings(productHome, presetId) {
  const settingsPath = path.join(productHome, 'settings.yaml')
  let content = fs.existsSync(settingsPath) ? fs.readFileSync(settingsPath, 'utf8') : productSettings(presetId)
  const presetBlock = /^agent-presets:[^\n]*(?:\n[ \t]+[^\n]*)*\n?/m
  const managedPresetSettings = `agent-presets:\n  default: ${presetId}\n`
  content = presetBlock.test(content)
    ? content.replace(presetBlock, managedPresetSettings)
    : `${content.trimEnd()}\n${managedPresetSettings}`
  const themeBlock = /^ui-theme:[^\n]*(?:\n[ \t]+[^\n]*)*\n?/m
  content = themeBlock.test(content)
    ? content.replace(themeBlock, MANAGED_THEME_SETTINGS)
    : `${content.trimEnd()}\n${MANAGED_THEME_SETTINGS}`
  writeAtomically(settingsPath, content)
}

export function prepareProductDshHome({ productHome, sourceHome = resolveDshHome(), presetId = 'bmw', presetSourceDirectory, workspacePath, workspaceTitle = 'BMW Project' }) {
  fs.mkdirSync(productHome, { recursive: true, mode: 0o700 })
  const sourceCredentials = path.join(sourceHome, '.credentials.yaml')
  const productCredentials = path.join(productHome, '.credentials.yaml')
  const existing=fs.lstatSync(productCredentials,{throwIfNoEntry:false})
  if(existing?.isSymbolicLink())throw new Error('Migrate the linked DSH credentials before using this Profile')
  if(!existing&&fs.existsSync(sourceCredentials)){
    const stat=fs.statSync(sourceCredentials)
    if(!stat.isFile()||stat.size>1024*1024)throw new Error('DSH credential provider file exceeds its copy budget')
    writeAtomically(productCredentials,fs.readFileSync(sourceCredentials));fs.chmodSync(productCredentials,0o600)
  }
  ensureProductSettings(productHome, presetId)
  installManagedDshPreset({ sourceDirectory: presetSourceDirectory, dshHome: productHome, presetId })
  ensureProductWorkspace(productHome, workspacePath, workspaceTitle)
  return productHome
}
