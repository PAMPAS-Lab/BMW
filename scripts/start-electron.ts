import { spawn } from 'node:child_process'
import electronPath from 'electron'

const productId = 'bmw'
if (process.argv[2] && process.argv[2] !== productId) throw new Error('This repository launches only BMW')

const child = spawn(String(electronPath).trim(), ['.'], {
  stdio: 'inherit',
  env: { ...process.env, BMW_PRODUCT_ID: productId }
})
child.once('error', (error) => {
  console.error('Failed to launch Electron:', error.message)
  process.exitCode = 1
})
child.once('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exitCode = code ?? 1
})
