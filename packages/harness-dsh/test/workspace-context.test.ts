import test from 'node:test'
import assert from 'node:assert/strict'
import {appendWorkspaceContext} from '../dsh/plugins/browser-mcp/workspace-context.js'
test('DSH Studio assembly preserves the prompt, sole tool and existing context while replacing stale selection',()=>{
 const assembly={sections:[{name:'persona',text:'BMW'}],tools:[{name:'browser'}],contexts:[{name:'project',text:'Project notes'},{name:'bmw:video-workspace',text:'old'}]}
 const result=appendWorkspaceContext(assembly,'new selection');assert.equal(result.sections,assembly.sections);assert.equal(result.tools,assembly.tools);assert.deepEqual(result.contexts,[assembly.contexts[0],{name:'bmw:video-workspace',text:'new selection'}]);assert.equal(assembly.contexts[1].text,'old');assert.equal(appendWorkspaceContext(assembly,''),assembly);assert.throws(()=>appendWorkspaceContext(assembly,{}));assert.throws(()=>appendWorkspaceContext(assembly,'x'.repeat(16_385)))
})
