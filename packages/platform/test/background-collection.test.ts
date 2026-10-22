import assert from 'node:assert/strict'
import test from 'node:test'
import {BackgroundCollectionScope,passiveCollectionUserRead} from '../src/background-collection.js'
import type {BrowserKernel} from '@bmw-agent/browser-capability/kernel'
test('Background action admission bounds originals, refuses side effects and revalidates the lease before work',async()=>{
 let valid=true,live=true,executed=0,closed=0
 const scope=new BackgroundCollectionScope({capabilityRegistry:{assertRequest:(raw:unknown)=>raw},execute:async()=>{executed++;return {}},closeDetached:async()=>{closed++}} as unknown as BrowserKernel,()=>valid,()=>{if(!live)throw new Error('Run stopped')})
 for(const action of ['video.studio','project.memory.append','media.screenshot','schedule.create','click','evaluate'])await assert.rejects(scope.executor.execute({action}),/unavailable/)
 await assert.rejects(scope.executor.execute({action:'navigate',url:'file:///private/tmp/secret'}),/HTTP/)
 await assert.rejects(scope.executor.execute({action:'library.sources',sourceRequest:{operation:'acquire'}}),/list\/read\/collect/)
 for(let i=0;i<20;i++)await scope.executor.execute({action:'library.sources',sourceRequest:{operation:'collect'}})
 await assert.rejects(scope.executor.execute({action:'library.sources',sourceRequest:{operation:'collect'}}),/budget/)
 assert.equal(executed,20);live=false;await assert.rejects(scope.executor.execute({action:'observe'}),/stopped/)
 live=true;valid=false;await assert.rejects(scope.executor.execute({action:'observe'}),/lease/)
 await scope.close();assert.equal(closed,1);assert.equal(scope.valid(),false)
})

test('Passive library refreshes preserve background work; user mutations and work requests preempt it',()=>{
 for(const raw of [{action:'library.collecting',collectionRequest:{operation:'presets'}},{action:'library.materials',libraryRequest:{operation:'search'}},{action:'library.collecting',collectionRequest:{operation:'list'}},{action:'library.recommendations',recommendationRequest:{operation:'policy'}},{action:'library.exports',exportsRequest:{operation:'uses'}}])assert.equal(passiveCollectionUserRead(raw),true)
 for(const raw of [{action:'library.collecting',collectionRequest:{operation:'subscribe-preset'}},{action:'library.materials',libraryRequest:{operation:'copy'}},{action:'library.collecting',collectionRequest:{operation:'start'}},{action:'library.recommendations',recommendationRequest:{operation:'activate'}},{action:'video.studio',studioRequest:{operation:'render'}},{action:'navigate',url:'https://example.org'},null,{action:'library.materials',libraryRequest:null}])assert.equal(passiveCollectionUserRead(raw),false)
})
