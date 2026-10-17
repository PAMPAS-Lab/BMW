import assert from 'node:assert/strict'
import test from 'node:test'
import {Ajv} from 'ajv'
import {assertScienceSpec,defaultScienceSpec,scienceSpecSchema,scienceState,scienceProgress,scienceNumber} from '../src/science-spec.js'

test('Scientific diagrams are bounded data; schema admits defaults and runtime enforces cross-field relations',()=>{
 const validate=new Ajv({strict:false}).compile(scienceSpecSchema)
 for(const kind of ['curve','ratio','flow','array'] as const){const spec=defaultScienceSpec(kind);assert.equal(validate(spec),true,JSON.stringify(validate.errors));assert.deepEqual(assertScienceSpec(JSON.parse(JSON.stringify(spec))),spec);assert.equal(scienceProgress(spec,0),0);assert.equal(scienceProgress(spec,100),1)}
 const curve=defaultScienceSpec('curve'),ratio=defaultScienceSpec('ratio'),flow=defaultScienceSpec('flow'),array=defaultScienceSpec('array')
 for(const bad of [{...curve,script:'alert(1)'},{...curve,color:'url(secret)'},{...curve,showDot:null},{...curve,durationSeconds:0},{...curve,offsetSeconds:Infinity},{...curve,points:Array.from({length:65},(_,i)=>({x:i/64,y:0}))},{...flow,dots:25},{...flow,path:[{x:0,y:0},{x:1.1,y:1}]},{...array,groups:Array.from({length:9},()=>({label:'x',count:1,color:'#ffffff'}))}]){assert.throws(()=>assertScienceSpec(bad));if(Number.isFinite(bad.offsetSeconds))assert.equal(validate(bad),false)}
 for(const bad of [{...curve,xDomain:[1,0]},{...curve,points:[{x:0,y:0},{x:0,y:1}]},{...curve,points:[{x:0,y:0},{x:1,y:2}]},{...ratio,parts:[{label:'zero',value:0,color:'#ffffff'}]},{...array,groups:[{label:'overflow',count:64,color:'#ffffff'},{label:'extra',count:1,color:'#ffffff'}]},{...flow,path:[{x:0,y:0},{x:0,y:0}]}])assert.throws(()=>assertScienceSpec(bad))
 assert.throws(()=>scienceProgress(curve,NaN));assert.equal(scienceNumber(1e-9),'1.00e-9');assert.equal(scienceNumber(123456),'1.23e+5')
})

test('Curve growth, tip and units retain one physical data state across edits and reverse/source-clock seeks',()=>{
 const spec=assertScienceSpec({...defaultScienceSpec('curve'),points:[{x:0,y:0},{x:5,y:10},{x:10,y:0}],xDomain:[0,10],yDomain:[0,10],durationSeconds:2,xUnit:'s',unit:'m'}),before=JSON.stringify(spec),middle=scienceState(spec,1)
 assert.equal(middle.kind,'curve');if(middle.kind!=='curve')throw new Error();assert.deepEqual(middle.tip,{x:5,y:10});assert.deepEqual(middle.points,[{x:0,y:0},{x:5,y:10}]);assert.deepEqual(scienceState(spec,1.5),{kind:'curve',progress:.75,points:[{x:0,y:0},{x:5,y:10},{x:7.5,y:5}],tip:{x:7.5,y:5}})
 const edited=assertScienceSpec({...spec,points:[{x:0,y:0},{x:5,y:20},{x:10,y:0}],yDomain:[0,20]});const state=scienceState(edited,1);assert.equal(state.kind==='curve'&&state.tip.y,20)
 for(const t of [1.75,.13,2.5,.333333,1.01])assert.deepEqual(scienceState({...spec,offsetSeconds:.13},t-.13),scienceState(spec,t));assert.equal(JSON.stringify(spec),before)
 const tiny=assertScienceSpec({...spec,points:[{x:0,y:0},{x:1e-15,y:1}],xDomain:[0,1e-15],yDomain:[0,1]});const first=scienceState(tiny,0);assert.equal(first.kind==='curve'&&first.tip.x,0)
})

test('Ratio sectors, current values, percentages and totals come from the same dataset and progress',()=>{
 const spec=defaultScienceSpec('ratio'),state=scienceState(spec,1.5)
 assert.equal(state.kind,'ratio');if(state.kind!=='ratio')throw new Error();assert.equal(state.total,100);assert.equal(state.currentTotal,50);assert.deepEqual(state.parts.map(p=>p.value),[22.5,17.5,10]);assert.equal(state.parts.at(-1)!.end,.5);assert.equal(state.parts.reduce((n,p)=>n+p.fraction,0),.5)
 for(const mode of ['bar','pie','ring'] as const){const current=scienceState(assertScienceSpec({...spec,mode}),1.5);assert.deepEqual(current,state)}
 const changed=assertScienceSpec({...spec,parts:[{label:'A',value:20,color:'#ffffff'},{label:'B',value:80,color:'#000000'}]}),next=scienceState(changed,1.5);assert.equal(next.kind==='ratio'&&next.parts[0].fraction,.1)
})

test('Path head, flowing dots and depth readout share a seek-safe clock without hidden simulation history',()=>{
 const spec=assertScienceSpec({...defaultScienceSpec('flow'),mode:'drill',path:[{x:0,y:0},{x:0,y:1},{x:1,y:1}],durationSeconds:2,valueStart:0,valueEnd:12000,unit:'m'}),state=scienceState(spec,1)
 assert.equal(state.kind,'flow');if(state.kind!=='flow')throw new Error();assert.deepEqual(state.tip,{x:0,y:1});assert.equal(state.value,12000);assert.equal(state.dots.length,0)
 const vertical=scienceState(spec,.5),horizontal=scienceState(spec,1.5);assert.equal(vertical.kind==='flow'&&vertical.value,6000);assert.equal(horizontal.kind==='flow'&&horizontal.value,12000);assert.throws(()=>assertScienceSpec({...spec,path:[{x:0,y:0},{x:.5,y:1},{x:1,y:.5}]}),/nondecreasing/)
 const flowing=assertScienceSpec({...spec,mode:'flow'}),current=scienceState(flowing,.75);assert.equal(current.kind,'flow');if(current.kind!=='flow')throw new Error();assert.equal(current.dots.length,12);assert.ok(current.dots.every(p=>p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1))
 for(const t of [1.25,.25,1.99,.5])assert.deepEqual(scienceState({...flowing,offsetSeconds:.25},t-.25),scienceState(flowing,t))
})

test('Thirty-seven array objects retain identity and group totals while geometry interpolates and data changes',()=>{
 const spec=defaultScienceSpec('array'),start=scienceState(spec,0),end=scienceState(spec,3),middle=scienceState(spec,1.5)
 if(start.kind!=='array'||end.kind!=='array'||middle.kind!=='array')throw new Error();assert.equal(end.total,37);assert.equal(end.items.length,37);assert.equal(new Set(end.items.map(i=>i.id)).size,37);assert.deepEqual(end.groups.map(g=>g.count),[12,9,8,8])
 for(let i=0;i<37;i++){const item=end.items[i];assert.ok(item.x-item.width/2>=0&&item.x+item.width/2<=1&&item.y-item.height/2>=0&&item.y+item.height/2<=1);assert.ok(Math.abs(middle.items[i].x-(start.items[i].x+item.x)/2)<1e-12)}
 assert.deepEqual(end.groups.map((_,g)=>end.items.filter(i=>i.group===g).length),[12,9,8,8])
 if(spec.kind!=='array')throw new Error();const changed=assertScienceSpec({...spec,groups:spec.groups.map((g,i)=>({...g,count:i===0?11:i===1?10:g.count}))}),state=scienceState(changed,3);assert.equal(state.kind==='array'&&state.items[11].group,1);assert.equal(state.kind==='array'&&state.total,37)
})
