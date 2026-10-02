import path from 'node:path'
import { spawn } from 'node:child_process'
import electronPath from 'electron'

const script = path.resolve(process.argv[2] || '')
const scriptsDirectory = path.resolve(import.meta.dirname)
if (!script.startsWith(`${scriptsDirectory}${path.sep}`) || path.extname(script) !== '.js') {
  console.error('Electron test entry must be a compiled JavaScript file below scripts/.')
  process.exit(1)
}

const child = spawn(String(electronPath).trim(), [script], { stdio: 'inherit' })
child.once('error', (error) => {
  console.error('Failed to launch Electron test:', error.message)
  process.exitCode = 1
})
child.once('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exitCode = code ?? 1
})
