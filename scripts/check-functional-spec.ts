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

async function browserActions(): Promise<Array<{ group: string; actions: string[] }>> {
  const [{bmwProduct},{BrowserCapabilityRegistry}]=await Promise.all([
    import('../packages/product-bmw/index.js'),import('../packages/browser-capability/src/browser-capability-registry.js')
  ])
  const registry=new BrowserCapabilityRegistry(bmwProduct),groups=new Map<string,string[]>()
  if(registry.toolDefinition().name!=='browser')throw new Error('BMW must publish exactly browser.')
  for(const action of registry.allowedActions){
    const owner=registry.ownerOf(action)
    if(!owner)throw new Error('Browser Action has no owner: '+action)
    const group=owner==='browser-capability'?'BMW 核心 Browser Actions':owner+' Feature Browser Actions'
    groups.set(group,[...(groups.get(group)??[]),action])
  }
  return [...groups].map(([group,actions])=>({group,actions}))
}

async function renderInventory(): Promise<string> {
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
  for (const catalog of await browserActions()) {
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
const expected = replaceInventory(document, await renderInventory())

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
