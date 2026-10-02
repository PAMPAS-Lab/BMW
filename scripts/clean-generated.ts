import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const sourceRoots = ['apps', 'packages', 'scripts'].map((directory) => path.join(root, directory))

function generatedPath(filePath: string): string | null {
  if (filePath.endsWith('.d.ts')) return null
  if (filePath.endsWith('.cts')) return `${filePath.slice(0, -4)}.cjs`
  if (filePath.endsWith('.mts')) return `${filePath.slice(0, -4)}.mjs`
  if (filePath.endsWith('.ts')) return `${filePath.slice(0, -3)}.js`
  return null
}

function cleanDirectory(directory: string): number {
  if (!fs.existsSync(directory)) return 0
  let removed = 0
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      removed += cleanDirectory(filePath)
      continue
    }
    const generated = generatedPath(filePath)
    if (!generated || !fs.existsSync(generated)) continue
    fs.rmSync(generated)
    removed += 1
  }
  return removed
}

const removed = sourceRoots.reduce((total, directory) => total + cleanDirectory(directory), 0)
console.log(`Removed ${removed} generated JavaScript files.`)
