import { createRequire } from 'node:module'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { workbuddyPinnedCliVersion } from './workbuddy-model-catalog.js'

const require = createRequire(import.meta.url)

/** Absolute path to the pinned official CLI shipped with this harness package. */
export function bundledWorkbuddyCli(): string | null {
  try {
    const manifest = require.resolve('@tencent-ai/codebuddy-code/package.json')
    const file = path.join(path.dirname(manifest), 'bin', 'codebuddy')
    return fs.existsSync(file) ? fs.realpathSync(file) : null
  } catch {
    return null
  }
}

/**
 * Resolve the CLI BMW is allowed to run. An explicit override still has to pass
 * the pinned-version gate in `prepare`; it only exists for host packaging.
 */
export function findWorkbuddyCli(options: { env?: NodeJS.ProcessEnv } = {}): string | null {
  const env = options.env ?? process.env
  const explicit = env.BMW_WORKBUDDY_EXECUTABLE
  if (explicit !== undefined && explicit !== '') {
    if (!path.isAbsolute(explicit)) throw new Error('BMW_WORKBUDDY_EXECUTABLE must be an absolute installed CLI path')
    const actual = fs.realpathSync(explicit)
    if (!fs.statSync(actual).isFile()) throw new Error('BMW_WORKBUDDY_EXECUTABLE is not a file')
    return actual
  }
  return bundledWorkbuddyCli()
}

/**
 * The CLI is a Node script, so the host supplies the runtime. BMW's Electron
 * binary doubles as Node through ELECTRON_RUN_AS_NODE, which keeps the driver
 * working on machines without a system Node install.
 */
export function workbuddyNodeExecutable(explicit?: string): string {
  if (explicit !== undefined) {
    if (!path.isAbsolute(explicit)) throw new Error('WorkBuddy node executable must be absolute')
    return explicit
  }
  return process.execPath
}

export function readWorkbuddyCliVersion(node: string, cli: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      node,
      [cli, '--version'],
      {
        timeout: 20000,
        maxBuffer: 4096,
        env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: path.dirname(cli), ELECTRON_RUN_AS_NODE: '1' },
      },
      (error, stdout) => (error ? reject(error) : resolve(stdout.trim())),
    )
  })
}

/** Refuse any CLI that is not the exact build BMW verified for this ACP surface. */
export async function assertWorkbuddyCliVersion(node: string, cli: string): Promise<void> {
  const version = await readWorkbuddyCliVersion(node, cli)
  if (version !== workbuddyPinnedCliVersion) {
    throw new Error(
      'BMW 只支持 WorkBuddy CLI ' + workbuddyPinnedCliVersion + '（当前为 ' + version + '）。请通过 BMW_WORKBUDDY_EXECUTABLE 指定已固定的官方构建。',
    )
  }
}
