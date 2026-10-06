import assert from 'node:assert/strict'
import test from 'node:test'
import {parseAgentDriverSettings,parseAssistantCommand} from '../index.js'
test('Settings commands are closed and snapshots reject credential-bearing form defaults',()=>{
  assert.deepEqual(parseAssistantCommand({action:'settings.run',driverId:'dsh',request:{action:'ensure'}}),{action:'settings.run',driverId:'dsh',request:{action:'ensure'}})
  assert.throws(()=>parseAssistantCommand({action:'settings.run',driverId:'dsh',request:{action:'ensure',force:true}}),/Unknown/)
  const request={action:'settings.run',driverId:'dsh',request:{action:'auth.login',methodId:'key',values:{apiKey:'one-shot-secret'}}}
  assert.deepEqual(parseAssistantCommand(request),{...request,request:{...request.request,values:Object.assign(Object.create(null),request.request.values)}})
  assert.throws(()=>parseAssistantCommand({...request,request:{...request.request,providerRpc:'execute'}}),/Unknown/)
  assert.throws(()=>parseAssistantCommand({...request,request:{...request.request,values:{apiKey:42}}}),/Invalid/)
  const state={authentication:{state:'required',label:'Login'},models:[],selectedModel:null,loginMethods:[{id:'key',label:'API Key',fields:[{id:'apiKey',label:'API Key',secret:true,required:true,value:'never-display'}]}],canLogout:false}
  assert.throws(()=>parseAgentDriverSettings(state),/secret-bearing/)
  assert.throws(()=>parseAgentDriverSettings({...state,loginMethods:[],token:'secret'}),/Unknown/)
})
