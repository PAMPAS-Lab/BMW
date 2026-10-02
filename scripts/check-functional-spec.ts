import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SPEC_PATH = path.join(ROOT, 'docs', 'FUNCTIONAL_SPEC.md')
const BEGIN = '<!-- BEGIN GENERATED CAPABILITY AND TEST INVENTORY -->'
const END = '<!-- END GENERATED CAPABILITY AND TEST INVENTORY -->'

function walk(directory: string): string[] {
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name)
    return entry.isDirectory() ? walk(target) : [target]
  })
}

function relative(filePath: string): string {
  return path.relative(ROOT, filePath).split(path.sep).join('/')
}

function extractTestNames(source: string): string[] {
  const declarations = source.matchAll(/\btest\s*\(\s*('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`)\s*,/g)
  return [...declarations].map((match) => match[1].slice(1, -1).replace(/\s+/g, ' ').trim())
}

function extractMatches(filePath: string, expression: RegExp): string[] {
  const source = fs.readFileSync(filePath, 'utf8')
  return [...source.matchAll(expression)].map((match) => match[1])
}

function browserActions(): Array<{ group: string; actions: string[] }> {
  const core = extractMatches(
    path.join(ROOT, 'packages/browser-capability/src/browser-schema.ts'),
    /\baction\(\s*'([^']+)'/g
  )
  const groups: Array<{ group: string; actions: string[] }> = [
    { group: 'BMW 核心 Browser Actions', actions: core }
  ]
  const indexes = walk(path.join(ROOT, 'packages'))
    .filter((filePath) => path.basename(filePath) === 'index.ts')
    .sort((left, right) => relative(left).localeCompare(relative(right)))
  for (const indexPath of indexes) {
    const source = fs.readFileSync(indexPath, 'utf8')
    const actions = new Set([...source.matchAll(/\baction:\s*'([^']+)'/g)].map((match) => match[1]))
    for (const block of source.matchAll(/export const [A-Z0-9_]*ACTIONS\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\)/g)) {
      for (const match of block[1].matchAll(/'([^']+)'/g)) actions.add(match[1])
    }
    if (actions.size) groups.push({
      group: `${relative(indexPath)} Feature Browser Actions`,
      actions: [...actions]
    })
  }
  return groups
}

function renderInventory(): string {
  const testFiles = ['apps', 'packages', 'scripts']
    .flatMap((directory) => walk(path.join(ROOT, directory)))
    .filter((filePath) => filePath.endsWith('.test.ts'))
    .sort((left, right) => relative(left).localeCompare(relative(right)))
  if (!testFiles.length) throw new Error('No authored TypeScript test files were found.')

  const lines = [
    BEGIN,
    '',
    '> 本区块由 `npm run docs:features` 生成。请修改上方人工维护的功能条目，再刷新本区块；不要手工编辑本区块。',
    '',
    '### 当前 Browser Action 清单',
    ''
  ]
  for (const catalog of browserActions()) {
    lines.push(`- ${catalog.group}（${catalog.actions.length}）：${catalog.actions.map((action) => `\`${action}\``).join('、') || '无'}`)
  }

  lines.push('', '### 当前自动化测试清单', '')
  for (const filePath of testFiles) {
    const file = relative(filePath)
    const tests = extractTestNames(fs.readFileSync(filePath, 'utf8'))
    lines.push(`#### \`${file}\``, '')
    if (tests.length) {
      for (const name of tests) lines.push(`- \`${name}\``)
    } else {
      lines.push('- 未识别到静态 `test(...)` 名称；该文件仍纳入文件级映射检查。')
    }
    lines.push('')
  }
  lines.push(END)
  return lines.join('\n')
}

function replaceInventory(document: string, inventory: string): string {
  const start = document.indexOf(BEGIN)
  const end = document.indexOf(END)
  if (start < 0 || end < start) throw new Error(`Missing generated inventory markers in ${relative(SPEC_PATH)}.`)
  return `${document.slice(0, start)}${inventory}${document.slice(end + END.length)}`
}

if (!fs.existsSync(SPEC_PATH)) throw new Error(`Missing ${relative(SPEC_PATH)}.`)
const document = fs.readFileSync(SPEC_PATH, 'utf8')
const expected = replaceInventory(document, renderInventory())

if (process.argv.includes('--write')) {
  fs.writeFileSync(SPEC_PATH, expected.endsWith('\n') ? expected : `${expected}\n`)
  console.log(`Updated ${relative(SPEC_PATH)}.`)
} else if (document !== expected) {
  console.error(`${relative(SPEC_PATH)} has a stale Browser Action or test inventory.`)
  console.error('Update its human-authored feature entries, then run: npm run docs:features')
  process.exitCode = 1
} else {
  console.log(`${relative(SPEC_PATH)} capability and test inventory is current.`)
}
