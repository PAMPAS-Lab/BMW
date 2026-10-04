import path from 'node:path'
import { spawn } from 'node:child_process'
import electronPath from 'electron'

const script = path.resolve(process.argv[2] || '')
const scriptsDirectory = path.resolve(import.meta.dirname)
if (!script.startsWith(`${scriptsDirectory}${path.sep}`) || path.extname(script) !== '.js') {
  console.error('Electron test entry must be a compiled JavaScript file below scripts/.')
  process.exit(1)
}

// Unsigned macOS test binaries must not touch the user's real Keychain.
// Keep this test-only switch out of start-electron.ts and production startup.
const testArguments = process.platform === 'darwin' ? ['--use-mock-keychain', script] : [script]
const child = spawn(String(electronPath).trim(), testArguments, { stdio: 'inherit' })
child.once('error', (error) => {
  console.error('Failed to launch Electron test:', error.message)
  process.exitCode = 1
})
child.once('exit', (code, signal) => {
  process.exitCode = signal ? (signal === 'SIGINT' ? 130 : 143) : code ?? 1
})

process.once('SIGINT',()=>child.kill('SIGINT'))
process.once('SIGTERM',()=>child.kill('SIGTERM'))
