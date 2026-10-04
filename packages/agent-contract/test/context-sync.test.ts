import assert from 'node:assert/strict'
import test from 'node:test'
import {AgentSelectionSynchronizer,parseAgentContextState} from '../index.js'
import type {AgentProjectContext} from '../index.js'
const context=(id:string):AgentProjectContext=>({projectId:id==='b'?'p2':'p1',projectName:'Project',directory:'/fixture',workspaceId:'w',workspaceTitle:'Workspace',sessionId:id,sessionTitle:'Conversation',sessionCount:2})
test('Agent selection coordinates Project changes and rejects stale asynchronous navigation',async()=>{
 let selected='a',busy=true,resolveHook:(()=>void)|undefined
 const applied:string[]=[],states:string[]=[]
 const sync=new AgentSelectionSynchronizer({readSelection:async()=>selected,resolve:async id=>{resolveHook?.();return context(id)},blocked:()=>busy,
 apply:async(value,current)=>{if(await current())applied.push(value.sessionId)},restore:async()=>{},publish:value=>states.push(value.state)})
 await sync.tick();assert.deepEqual(applied,[]);assert.equal(states.at(-1),'waiting')
 busy=false;await sync.tick();assert.deepEqual(applied,['a'])
 selected='b';resolveHook=()=>{selected='c'};await sync.tick();assert.deepEqual(applied,['a'])
 resolveHook=()=>sync.invalidate();await sync.tick();assert.deepEqual(applied,['a'])
 resolveHook=undefined;await sync.tick();assert.deepEqual(applied,['a','c'])
 sync.stop();selected='b';await sync.tick();assert.deepEqual(applied,['a','c'])
})
test('Agent selection restores rejected navigation and validates published context',async()=>{
 let restored=false;const applied:string[]=[],states:unknown[]=[]
 const sync=new AgentSelectionSynchronizer({readSelection:async()=>'foreign',resolve:async()=>{throw new Error('Unbound Workspace')},
 blocked:()=>false,apply:async value=>{applied.push(value.sessionId)},restore:async()=>{restored=true},publish:value=>states.push(value)})
 await sync.tick();assert.equal(restored,true);assert.deepEqual(applied,[]);assert.match(JSON.stringify(states),/Unbound Workspace/)
 assert.throws(()=>parseAgentContextState({state:'ready'}),/no binding/)
 assert.throws(()=>parseAgentContextState({state:'ready',context:{...context('a'),sessionCount:-1}}),/session count/)
 assert.deepEqual(parseAgentContextState({state:'ready',context:context('a')}),{state:'ready',context:context('a')})
})
