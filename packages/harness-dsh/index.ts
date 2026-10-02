import path from 'node:path'
import { fileURLToPath } from 'node:url'

export { DshRuntime } from './src/dsh-runtime.js'
export { BMW_DSH_BASELINE, DshHarnessPort } from './src/harness-port.js'
export { installManagedDshClientPlugin, installManagedDshPreset, prepareProductDshHome, resolveDshHome } from './src/dsh-preset.js'

const root = path.dirname(fileURLToPath(import.meta.url))

export const baseDshDefinition = Object.freeze({
  patchPath: path.join(root, 'dsh/base.patch.yml'),
  presetSourcePath: path.join(root, 'dsh/preset/base')
})
