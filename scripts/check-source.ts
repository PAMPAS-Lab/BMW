import { spawnSync } from 'node:child_process'
import fs from 'node:fs'

const TYPECHECK_MIGRATION_BASELINE = new Set([
  'packages/harness-dsh/test/dsh-preset.test.ts',
  'packages/harness-dsh/test/dsh-runtime.test.ts',
  'packages/platform/test/global-settings-store.test.ts',
  'packages/platform/test/layout-store.test.ts',
  'packages/platform/test/project-store.test.ts',
  'packages/platform/test/session-continuity.test.ts'
])

const result = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', 'apps', 'packages', 'scripts', 'types'], { encoding: 'utf8' })
if (result.status !== 0) {
  process.stderr.write(result.stderr || 'Could not inspect tracked BMW source files.\n')
  process.exit(result.status || 1)
}

const files = [...new Set(result.stdout.split('\n').filter(Boolean))]
const authoredJavaScript = files.filter((file) => /\.(?:js|cjs|mjs)$/.test(file))
if (authoredJavaScript.length) {
  process.stderr.write(`BMW implementation files must be TypeScript:\n${authoredJavaScript.join('\n')}\n`)
  process.exit(1)
}

const typescriptFiles = files.filter((file) => /\.(?:ts|cts|mts)$/.test(file) && fs.existsSync(file))
if (!typescriptFiles.length) {
  process.stderr.write('No tracked BMW TypeScript implementation files were found.\n')
  process.exit(1)
}

const sourceByFile = new Map(typescriptFiles.map((file) => [file, fs.readFileSync(file, 'utf8')]))
const noCheckFiles = typescriptFiles.filter((file) => /^\/\/ @ts-nocheck\b/m.test(sourceByFile.get(file)!))
const malformedNoCheck = noCheckFiles.filter((file) => {
  const source = sourceByFile.get(file)!
  return !source.startsWith('// @ts-nocheck') || (source.match(/^\/\/ @ts-nocheck\b/gm) || []).length !== 1
})
const unexpectedNoCheck = noCheckFiles.filter((file) => !TYPECHECK_MIGRATION_BASELINE.has(file))
const missingBaseline = [...TYPECHECK_MIGRATION_BASELINE].filter((file) => !noCheckFiles.includes(file))
if (unexpectedNoCheck.length || missingBaseline.length || malformedNoCheck.length) {
  if (unexpectedNoCheck.length) process.stderr.write(`Unapproved @ts-nocheck directives:\n${unexpectedNoCheck.join('\n')}\n`)
  if (missingBaseline.length) process.stderr.write(`Update the migration baseline after removing @ts-nocheck:\n${missingBaseline.join('\n')}\n`)
  if (malformedNoCheck.length) process.stderr.write(`Migration-baseline directives must appear exactly once at the start of a file:\n${malformedNoCheck.join('\n')}\n`)
  process.exit(1)
}

console.log(`TypeScript is the authored implementation language (${typescriptFiles.length} tracked files; ${noCheckFiles.length} frozen legacy test-double exceptions).`)
