import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { WorkbuddyCatalogGate } from '../src/workbuddy-catalog.js'
import type { WorkbuddyCatalogOptions } from '../src/workbuddy-catalog.js'

test('WorkBuddy effective catalog gate rejects extra tools, wrong identity/schema/model and zero-tool evidence', async t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bmw-workbuddy-gate-')))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.mkdirSync(path.join(root, 'bin')); fs.mkdirSync(path.join(root, 'dist')); fs.mkdirSync(path.join(root, 'project'))
  fs.copyFileSync(path.join(import.meta.dirname, 'workbuddy-fixture.js'), path.join(root, 'bin', 'codebuddy'))
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: '@tencent-ai/codebuddy-code', version: '2.169.0', type: 'module' }))
  fs.writeFileSync(path.join(root, 'dist', 'codebuddy-headless.js'), '')
  for (const name of ['product.json', 'product.internal.json']) fs.writeFileSync(path.join(root, name), '{}')
  const browser = { name: 'browser' as const, description: 'catalog fixture', inputSchema: { type: 'object', additionalProperties: false, properties: { action: { type: 'string' } } } }
  const server = http.createServer((request, response) => {
    assert.equal(request.headers.authorization, 'Bearer fixture-token')
    response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(browser))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())))
  const address = server.address(); assert(address && typeof address !== 'string')
  const input: WorkbuddyCatalogOptions = { node: process.execPath, cli: path.join(root, 'bin', 'codebuddy'), workspace: path.join(root, 'project'), model: 'good', internetEnvironment: 'internal', browser, mcp: { node: process.execPath, serverPath: path.join(import.meta.dirname, 'workbuddy-fixture.js'), bridgeUrl: 'http://127.0.0.1:' + address.port, bridgeToken: 'fixture-token' }, signal: new AbortController().signal, watchedFiles: [] }
  const gate = new WorkbuddyCatalogGate()
  for (const model of ['good', 'auxiliary']) { const proof = await gate.verify({ ...input, model }); proof.assertCurrent() }
  for (const model of ['extra', 'foreign', 'schema', 'wrong-model', 'endpoint', 'empty']) await assert.rejects(gate.verify({ ...input, model, timeoutMs: 2000 }))
  const proof = await gate.verify(input)
  fs.writeFileSync(path.join(root, 'product.json'), '{"changed":true}')
  assert.throws(() => proof.assertCurrent(), /configuration changed/)
  fs.mkdirSync(path.join(root, 'project', '.codebuddy')); fs.writeFileSync(path.join(root, 'project', '.codebuddy', 'models.json'), '{}')
  await assert.rejects(gate.verify(input), /覆盖模型/)
  fs.rmSync(path.join(root, 'project', '.codebuddy'), { recursive: true })
  const controller = new AbortController(); controller.abort()
  await assert.rejects(gate.verify({ ...input, signal: controller.signal }))
})
