import assert from 'node:assert/strict'
import test from 'node:test'
import {BackgroundAdmission} from '../src/background-admission.js'
import type {BackgroundResourceState} from '../src/background-admission.js'
const idle:BackgroundResourceState={projectId:'p',activeProjectId:'p',projectChanging:false,browserBusy:false,hostBusy:false,mediaBusy:false,scheduledBusy:false,agentControlGranted:true}
test('Background admission uses real resources, permits an idle Studio and never preempts work or cleanup',()=>{
 const gate=new BackgroundAdmission()
 assert.equal(gate.reason('collection',idle),null)
 for(const [field,reason]of [['projectChanging','project-transition'],['browserBusy','browser-fifo-busy-or-quarantined'],['hostBusy','agent-host-busy-or-cleanup'],['mediaBusy','native-media-busy-or-cleanup'],['scheduledBusy','scheduled-task-active']] as const)assert.equal(gate.reason('hourly',{...idle,[field]:true}),reason)
 assert.equal(gate.reason('hourly',{...idle,agentControlGranted:false}),'agent-control-required')
 assert.equal(gate.reason('hourly',{...idle,projectId:'other'}),'different-project')
})
test('Waiting collection and hourly phases alternate at idle boundaries, expire withdrawn demand and retain foreground priority',()=>{
 let now=0;const gate=new BackgroundAdmission(()=>now)
 assert.equal(gate.reason('collection',idle),null);gate.admitted('collection')
 assert.equal(gate.reason('hourly',{...idle,hostBusy:true}),'agent-host-busy-or-cleanup')
 assert.equal(gate.reason('collection',idle),'fair-turn-hourly')
 assert.equal(gate.reason('hourly',idle),null);gate.admitted('hourly')
 assert.equal(gate.reason('hourly',idle),'fair-turn-collection')
 assert.equal(gate.reason('collection',{...idle,mediaBusy:true}),'native-media-busy-or-cleanup')
 assert.equal(gate.reason('collection',idle),null);gate.admitted('collection')
 now=90_001;assert.equal(gate.reason('collection',idle),null)
 assert.equal(gate.reason('hourly',{...idle,projectId:'other'}),'different-project')
 assert.equal(gate.reason('collection',{...idle,projectId:'next',activeProjectId:'next'}),null)
})
