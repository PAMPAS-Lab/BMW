import test from 'node:test'
import assert from 'node:assert/strict'
import {activateWorkspaces} from '../src/workspace-runtime.js'
import type {FeatureActivationOptions,FeatureHost} from '../src/feature-contract.js'
test('Host activates both independent workspaces, dispatches visibility and context, and awaits all cleanup',async()=>{
 const events:string[]=[],options={projectStore:{active:()=>({id:'p',name:'P',directory:'/isolated/p'})}} as FeatureActivationOptions
 const features=(['library','studio'] as const).map(workspace=>({id:workspace,workspace,panels:[workspace],main:{activate:()=>({configure(){events.push('configure:'+workspace)},setMode:async(mode:string)=>{events.push(workspace+':'+mode)},layout:(_bounds:unknown,visible:boolean)=>{events.push(workspace+':visible:'+visible)},contextForSession:async()=>({text:workspace}),stop:async()=>{await Promise.resolve();events.push('stopped:'+workspace)}})}}))
 const runtime=await activateWorkspaces(features,options);runtime.configure!({setWorkspaceMode:mode=>events.push('host:'+mode)} as unknown as FeatureHost)
 await runtime.setMode!('library');runtime.layout!({x:0,y:0,width:900,height:700},true);assert.ok(events.includes('library:visible:true'));assert.ok(events.includes('studio:visible:false'));assert.equal((await runtime.contextForSession!('s','p')).text,'library')
 await runtime.setMode!('studio');assert.equal((await runtime.contextForSession!('s','p')).text,'studio');await runtime.setMode!('browser');assert.equal((await runtime.contextForSession!('s','p')).text,'')
 await assert.rejects(runtime.openPanel!('unknown'),/Unknown/);await runtime.stop!();assert.ok(events.includes('stopped:library'));assert.ok(events.includes('stopped:studio'))
})
