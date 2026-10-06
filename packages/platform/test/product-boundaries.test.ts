import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import product, {createBmwAgentAssembly} from '../../../apps/bmw/product.js'
import {dshConfiguration} from '../../harness-dsh/index.js'
import { bmwProduct } from '@bmw-agent/product-bmw'
import { BrowserCapabilityRegistry } from '../../browser-capability/src/browser-capability-registry.js'

function sources(directory: string): [string,string][] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name)
    return entry.isDirectory() ? sources(file) : /\.(ts|cts)$/.test(file) ? [[file,fs.readFileSync(file,'utf8')] as [string,string]] : []
  })
}

test('BMW repository builds one app with a native Video foundation', () => {
  assert.deepEqual(fs.readdirSync('apps', { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort(), ['bmw'])
  const lock=JSON.parse(fs.readFileSync('package-lock.json','utf8'))
  for(const [name,entry] of Object.entries(lock.packages)){
    assert.equal((entry as {extraneous?:boolean}).extraneous,undefined,name)
    if(name.startsWith('apps/')||name.startsWith('packages/'))assert.ok(fs.existsSync(path.join(name,'package.json')),name)
  }
  assert.equal(product.name, 'BMW')
  assert.equal(product.id, 'bmw')
  for (const feature of bmwProduct.features) assert.ok(product.features.includes(feature))
})

test('feature action collisions fail before Electron startup', () => {
  assert.throws(() => new BrowserCapabilityRegistry({ id:'collision', name:'Collision', features:[
    { id:'one', browserActions:[{ action:'example.run', description:'First.', inputSchema:{ type: 'object', properties: {}, required: [], additionalProperties: false } }] },
    { id:'two', browserActions:[{ action:'example.run', description:'Second.', inputSchema:{ type: 'object', properties: {}, required: [], additionalProperties: false } }] }
  ] }), /registered by both/)
})

test('shared implementations never import apps; only the app selects an Agent driver', () => {
  for (const directory of ['agent-contract','platform','browser-capability','harness-dsh','media-native','feature-video','product-bmw']) {
    for (const [file,source] of sources(`packages/${directory}`).filter(([file]) => !file.includes('/test/'))) {
      assert.doesNotMatch(source, /(?:import|from)[^\n]*apps\//,file)
      if(directory!=='harness-dsh')assert.doesNotMatch(source, /(?:import|from)[^\n]*(?:harness-dsh|dsh-context|dsh-runtime)/,file)
      if(directory==='platform')assert.doesNotMatch(source,/dsh\.sessions\.current|\.call\('(?:session|workspace)\.|data-shell-overlay/,file)
    }
  }
})

test('BMW catalog retains one browser tool and its expected action boundary', () => {
  const registry = new BrowserCapabilityRegistry(product)
  const inherited = new BrowserCapabilityRegistry(bmwProduct)
  assert.equal(registry.toolDefinition().name,'browser')
  assert.equal(createBmwAgentAssembly().defaultDriverId, 'dsh')
  assert.equal(Object.hasOwn(product, 'dsh'), false)
  assert.match(fs.readFileSync(dshConfiguration.patchPath,'utf8'), /- id: mcp-resources\s+disabled: true/, 'The active product profile must disable upstream resource tools')
  for (const action of inherited.allowedActions) assert.ok(registry.allowedActions.includes(action))
  assert.equal(registry.allowedActions.includes('dev.start'), false)
  assert.equal(Object.hasOwn(registry.inputSchema().properties,'plan'), false)
  for (const definition of registry.actions.values()) { assert.ok(definition.description); assert.ok(definition.inputSchema) }
})
