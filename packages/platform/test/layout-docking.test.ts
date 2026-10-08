import assert from 'node:assert/strict'
import test from 'node:test'
import { isOverlayAtDockCorner } from '../src/layout-docking.js'
import {studioFloatingBounds} from '../src/studio-layout.js'

const target = { x: 0, y: 25, width: 1440, height: 875 }

test('floating DSH docks when its upper-right corner reaches the target corner', () => {
  assert.equal(isOverlayAtDockCorner({ x: 800, y: 25, width: 640, height: 760 }, target), true)
  assert.equal(isOverlayAtDockCorner({ x: 775, y: 60, width: 640, height: 760 }, target), true)
})

test('floating DSH does not dock near only one target edge', () => {
  assert.equal(isOverlayAtDockCorner({ x: 800, y: 300, width: 640, height: 760 }, target), false)
  assert.equal(isOverlayAtDockCorner({ x: 500, y: 25, width: 640, height: 760 }, target), false)
})

test('dock detection rejects invalid window bounds', () => {
  assert.equal(isOverlayAtDockCorner({ x: 800, width: 640, height: 760 }, target), false)
  assert.equal(isOverlayAtDockCorner(null, target), false)
})

test('Studio chat docks in the measured property area and free movement remains above the timeline',()=>{
 const region={top:.125,bottom:.75,propertyWidth:.21875}
 assert.deepEqual(studioFloatingBounds(1280,800,{x:1,y:0},region,true).bounds,{x:1000,y:100,width:280,height:500})
 const initial=studioFloatingBounds(1280,800,{x:1,y:0},region).bounds
 assert.equal(initial.width,320);assert.equal(initial.height,320);assert.ok(initial.x+initial.width<=1000,'Floating default must leave properties available')
 for(const width of [1,32,320,800,1440])for(const height of [1,48,200,900])for(const position of [{x:0,y:0},{x:1,y:1},{x:-2,y:8},{x:NaN,y:Infinity}]){
  const {bounds}=studioFloatingBounds(width,height,position,region,false)
  assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.width>=1&&bounds.height>=1)
  assert.ok(bounds.x+bounds.width<=width&&bounds.y+bounds.height<=height)
  const bottom=Math.min(height,Math.max(Math.min(height-1,Math.round(region.top*height))+1,Math.round(region.bottom*height)))
  assert.ok(bounds.y+bounds.height<=bottom,'Chat must not overlap the timeline')
 }
})

test('Studio initial float avoids selected pixels and reserves resources; manual position stays authoritative',()=>{
 const region={top:.1,bottom:.9,propertyWidth:.2,resourceWidth:.2,avoid:{x:.5,y:.1,width:.3,height:.2}}
 const auto=studioFloatingBounds(1400,900,undefined,region)
 const a=region.avoid,b=auto.bounds
 assert.ok(b.x>=280&&b.x+b.width<=1120)
 assert.ok(b.x+b.width<=a.x*1400||b.x>=(a.x+a.width)*1400||b.y+b.height<=a.y*900||b.y>=(a.y+a.height)*900,'Initial float must avoid the actual selection')
 const manual=studioFloatingBounds(1400,900,{x:1,y:0},region)
 assert.deepEqual(manual.position,{x:1,y:0});assert.equal(manual.bounds.y,102,'Selection changes must not move a manually placed chat')
 for(const width of [1,32,320,1400])for(const height of [1,48,200,900]){
  const value=studioFloatingBounds(width,height,undefined,{...region,propertyWidth:1})
  assert.ok(value.bounds.x>=0&&value.bounds.y>=0&&value.bounds.x+value.bounds.width<=width&&value.bounds.y+value.bounds.height<=height)
 }
})

test('Studio free float reserves actual transport while docking still uses the complete property area',()=>{
 const region={top:.125,bottom:.75,floatBottom:.625,propertyWidth:.21875,resourceWidth:.125}
 const free=studioFloatingBounds(1280,800,{x:1,y:1},region).bounds
 assert.equal(free.width,320);assert.equal(free.height,320)
 assert.ok(free.y+free.height<=500,'Float must stay above the playback controls')
 assert.deepEqual(studioFloatingBounds(1280,800,undefined,region,true).bounds,{x:1000,y:100,width:280,height:500})
 for(const width of [1,32,420,1280])for(const height of [1,48,200,800]){
  const {bounds}=studioFloatingBounds(width,height,{x:1,y:1},region)
  assert.ok(bounds.width>=1&&bounds.height>=1&&bounds.x>=0&&bounds.y>=0)
  assert.ok(bounds.x+bounds.width<=width&&bounds.y+bounds.height<=height)
  const top=Math.min(height-1,Math.round(region.top*height))
  assert.ok(bounds.y+bounds.height<=Math.max(top+1,Math.round(region.floatBottom*height)))
 }
})

test('Studio automatic float fits a wide selected object and pins its chosen height across later selection and manual movement',()=>{
 const region={top:111/800,bottom:602/800,floatBottom:550/800,propertyWidth:280/1440,resourceWidth:220/1440,avoid:{x:416.8984375/1440,y:201.8984375/800,width:546.1953125/1440,height:57.6015625/800}}
 const auto=studioFloatingBounds(1440,800,undefined,region),b=auto.bounds,a=region.avoid
 assert.equal(b.width,320);assert.ok(b.height>=240&&b.height<320)
 assert.ok(b.x+b.width<=a.x*1440||b.x>=(a.x+a.width)*1440||b.y+b.height<=a.y*800||b.y>=(a.y+a.height)*800)
 const same=studioFloatingBounds(1440,800,auto.position,region,false,b.height);assert.deepEqual(same.bounds,b,'Repeated geometry must not enlarge the cached automatic float')
 const changed=studioFloatingBounds(1440,800,auto.position,{...region,avoid:{x:.1,y:.1,width:.8,height:.8}},false,b.height);assert.deepEqual(changed.bounds,b,'Open float must not jump when selection changes')
 const moved=studioFloatingBounds(1440,800,{x:0,y:0},region,false,b.height);assert.equal(moved.bounds.height,b.height);assert.deepEqual(moved.position,{x:0,y:0});assert.ok(moved.bounds.y+moved.bounds.height<550)
 const dock=studioFloatingBounds(1440,800,auto.position,region,true,b.height);assert.equal(dock.bounds.height,491,'Docking still uses the whole property area')
})
