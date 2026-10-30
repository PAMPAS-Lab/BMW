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
 for(const raw of [{action:'video.studio',studioRequest:{operation:'news-guide'}},{action:'video.studio',studioRequest:{operation:'news-topics'}},{action:'video.studio',studioRequest:{operation:'read'}},{action:'library.collecting',collectionRequest:{operation:'presets'}},{action:'library.materials',libraryRequest:{operation:'search'}},{action:'library.collecting',collectionRequest:{operation:'list'}},{action:'library.recommendations',recommendationRequest:{operation:'policy'}},{action:'library.exports',exportsRequest:{operation:'uses'}}])assert.equal(passiveCollectionUserRead(raw),true)
 for(const raw of [{action:'library.collecting',collectionRequest:{operation:'subscribe-preset'}},{action:'library.materials',libraryRequest:{operation:'copy'}},{action:'library.collecting',collectionRequest:{operation:'start'}},{action:'library.recommendations',recommendationRequest:{operation:'activate'}},{action:'video.studio',studioRequest:{operation:'render'}},{action:'navigate',url:'https://example.org'},null,{action:'library.materials',libraryRequest:null}])assert.equal(passiveCollectionUserRead(raw),false)
})
test('Background discovery publishes only admitted actions and exact operation branches',async()=>{
 const schema={action:'library.collecting',description:'Global operations',inputSchema:{properties:{collectionRequest:{oneOf:['list','read','save-lead','finish','start'].map(operation=>({properties:{operation:{const:operation}}}))}}}}
 const kernel={libraryCollecting:()=>{},capabilityRegistry:{assertRequest:(raw:unknown)=>raw},execute:async(raw:unknown)=>{const request=raw as {action:string;forAction?:string};return request.forAction?structuredClone(schema):{tool:'browser',actions:['help','observe','library.collecting','library.collection-batch','library.streams','video.studio'].map(action=>({action,description:'global'}))}},closeDetached:async()=>{}} as unknown as BrowserKernel
 const scope=new BackgroundCollectionScope(kernel,()=>true)
 const discovery=await scope.executor.execute({action:'help'}) as {actions:{action:string}[]}
 assert.deepEqual(discovery.actions.map(row=>row.action),['help','observe','library.collecting'])
 const detail=await scope.executor.execute({action:'help',forAction:'library.collecting'}) as typeof schema
 assert.deepEqual(detail.inputSchema.properties.collectionRequest.oneOf.map(row=>row.properties.operation.const),['read','save-lead','finish'])
 assert.equal(schema.inputSchema.properties.collectionRequest.oneOf.length,5)
 await assert.rejects(scope.executor.execute({action:'help',forAction:'library.streams'}),/unavailable/)
 await assert.rejects(scope.executor.execute({action:'library.collecting',collectionRequest:{operation:'list'}}),/read\/save-lead\/watch-video\/update-video\/finish/)
 await assert.rejects(scope.executor.execute({action:'library.collection-batch',collectionBatchRequest:{operation:'read'}}),/unavailable/)
 await scope.close()
})

test('Video followups admit bounded preserve previews only, keeping capture, production and unrelated operations unavailable',async()=>{
 let calls=0
 const scope=new BackgroundCollectionScope({libraryCollecting:()=>{},capabilityRegistry:{assertRequest:(raw:unknown)=>raw},execute:async()=>{calls++;return {}},closeDetached:async()=>{}} as unknown as BrowserKernel,()=>true)
 for(const sourceRequest of [{operation:'acquire',method:'capture',preview:{startSeconds:0,endSeconds:4}},{operation:'acquire',method:'preserve'},{operation:'acquire',method:'preserve',preview:{startSeconds:0,endSeconds:31}},{operation:'acquire',method:'preserve',preview:{startSeconds:4,endSeconds:3}}])await assert.rejects(scope.executor.execute({action:'library.sources',sourceRequest}),/3–30/)
 assert.equal(calls,0)
 await scope.executor.execute({action:'page.media.list'})
 for(let i=0;i<10;i++)await scope.executor.execute({action:'library.sources',sourceRequest:{operation:'acquire',method:'preserve',preview:{startSeconds:0,endSeconds:4}}})
 await assert.rejects(scope.executor.execute({action:'library.sources',sourceRequest:{operation:'acquire',method:'preserve',preview:{startSeconds:0,endSeconds:4}}}),/budget/)
 await assert.rejects(scope.executor.execute({action:'library.collecting',collectionRequest:{operation:'propose-video'}}),/allows only/)
 await assert.rejects(scope.executor.execute({action:'video.studio'}),/unavailable/)
 assert.equal(calls,11);await scope.close()
})
