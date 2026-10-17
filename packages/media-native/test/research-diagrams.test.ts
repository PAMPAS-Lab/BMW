import assert from 'node:assert/strict'
import test from 'node:test'
import {Ajv} from 'ajv'
import {assertScienceSpec,scienceSpecSchema,defaultScienceSpec,scienceState} from '../src/science-spec.js'
import {measurementFraction} from '../src/research-diagrams.js'
import {assertVisualLayers} from '../src/composition-layers.js'
import {sliceStudioLayer} from '../../feature-video/src/studio-layer-edits.js'
import {scienceEditorFields,readScienceEditorFields} from '../../feature-video/src/renderer/science-layer-editor.js'

test('Event tables remain deterministic across reverse seek and retained-clock cuts; groups and event targets are bounded',()=>{
 const spec=defaultScienceSpec('events');assert.equal(spec.kind,'events');if(spec.kind!=='events')return
 const validate=new Ajv({strict:false}).compile(scienceSpecSchema);assert.equal(validate(spec),true,JSON.stringify(validate.errors));assert.deepEqual(assertScienceSpec(spec),spec)
 const states=[0,3.5,1.5,2.5,0].map(t=>scienceState(spec,t));assert.deepEqual(states[0],states[4]);assert.equal(states[1].kind,'events');if(states[1].kind==='events')assert.equal(states[1].elements.find(e=>e.active)?.text,'TEXT OUT')
 const layer=assertVisualLayers([{id:'events',kind:'diagram',title:'events',startSeconds:0,durationSeconds:6,x:0,y:0,width:1,height:1,color:'#ffffff',science:spec}])[0],cut=sliceStudioLayer(layer,2,6,'cut')
 for(const t of [0,.5,2,3.99])assert.deepEqual(scienceState(cut.science!,t),scienceState(spec,t+2))
 const escaped={...spec,elements:spec.elements.map((e,i)=>i?e:{...e,text:'TEXT | \\ literal'})};assert.deepEqual(readScienceEditorFields(escaped,scienceEditorFields(escaped)),escaped);assert.deepEqual(readScienceEditorFields(spec,scienceEditorFields(spec)),spec);const short={...defaultScienceSpec('curve'),durationSeconds:2};const switched=readScienceEditorFields(short,{...scienceEditorFields(short),kind:'events'});assert.equal(switched.kind,'events');if(switched.kind==='events')assert.ok(switched.events.every(e=>e.atSeconds<=2))
 const code=assertScienceSpec({...spec,elements:[{...spec.elements[0],kind:'code',text:'CODE',codeLines:['inspect(failure)','retest()'],highlightLine:1}],events:[{id:'next-line',atSeconds:2,changes:[{targetId:spec.elements[0].id,highlightLine:2}]}]});assert.equal(code.kind,'events');if(code.kind==='events'){assert.deepEqual(readScienceEditorFields(code,scienceEditorFields(code)),code);assert.equal(scienceState(code,3).kind,'events');assert.equal(code.elements[0].highlightLine,1);assert.throws(()=>assertScienceSpec({...code,events:[{id:'outside',atSeconds:2,changes:[{targetId:code.elements[0].id,highlightLine:3}]}]}));assert.throws(()=>assertScienceSpec({...code,elements:[{...code.elements[0],kind:'chat'}]}))}
 for(const bad of [{...spec,events:[{id:'x',atSeconds:0,changes:[{targetId:'missing',active:true}]}]},{...spec,elements:[...spec.elements,spec.elements[0]]},{...spec,events:[{id:'x',atSeconds:0,changes:[{targetId:'stage-0',code:'run()'}]}]},{...spec,elements:spec.elements.map(e=>({...e,parentId:e.id}))}])assert.throws(()=>assertScienceSpec(bad))
})
test('Measured charts use independent values, sourced series and explicit linear/log axes without normalization or clamping',()=>{
 const spec=defaultScienceSpec('measurement');assert.equal(spec.kind,'measurement');if(spec.kind!=='measurement')return
 assert.equal(new Ajv({strict:false}).compile(scienceSpecSchema)(spec),true);assert.deepEqual(readScienceEditorFields(spec,scienceEditorFields(spec)),spec)
 assert.equal(measurementFraction(10,[1,100],'log'),.5);assert.equal(measurementFraction(25,[0,100],'linear'),.25);assert.throws(()=>measurementFraction(0,[1,100],'log'))
 assert.deepEqual(scienceState(spec,0).kind,'measurement');assert.deepEqual(scienceState(spec,0),{kind:'measurement',progress:0,series:spec.series})
 const scatter=assertScienceSpec({...spec,mode:'scatter',categories:[],xScale:'log',yScale:'log',xDomain:[1,100],yDomain:[1,100],baseline:1,series:[{...spec.series[0],points:[{x:1,y:10},{x:10,y:100}]}]});assert.equal(scatter.kind,'measurement')
 for(const bad of [{...spec,unit:''},{...spec,categories:['重复','重复']},{...spec,series:[spec.series[0],{...spec.series[0],id:'duplicate-color'}]},{...spec,baseline:1},{...spec,yScale:'log'},{...spec,series:[{...spec.series[0],source:''}]},{...spec,series:[{...spec.series[0],points:[{x:0,y:101}]}]},{...scatter,xDomain:[0,100]}])assert.throws(()=>assertScienceSpec(bad))
})
