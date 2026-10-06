import assert from 'node:assert/strict'
import test from 'node:test'
import {parseAgentContextState} from '../index.js'
const context={projectId:'project',projectName:'Project',directory:'/fixture',sessionId:'session',sessionTitle:'Conversation',sessionCount:2}
test('BMW context validates Project and Session identity without native Workspace fields',()=>{
 assert.deepEqual(parseAgentContextState({state:'ready',context}),{state:'ready',context})
 assert.throws(()=>parseAgentContextState({state:'ready'}),/no binding/)
 assert.throws(()=>parseAgentContextState({state:'ready',context:{...context,sessionCount:-1}}),/session count/)
 assert.throws(()=>parseAgentContextState({state:'ready',context:{...context,workspaceId:'provider-workspace'}}),/context fields/)
})
