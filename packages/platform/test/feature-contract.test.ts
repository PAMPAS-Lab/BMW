import assert from 'node:assert/strict'
import test from 'node:test'
import {activateFeature,assertFeatureRuntime} from '../src/feature-contract.js'
import {defineProduct} from '../src/product-definition.js'
import type {FeatureActivationOptions} from '../src/feature-contract.js'

test('Feature lifecycle admits named hooks and propagates activation failures before wiring',async()=>{
  const runtime={configure(){},stop(){},contextForSession:async()=>({text:'Project data'})}
  const options={projectStore:{active:()=>({id:'p',name:'P',directory:'/isolated/project'})}} as FeatureActivationOptions
  assert.equal(await activateFeature({activate:input=>{assert.equal(input,options);return runtime}},options),runtime)
  assert.throws(()=>assertFeatureRuntime({configure:42}),/configure/)
  assert.throws(()=>assertFeatureRuntime(null),/return a runtime/)
  await assert.rejects(activateFeature({activate:()=>{throw new Error('fixture startup failure')}},options),/fixture startup failure/)
})
test('Product composition freezes one BMW feature set and rejects duplicate identities and extra tools',()=>{
  const product={id:'bmw' as const,name:'BMW' as const,userDataName:'BMW',sessionPartition:'persist:bmw',features:[{id:'video'}]}
  assert.ok(Object.isFrozen(defineProduct(product).features))
  assert.throws(()=>defineProduct({...product,features:[{id:'video'},{id:'video'}]}),/Duplicate/)
  assert.throws(()=>defineProduct({...product,features:JSON.parse('[{"id":"video","main":{"activate":42}}]')}),/main.activate/)
  assert.throws(()=>defineProduct({...product,features:[{id:'video',actionNamespace:''}]}),/nonempty/)
  assert.throws(()=>defineProduct({...product,features:[{id:'video',tools:['shell']} as typeof product.features[number]]}),/only browser/)
})
