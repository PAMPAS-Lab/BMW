import assert from 'node:assert/strict'
import test from 'node:test'
import {resolveDshProjectContext,selectedDshSession} from '../src/dsh-context.js'
import {parseAgentContextState} from '@bmw-agent/agent-contract'
const projects=[{id:'a',name:'A',directory:'/a',workspaceId:'wa'},{id:'b',name:'B',directory:'/b',workspaceId:'wb'}]
const workspaces={items:[{workspaceId:'wa',title:'A',path:'/a',sessionIds:['sa','sa2','archived']},{workspaceId:'wb',title:'B',path:'/b',sessionIds:['sb']}],archivedSessionIds:['archived']}
const sessions={items:[{sessionId:'sa',cwd:'/a',agentPreset:'bmw',projections:{values:{title:'First conversation'}}},{sessionId:'sa2',cwd:'/a',blank:true},{sessionId:'sb',cwd:'/b',agentPreset:'bmw'},{sessionId:'archived',cwd:'/a'}]}
const resolve=(id:string)=>resolveDshProjectContext(id,workspaces,sessions,projects,'bmw')
test('DSH selection maps Workspace membership and directory to one BMW Project while sharing its tabs across sessions',()=>{
 assert.equal(selectedDshSession('{"sessionId":"sa"}'),'sa');assert.equal(selectedDshSession('{}'),null)
 assert.throws(()=>selectedDshSession('{"sessionId":42}'),/Session ID/)
 const first=resolve('sa'),second=resolve('sa2')
 assert.equal(first.projectId,second.projectId);assert.equal(first.sessionCount,2);assert.equal(first.sessionTitle,'First conversation')
 assert.throws(()=>parseAgentContextState({state:'ready'}),/no binding/);assert.throws(()=>parseAgentContextState({state:'ready',context:{...first,sessionCount:-1}}),/session count/);assert.deepEqual(parseAgentContextState({state:'ready',context:first}),{state:'ready',context:first})
 assert.equal(resolve('sb').projectId,'b');assert.throws(()=>resolve('archived'),/archived/)
 assert.throws(()=>resolveDshProjectContext('sa',workspaces,{items:[{sessionId:'sa',cwd:'/b'}]},projects,'bmw'),/does not match/)
 assert.throws(()=>resolveDshProjectContext('sa',workspaces,{items:[{sessionId:'sa',cwd:'/a',agentPreset:'other'}]},projects,'bmw'),/preset/)
 assert.throws(()=>resolveDshProjectContext('sa',workspaces,sessions,[{...projects[0],directory:'/foreign'}],'bmw'),/not linked/)
 assert.throws(()=>resolveDshProjectContext('sa',workspaces,sessions,[projects[0],{...projects[0],id:'duplicate'}],'bmw'),/not linked/)
})
