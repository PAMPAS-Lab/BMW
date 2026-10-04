import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
const root = path.resolve('.')

test('an open Project Manager is re-raised after browser tab views change', () => {
  const source = fs.readFileSync(path.join(root, 'packages/platform/src/main.ts'), 'utf8')

  assert.match(source, /function raiseProjectPanel\(\)/)
  assert.match(source, /if \(children\.at\(-1\) === shellView\) \{[\s\S]*?return/)
  assert.match(source, /onState: \(state\) => \{[\s\S]*?raiseProjectPanel\(\)[\s\S]*?\}/)
})
