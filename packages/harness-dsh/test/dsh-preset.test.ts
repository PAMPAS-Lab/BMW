// @ts-nocheck -- BMW TypeScript migration baseline for legacy test doubles.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { installManagedDshPreset, prepareProductDshHome } from '../src/dsh-preset.js'

const sourceDirectory = path.resolve('packages/harness-dsh/dsh/preset/base')

test('installs and safely updates only the BMW DSH preset', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bmw-preset-'))
  context.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const destination = installManagedDshPreset({ sourceDirectory, dshHome: root })
  const composition = fs.readFileSync(path.join(destination, 'agent.cordis.yml'), 'utf8')
  assert.match(composition, /You are BMW, a browser-native and media-native research Agent/)
  assert.match(composition, /\.\/plugins\/browser-mcp\/index.js/)
  assert.match(fs.readFileSync(path.join(destination, 'profile.patch.yml'), 'utf8'), /@deepseek-ai\/dsh-agent-preset/)
  assert.equal(fs.existsSync(path.join(destination, 'plugins', 'browser-mcp', 'index.js')), true)
  assert.match(composition, /@deepseek-ai\/dsh-agent-instructions/)
  assert.match(composition, /MEMORY\.md/)
  assert.match(composition, /BMW_MCP_SERVER/)
  assert.equal(installManagedDshPreset({ sourceDirectory, dshHome: root }), destination)
})

test('does not overwrite a preset directory not owned by BMW', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bmw-preset-'))
  context.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.mkdirSync(path.join(root, '.agent-presets', 'bmw'), { recursive: true })
  assert.throws(() => installManagedDshPreset({ sourceDirectory, dshHome: root }), /Refusing to overwrite/)
})


test('isolates product state and privately seeds credentials without shared writable links', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bmw-dsh-home-'))
  context.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const sourceHome = path.join(root, 'source')
  const productHome = path.join(root, 'product')
  const workspacePath = path.join(root, 'workspace')
  fs.mkdirSync(sourceHome)
  fs.writeFileSync(path.join(sourceHome, '.credentials.yaml'), 'not-read-by-product')
  prepareProductDshHome({ productHome, sourceHome, presetSourceDirectory: sourceDirectory, workspacePath, workspaceTitle: 'Active Research' })
  const credentialLink = path.join(productHome, '.credentials.yaml')
  assert.equal(fs.lstatSync(credentialLink).isSymbolicLink(), false)
  assert.equal(fs.readFileSync(credentialLink,'utf8'), 'not-read-by-product')
  assert.equal(fs.statSync(credentialLink).mode & 0o777,0o600)
  fs.writeFileSync(credentialLink,'private login')
  assert.equal(fs.readFileSync(path.join(sourceHome,'.credentials.yaml'),'utf8'),'not-read-by-product')
  assert.equal(fs.existsSync(path.join(productHome, '.agent-presets', 'bmw', 'agent.cordis.yml')), true)
  assert.match(fs.readFileSync(path.join(productHome, 'settings.yaml'), 'utf8'), /default: bmw/)
  assert.match(fs.readFileSync(path.join(productHome, 'settings.yaml'), 'utf8'), /ui-theme:\n  preference: system/)
  const workspaceStorage = JSON.parse(fs.readFileSync(path.join(productHome, 'storages', 'workspace.json'), 'utf8'))
  const workspaceId = workspaceStorage.global.workspaceIds[0]
  assert.equal(workspaceStorage.tables.workspaces[workspaceId].path, fs.realpathSync(workspacePath))
  assert.equal(workspaceStorage.tables.workspaces[workspaceId].title, 'Active Research')
})

test('keeps BMW as theme source without overwriting unrelated DSH settings', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bmw-dsh-theme-'))
  context.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const productHome = path.join(root, 'product')
  fs.mkdirSync(productHome, { recursive: true })
  fs.writeFileSync(path.join(productHome, 'settings.yaml'), 'custom-setting:\n  enabled: true\nui-theme:\n  preference: light\n')

  prepareProductDshHome({
    productHome,
    sourceHome: path.join(root, 'source'),
    presetSourceDirectory: sourceDirectory,
    workspacePath: path.join(root, 'workspace'),
    workspaceTitle: 'Research'
  })

  const settings = fs.readFileSync(path.join(productHome, 'settings.yaml'), 'utf8')
  assert.match(settings, /custom-setting:\n  enabled: true/)
  assert.match(settings, /ui-theme:\n  preference: system/)
  assert.doesNotMatch(settings, /preference: light/)
})
