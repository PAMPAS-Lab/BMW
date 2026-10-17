import {traceCanvasText} from '../src/media/canvas-text-trace.js'
import {assertLayerTextTreatment,revealedTextLines,textGraphemes} from '../src/layer-text-treatment.js'
import {assertLayerPackaging,layerPackagingState,packagingPoint} from '../src/layer-packaging.js'
import {suggestRecordingPlan} from '../src/recording-plan.js'
import {Ajv} from 'ajv'
import {assertVisualEffects,visualEffectFilter} from '../src/visual-effects.js'
import {scenePlaybackClock} from '../src/scene-playback-window.js'
import {assertVisualLayers,assertAudioLayers,activeVisualLayers,visualLayerBox,layerFadeGain,assertLayerFadeWindow,assertLayerSourceCrop} from '../src/composition-layers.js'
import {reviewSceneText,assertCompositionText,wrapText,captionBacking,captionLayout} from '../src/media/composition-text.js'
import {withCanvasPaintRole,canvasPaintRole} from '../src/media/canvas-paint-role.js'
import {assertVisualEffectWindow,assertFocusIntervals,focusFraming,visibleFocusIntervals} from '../src/focus-contract.js'
import {assertRecordingEvents,recordingEvents,suggestRecordingFocus} from '../src/recording-contract.js'
import {visualAtTime,fitVisualSegments} from '../src/visual-segments.js'
import {CARD_TEMPLATES,cardSpecSchema,cardSceneConditionalSchemas,assertCardSpec,cardMetricText,cardPaintScene,cardContentContract} from '../src/card-templates.js'
import {assertDetailedReady,verifyCardSources,cardImageAssets} from '../src/card-details.js'
import {readingCrop,speechReadingCrop} from '../src/media/card-details-paint.js'
import {phoneReadingView} from '../src/media/phone-reading.js'
import {assertCardCues,assertCardCueTargets} from '../src/card-cues.js'
import {paintScene} from '../src/media/composition-paint.js'
import crypto from 'node:crypto'
import {captionDocument} from '../src/caption-export.js'
import {exportProjectText} from '../src/text-export.js'
import {mixSourceAudioChunk} from '../src/source-audio.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

test('Finite entry packaging preserves source clocks and bounded perspective under reverse seeks',()=>{
 const pack=assertLayerPackaging({introSeconds:2,flipDegrees:85,directionalBlurPixels:24,directionalBlurDegrees:90,radialBlur:.15,glitchPixels:12,glitchHertz:24})
 const first=layerPackagingState(pack,0),middle=layerPackagingState(pack,1),last=layerPackagingState(pack,2)
 assert.equal(first.strength,1);assert.equal(middle.strength,.5);assert.equal(last.strength,0);assert.equal(last.angle,0);assert.equal(last.glitchShift,0);assert.ok(Math.abs(first.directionX)<1e-8);assert.equal(first.directionY,24)
 for(const t of [1.75,.75,2.5,1.01])assert.deepEqual(layerPackagingState({...pack,offsetSeconds:.75},t-.75),layerPackagingState(pack,t))
 for(const flipAxis of ['x','y'] as const)for(const flipDegrees of [-85,0,85])for(const x of [0,500,1000])for(const y of [0,300,600]){
  const p=packagingPoint(x,y,1000,600,flipAxis,flipDegrees*Math.PI/180);assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.y));if(flipDegrees===0)assert.deepEqual(p,{x,y})
 }
 for(const bad of [{flipAxis:'z'},{flipDegrees:90},{directionalBlurPixels:25},{radialBlur:.16},{glitchHertz:25},{introSeconds:0},{offsetSeconds:NaN},{introSeconds:null},{css:'url(secret)'}])assert.throws(()=>assertLayerPackaging(bad))
 assert.throws(()=>assertLayerTextTreatment({strokeWidth:null}))
 assert.deepEqual(assertLayerSourceCrop({x:.5,y:.2,width:.5,height:.1}),{x:.5,y:.2,width:.5,height:.1})
 for(const crop of [{x:.9,y:0,width:.2,height:1},{x:0,y:0,width:.01,height:1},{x:NaN,y:0,width:1,height:1},{x:0,y:0,width:1,height:1,script:'no'}])assert.throws(()=>assertLayerSourceCrop(crop))
 const layer={id:'pack',title:'Retained clock',kind:'text',text:'文字\nTranslation',color:'#ffffff',x:.1,y:.1,width:.8,height:.4,startSeconds:1,durationSeconds:4,packaging:{introSeconds:2,offsetSeconds:.5,flipDegrees:75},textTreatment:{reveal:'grapheme',delaySeconds:.5,revealSeconds:2,lineStaggerSeconds:.5,offsetSeconds:.5}}
 const plan=compositionQualityPlan(assertComposition({title:'Clock samples',width:360,height:640,fps:12,music:false,scenes:[{title:'Clock',durationSeconds:6,layers:[layer]}]}))
 assert.ok(plan.samples.some(s=>s.reasons.includes('packaging-middle')&&s.localSeconds===1.5));assert.ok(plan.samples.some(s=>s.reasons.includes('text-reveal-clock-middle')&&s.localSeconds===2));assert.ok(!plan.samples.some(s=>s.reasons.includes('packaging-start')));assert.ok(plan.samples.length<=24)
})

test('Text reveal preserves graphemes and full-layout lines under arbitrary seeks and sliced clocks',()=>{
 const parts=textGraphemes('中👩🏽‍🔬e\u0301');assert.deepEqual(parts,['中','👩🏽‍🔬','e\u0301'])
 const style=assertLayerTextTreatment({reveal:'grapheme',delaySeconds:1,revealSeconds:3,lineStaggerSeconds:.5,strokeWidth:4,strokeColor:'#000000'}),lines=['中👩🏽‍🔬','e\u0301']
 assert.deepEqual(revealedTextLines(lines,style,.9),['','']);assert.deepEqual(revealedTextLines(lines,style,2),['中','']);assert.deepEqual(revealedTextLines(lines,style,3),['中👩🏽‍🔬','']);assert.deepEqual(revealedTextLines(lines,style,4.5),lines)
 for(const t of [3.75,1.25,4.5,2.7,2.01])assert.deepEqual(revealedTextLines(lines,{...style,offsetSeconds:1.25},t-1.25),revealedTextLines(lines,style,t))
 assert.deepEqual(revealedTextLines(lines,assertLayerTextTreatment({reveal:'line',delaySeconds:1,lineStaggerSeconds:.5}),1.25),[lines[0],''])
 assert.deepEqual(revealedTextLines(lines,undefined,0),lines)
 for(const bad of [{reveal:'script'},{strokeColor:'url(secret)'},{strokeWidth:9},{offsetSeconds:-1},{revealSeconds:0},{code:'alert(1)'}])assert.throws(()=>assertLayerTextTreatment(bad))
 assert.throws(()=>assertVisualLayers([{id:'a',title:'x',kind:'rectangle',color:'#ffffff',startSeconds:0,durationSeconds:3,x:0,y:0,width:.5,height:.5,textTreatment:{}}]),/text layer/i)
})

test('Phone reading pans the entire pinned source at readable estimated size and stays on the original sentence clock',()=>{
 const source={artifactId:'source.png',sha256:'a'.repeat(64)},base={x:0,y:0,width:1,height:1},area={x:24,y:122,width:357,height:390},reading={mode:'sequence' as const,returnToWhole:false,targets:[{source,rect:{x:.1,y:.2,width:.8,height:.08},name:'原句',lineCount:2}]},cues=[{kind:'reading' as const,index:0,startSeconds:2,endSeconds:8}]
 assert.equal(phoneReadingView(reading,'source.png',base,1000,600,area,1,10,405,cues),null)
 const first=phoneReadingView(reading,'source.png',base,1000,600,area,2,10,405,cues)!,middle=phoneReadingView(reading,'source.png',base,1000,600,area,5,10,405,cues)!,last=phoneReadingView(reading,'source.png',base,1000,600,area,9,10,405,cues)!
 assert.equal(first.crop.x,.1);assert.ok(middle.crop.x>first.crop.x);assert.ok(Math.abs(last.crop.x+last.crop.width-.9)<1e-9);assert.equal(first.crop.y,.2);assert.equal(first.crop.height,.08);assert.ok(first.area.height<150);assert.ok(first.estimatedLinePixels>=17.99);assert.equal(first.pan,true)
 assert.equal(phoneReadingView({...reading,targets:[{...reading.targets[0],lineCount:undefined}]},'source.png',base,1000,600,area,5,10,405,cues),null)
 assert.equal(phoneReadingView({...reading,returnToWhole:true},'source.png',base,1000,600,area,9,10,405,cues),null)
 assert.throws(()=>phoneReadingView(reading,'source.png',{x:0,y:0,width:.2,height:1},1000,600,area,5,10,405,cues),/CROP/)
})

test('Whole-to-detail phone reading locates then zooms a complete target, holds still and returns on the original clock',()=>{
 const recommended=cardContentContract('evidence/reading',2).reading!.recommended
 assert.equal(recommended.mode,'whole-to-detail');assert.equal(recommended.returnToWhole,true);assert.equal(recommended.requiresAuthorLineCount,true);assert.deepEqual(recommended.phases,['context','locate','zoom','detail','return'])
 const base={x:0,y:0,width:1,height:1},rect={x:.2,y:.3,width:.3,height:.05},area={x:24,y:122,width:357,height:390},reading={mode:'whole-to-detail' as const,returnToWhole:true,targets:[{source:{artifactId:'source.png',sha256:'a'.repeat(64)},rect,name:'完整原句',lineCount:1}]},cues=[{kind:'reading' as const,index:0,startSeconds:2,endSeconds:12}]
 const view=(t:number)=>phoneReadingView(reading,'source.png',base,1000,600,area,t,16,405,cues)!
 assert.deepEqual(view(1).crop,base);assert.equal(view(4).phase,'locate');assert.deepEqual(view(4).highlight,rect)
 assert.equal(view(5.7).phase,'zoom');assert.ok(view(5.7).crop.width<1)
 for(let t=0;t<=16;t+=.1){const v=view(t);assert.equal(v.pan,false);assert.ok(v.crop.x<=rect.x+1e-9&&v.crop.y<=rect.y+1e-9);assert.ok(v.crop.x+v.crop.width>=rect.x+rect.width-1e-9&&v.crop.y+v.crop.height>=rect.y+rect.height-1e-9)}
 assert.deepEqual(view(7).crop,view(9).crop);assert.equal(view(7).phase,'detail');assert.ok(view(7).estimatedLinePixels>=18)
 assert.equal(view(11).phase,'return');assert.deepEqual(view(13).crop,base)
 assert.equal(phoneReadingView(reading,'other.png',base,1000,600,area,7,16,405,cues),null)
 assert.equal(phoneReadingView({...reading,targets:[{...reading.targets[0],lineCount:undefined}]},'source.png',base,1000,600,area,7,16,405,cues),null)
 const composition=assertComposition({title:'Actual phases',width:720,height:1280,fps:24,scenes:[{title:'Evidence',durationSeconds:16,imageArtifactId:'source.png',cardSpec:{version:2,templateId:'evidence/reading',reading},cardCues:cues}]})
 const reasons=compositionQualityPlan(composition).samples.flatMap(s=>s.reasons)
 for(const phase of ['reading-locate','reading-zoom','reading-detail','reading-detail-hold','reading-return'])assert.ok(reasons.includes(phase))
})

test('Editable sequence diagrams validate all four sentence targets and reject unbounded or mismatched input',()=>{
 const card=assertCardSpec({version:2,templateId:'diagram/sequence',shape:'funnel',nodes:[{label:'大众'},{label:'免费用户'},{label:'专业用户'},{label:'内部系统'}],footnote:'作者粗略估算',motion:'reveal-items'});assertDetailedReady(card as Parameters<typeof assertDetailedReady>[0])
 assertCardCueTargets(card,[{kind:'diagram',index:3,startSeconds:3,endSeconds:4}],5)
 assert.throws(()=>assertCardCueTargets(card,[{kind:'reading',index:0,startSeconds:0,endSeconds:1}],5),/target/)
 assert.throws(()=>assertCardSpec({...card,nodes:[{label:'only'}]}),/数量/)
 assert.throws(()=>assertCardSpec({...card,nodes:[{label:'a',imageArtifactId:'source.png'},{label:'b'}]}),/额外/)
})
import { assertNarrationReceipt,assertComposition, compositionAssets, compositionDuration, sceneAtTime, estimatedCaptionCues } from '../src/composition-contract.js'
import { assertNarration } from '../src/narration-contract.js'
import { ArtifactJobIO } from '../src/artifact-job-io.js'
import {compositionQualityPlan,paintedTextIssues,StaticHoldObserver,assertCompositionQuality} from '../src/composition-quality.js'
test('quality samples use actual film frames across fractional cuts, focus peaks and capped caption transitions',()=>{
 const composition=assertComposition({width:720,height:1280,fps:24,title:'Review',scenes:[{title:'First',durationSeconds:1.03,bullets:['开始']},{title:'Second',durationSeconds:12,imageArtifactId:'proof.png',focusIntervals:[{startSeconds:2,endSeconds:4,x:.5,y:.5,zoom:2,emphasize:true}],captions:[{startSeconds:5,endSeconds:7,text:'完整原句'}]}]})
 const plan=compositionQualityPlan(composition)
 assert.ok(plan.samples.some(s=>s.sceneIndex===1&&s.reasons.includes('focus-peak')))
 assert.ok(plan.samples.some(s=>s.sceneIndex===1&&s.reasons.includes('caption-start')))
 for(const sample of plan.samples){assert.ok(Math.abs(sample.seconds*24-Math.round(sample.seconds*24))<1e-8);assert.ok(sample.localSeconds>=0);assert.ok(sample.localSeconds<composition.scenes[sample.sceneIndex].durationSeconds);assert.ok(Math.abs(sample.localSeconds-(sample.seconds-(sample.sceneIndex?1.03:0)))<1e-8)}
 const dense=assertComposition({title:'Dense',scenes:[{title:'Dense',durationSeconds:60,captions:Array.from({length:100},(_,i)=>({startSeconds:i*.5,endSeconds:i*.5+.4,text:'字幕 '+i}))}]})
 const bounded=compositionQualityPlan(dense);assert.equal(bounded.samples.length,24);assert.ok(bounded.omittedCandidates>0);assert.ok(bounded.samples[0].reasons.includes('scene-start'));assert.ok(bounded.samples.at(-1)!.reasons.includes('scene-end'))
})
test('phone review catches painted label clipping and collisions while sparse static observations remain qualified',()=>{
 const sample={sceneIndex:0,seconds:0,localSeconds:0,reasons:['scene-start']}
 const issues=paintedTextIssues([{text:'标签',x:-2,y:10,width:50,height:20,fontPixels:10},{text:'字幕',x:0,y:10,width:50,height:20,fontPixels:28}],720,1280,sample)
 assert.ok(issues.some(i=>i.code==='text-outside-frame'&&i.severity==='error'));assert.ok(issues.some(i=>i.code==='phone-small-text'));assert.ok(issues.some(i=>i.code==='painted-text-overlap'))
 const holds=new StaticHoldObserver(),pixels=new Uint8ClampedArray([255,0,0,255]);assert.equal(holds.observe(sample,pixels),undefined);assert.equal(holds.observe({...sample,seconds:7},pixels),undefined);assert.match(holds.observe({...sample,seconds:8},pixels)!.message,/不证明/);assert.equal(holds.observe({...sample,sceneIndex:1,seconds:9},pixels),undefined)
 const report={version:1,kind:'composition-quality',coverage:'critical-state-samples',phoneWidth:390,semanticVerification:'requires-visual-review',samples:[sample],omittedCandidates:0,issues,omittedIssues:0}
 assert.doesNotThrow(()=>assertCompositionQuality(report));assert.throws(()=>assertCompositionQuality({...report,semanticVerification:'passed'}));assert.throws(()=>assertCompositionQuality({...report,phoneWidth:200}));assert.throws(()=>assertCompositionQuality({...report,issues:[{...issues[0],path:'/tmp/secret'}]}))
})
const scene = { title: '介绍', durationSeconds: 10, videoArtifactId: 'page.webm' }
test('anchored reading keeps exact source rectangles and original presentation time with explicit whole/detail returns',()=>{
 const reading={mode:'whole-to-detail' as const,returnToWhole:true,targets:[{source:{artifactId:'proof.png',sha256:'a'.repeat(64)},rect:{x:.1,y:.2,width:.2,height:.1},name:'原句'}]},base={x:0,y:0,width:1,height:1},cues=assertCardCues([{kind:'reading',index:0,startSeconds:2,endSeconds:5}])
 assert.deepEqual(speechReadingCrop(reading,'proof.png',base,1,cues),base);assert.ok(speechReadingCrop(reading,'proof.png',base,3,cues).width<1);assert.deepEqual(speechReadingCrop(reading,'proof.png',base,6,cues),base);assert.deepEqual(speechReadingCrop(reading,'other.png',base,3,cues),base)
 assert.doesNotThrow(()=>assertCardCueTargets({version:2,templateId:'evidence/reading',reading},cues,8));assert.throws(()=>assertCardCueTargets({version:2,templateId:'evidence/reading',reading},[{...cues[0],index:1}],8));assert.throws(()=>assertCardCueTargets({version:1,templateId:'title/basic'},cues,8));assert.throws(()=>assertCardCues([{...cues[0],endSeconds:2}]));assert.throws(()=>assertCardCues([cues[0],cues[0]]))
})
test('Shared caption wrapping avoids automatic single-Han tails without changing explicit breaks or numeric tokens',()=>{
 const measure={font:'',measureText(text:string){return {width:Array.from(text).length}}}
 const text='描述人们对模型能力的认知差距'
 const rows=wrapText(measure,text,text.length-1)
 assert.equal(rows.join(''),text);assert.ok(rows.every(row=>row.length>1&&row.length<=text.length-1))
 assert.deepEqual(wrapText(measure,'甲乙丙\n丁',3),['甲乙丙','丁'])
 assert.deepEqual(wrapText(measure,'ABCDE1',5),['ABCDE','1'])
})
test('Caption backing contrasts with the actual foreground rather than always using black',()=>{
 assert.deepEqual(captionBacking('#152C40'),{box:'#ffffffb3',outline:'#ffffff'})
 assert.deepEqual(captionBacking('#ffffff'),{box:'#000000b3',outline:'#000000'})
})
test('Whole caption blocks reserve padding and keep multilingual rows inside the same safe layout used for preflight',()=>{
 const measure={font:'original',measureText(text:string){const size=Number(this.font.match(/([\d.]+)px/)?.[1]??22);return {width:Array.from(text).length*size*.6,actualBoundingBoxAscent:size*.85,actualBoundingBoxDescent:size*.2}}}
 for(const W of [405,720,1280])for(const position of ['top','center','bottom'] as const)for(const align of ['left','center','right'] as const)for(const offsetPercent of [-50,0,50]){
  const layout=captionLayout(measure,'第一行文字\nSecond line',W,{fontSize:28,color:'#ffffff',background:'box',position,align,offsetPercent})
  assert.equal(layout.overflow,false);assert.equal(layout.lines.length,2);assert.equal(measure.font,'original')
  const box=layout.box!,margin=W<600?24:48
  assert.ok(box.x>=margin-1e-8&&box.x+box.width<=W-margin+1e-8);assert.ok(box.y>=56-1e-8&&box.y+box.height<=686+1e-8)
  for(const row of layout.lines){assert.ok(row.x>=box.x+8-1e-8);assert.ok(row.y>box.y&&row.y<box.y+box.height)}
 }
 assert.equal(captionLayout(measure,'',405,undefined).box,undefined)
})
test('Native paint observations catch backing overlap, late backgrounds and attribution collisions without flagging intentional caption backing',async()=>{
 const context={font:'20px sans-serif',globalAlpha:1,fillRect(){},fillText(){},getTransform:()=>({a:2,b:0,c:0,d:2,e:0,f:0}),measureText:()=>({width:80,actualBoundingBoxLeft:0,actualBoundingBoxRight:80,actualBoundingBoxAscent:18,actualBoundingBoxDescent:2})} as unknown as CanvasRenderingContext2D
 const rect=context.fillRect,fill=context.fillText,sample={sceneIndex:0,seconds:1,localSeconds:1,reasons:['caption-middle']}
 const clean=await traceCanvasText(context,async()=>{withCanvasPaintRole(context,'caption-background',()=>context.fillRect(20,620,100,60));withCanvasPaintRole(context,'caption',()=>{context.fillText('第一行',28,644);context.fillText('第二行',28,672)})})
 assert.equal(clean.backings.length,1);assert.equal(clean.texts[0].role,'caption');assert.equal(clean.backings[0].x,40)
 assert.equal(paintedTextIssues(clean.texts,810,1440,sample,clean.backings).length,0)
 const bad=await traceCanvasText(context,async()=>{withCanvasPaintRole(context,'attribution',()=>context.fillText('原帖署名',28,644));withCanvasPaintRole(context,'caption-background',()=>context.fillRect(20,620,100,36));withCanvasPaintRole(context,'caption',()=>context.fillText('第一行',28,644));withCanvasPaintRole(context,'caption-background',()=>context.fillRect(20,642,100,36))})
 const issues=paintedTextIssues(bad.texts,810,1440,sample,bad.backings)
 assert.ok(issues.some(i=>i.code==='caption-background-overlap'&&i.text==='原帖署名'));assert.ok(issues.some(i=>i.code==='caption-background-overlap'&&i.text==='字幕背景'));assert.ok(issues.some(i=>i.code==='caption-background-overlap'&&i.text==='第一行'))
 const narrowCollision=paintedTextIssues([{text:'重复内容',x:0,y:0,width:100,height:20,fontPixels:24,role:'caption'},{text:'重复内容',x:0,y:19,width:100,height:10,fontPixels:24,role:'watermark'}],390,693,sample)
 assert.ok(narrowCollision.some(i=>i.code==='painted-text-overlap'),'Identical text and a thin collision must not hide subtitle/watermark intersections')
 assert.equal(context.fillText,fill);assert.equal(context.fillRect,rect);assert.equal(canvasPaintRole(context),undefined)
 await assert.rejects(traceCanvasText(context,async()=>withCanvasPaintRole(context,'caption',()=>{throw new Error('broken paint')})),/broken paint/)
 assert.equal(context.fillRect,rect);assert.equal(canvasPaintRole(context),undefined)
})
test('Card wrapping keeps closing brackets with percentage numbers and preserves all text',()=>{
 const measure={font:'',measureText(text:string){return {width:Array.from(text).length}}}
 for(const text of ['abcdefgh(0.00006%)x','abcdefgh（0.00006%）尾']){
  const rows=wrapText(measure,text,16)
  assert.equal(rows.join(''),text);assert.ok(rows.every(row=>row.length<=16&&row.length>0));assert.ok(rows.every(row=>!/[）)]/.test(row[0])));assert.ok(rows.some(row=>/[(（]0\.00006%[）)]/.test(row)))
 }
 assert.deepEqual(wrapText(measure,'(0.00006%)',8),['(0.00006%)'],'An oversized number must stay intact for fitText to shrink or reject, rather than create an empty row')
})
test('Detailed cards keep readable theme colors and separate close numeric threshold labels in both aspect ratios',()=>{
 for(const [width,height]of [[640,360],[360,640]])for(const style of ['clean-light','bmw-dark','minimal']){
  const draws:{text:string;x:number;y:number;color:string;width:number;size:number}[]=[]
  const surface={fillStyle:'',font:'',measureText(text:string){return {width:Array.from(text).length*Number(this.font.match(/([\d.]+)px/)?.[1]??16)*.6}},fillText(text:string,x:number,y:number){draws.push({text,x,y,color:this.fillStyle,width:this.measureText(text).width,size:Number(this.font.match(/([\d.]+)px/)?.[1]??16)})},createLinearGradient(){return {addColorStop(){}}}}
  const context=new Proxy(surface,{get(target,key){return Reflect.get(target,key)??(()=>{})}}) as unknown as CanvasRenderingContext2D
  const specs=[
   {version:2,templateId:'diagram/range',range:{mode:'numeric',axisLabel:'Population',minimum:0,maximum:100,start:0.00006,end:75,thresholds:[.2,20],unit:'%',condition:'Rough estimate'}},
   {version:2,templateId:'evidence/translation',quote:{excerpt:'Original quote',translation:'编辑译文',attribution:'Author / source',display:'simultaneous'}},
   {version:2,templateId:'diagram/to-target',objects:[{label:'A'},{label:'B'}],target:{label:'Goal'},relation:'Under conditions'}
  ]
  for(const cardSpec of specs){
   draws.length=0
   const composition=assertComposition({title:'Theme',width,height,style,music:false,watermark:{enabled:false},scenes:[{title:'Card',durationSeconds:4,captions:[],cardSpec,...(cardSpec.templateId==='evidence/translation'?{imageArtifactId:'source.png'}:{})}]})
   paintScene(context,composition.scenes[0],null,1.5,4,0,1,0,composition)
   const principal=draws.find(draw=>['Population','Original quote','A'].includes(draw.text))!
   assert.equal(principal.color,style==='clean-light'?'#172536':'#ffffff')
   if(cardSpec.templateId==='diagram/range'){
    const a=draws.find(draw=>draw.text==='0.2%')!,b=draws.find(draw=>draw.text==='20%')!
    assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.size*.3<=b.y-b.size||b.y+b.size*.3<=a.y-a.size,'Threshold labels must not intersect')
    assert.ok(Math.max(a.y,b.y)<draws.find(draw=>draw.text==='Rough estimate')!.y-16,'Labels remain above the condition')
   }
  }
 }
})
test('detailed cards pin actual source bytes, reject changed sources, bound geometry and keep dedicated assets in decode budget',async()=>{
 const data=new TextEncoder().encode('actual source bytes'),source={artifactId:'source.png',sha256:crypto.createHash('sha256').update(data).digest('hex')},rect={x:.1,y:.2,width:.4,height:.15}
 const spec=assertCardSpec({version:2,templateId:'evidence/highlight',reading:{mode:'whole-to-detail',targets:[{source,rect,name:'原句'}],returnToWhole:true},highlights:[{source,rects:[rect],name:'三行之一',style:'invert',startSeconds:1,endSeconds:4}]})
 assert.equal(spec.version,2);if(spec.version!==2)return
 assertDetailedReady(spec);await verifyCardSources([spec],()=>data);await assert.rejects(verifyCardSources([spec],()=>new Uint8Array([1])),/STALE/)
 assert.throws(()=>assertCardSpec({...spec,reading:{mode:'whole-to-detail',targets:[{source,rect:{...rect,x:.9},name:'bad'}],returnToWhole:false}}),/源图/)
 assert.throws(()=>assertCardSpec({...spec,highlights:[{source,rects:[rect,rect,rect,rect],name:'bad',style:'invert',startSeconds:0,endSeconds:1}]}),/数量/)
 assert.throws(()=>assertComposition({title:'x',scenes:[{title:'x',durationSeconds:5,imageArtifactId:'other.png',cardSpec:spec}]}),/更换/)
 assert.throws(()=>assertComposition({title:'x',scenes:[{title:'x',durationSeconds:5,imageArtifactId:'source.png',zoom:1.2,cardSpec:spec}]}),/手工/)
 const quote=assertCardSpec({version:2,templateId:'evidence/person-quote',quote:{excerpt:'可核对原句',translation:'Editorial translation',attribution:'明确作者与来源',display:'staged'},person:{artifactId:'portrait.png',name:'测试人物',role:'受控素材',layout:'corner'}})
 assert.equal(quote.version,2);if(quote.version!==2)return
 assertDetailedReady(quote);assert.deepEqual(cardImageAssets(quote),['portrait.png'])
 const composition=assertComposition({title:'x',scenes:[{title:'x',durationSeconds:5,imageArtifactId:'source.png',cardSpec:quote}]});assert.deepEqual(compositionAssets(composition),['source.png','portrait.png'])
 assert.throws(()=>assertDetailedReady(assertCardSpec({version:2,templateId:'evidence/translation',quote:{excerpt:'',translation:'',attribution:'',display:'simultaneous'}}) as Extract<typeof quote,{version:2}>),/INCOMPLETE/)
})
test('reading recipes keep whole/detail dwell and bounded scale; range semantics reject invented proportion and invalid ordering',()=>{
 const source={artifactId:'source.png',sha256:'a'.repeat(64)},base={x:0,y:0,width:1,height:1},reading={mode:'whole-to-detail' as const,targets:[{source,rect:{x:.1,y:.3,width:.25,height:.08},name:'原句'}],returnToWhole:true}
 assert.deepEqual(readingCrop(reading,'source.png',base,0,9),base)
 const detail=readingCrop(reading,'source.png',base,4,9);assert.ok(detail.width>=.25&&detail.height>=.25);assert.deepEqual(readingCrop(reading,'source.png',base,8,9),base)
 assert.deepEqual(readingCrop(reading,'other.png',base,4,9),base)
 const numeric={mode:'numeric',axisLabel:'实测范围',minimum:-10,maximum:20,start:-5,end:5,thresholds:[0,10],unit:'s',condition:'真实测量条件'}
 assertCardSpec({version:2,templateId:'diagram/range',range:numeric})
 for(const patch of [{maximum:-10},{start:10,end:0},{thresholds:[10,0]},{thresholds:[30]},{fakeScale:1}])assert.throws(()=>assertCardSpec({version:2,templateId:'diagram/range',range:{...numeric,...patch}}))
 assertCardSpec({version:2,templateId:'diagram/range',range:{mode:'symbolic',axisLabel:'能力范围',regionLabel:'已实现',thresholdLabels:['目标'],condition:'示意，不代表实测进度'}})
 assert.throws(()=>assertCardSpec({version:2,templateId:'metric/backdrop',value:1.234,decimals:2,unit:'%',phase:'hold',holdSeconds:2}),/小数位/)
})
test('news layout rejects unsupported shapes and misleading coercion and checks its real text budget',()=>{
 const base={title:'栏目标题',cardLayout:'news',scenes:[{title:'三个观点',durationSeconds:6,bullets:['一','二','三'],cardSpec:{version:1,templateId:'points/three'}}]}
 const measure={font:'',measureText(text:string){const size=Number(this.font.match(/(\d+)px/)?.[1]??24);return {width:Array.from(text).length*size}}}
 for(const [width,height]of [[1280,720],[720,1280]]){
  const composition=assertComposition({...base,width,height});assert.equal(composition.cardLayout,'news');assertCompositionText(measure,composition)
  assert.throws(()=>assertCompositionText(measure,{...composition,title:'长\n'.repeat(40)}),'Headline must fit its reserved region')
 }
 for(const patch of [{title:''},{width:720,height:720},{cardLayout:['news']},{cardLayout:{toString:()=> 'news'}},{narrationPacing:['compact']},{narrationPacing:'fast'}])assert.throws(()=>assertComposition({...base,...patch}))
 const legacy=assertComposition({title:'旧版',scenes:[scene]});assert.equal(Object.hasOwn(legacy,'cardLayout'),false);assert.equal(Object.hasOwn(legacy,'narrationPacing'),false)
})
test('eight card categories admit their actual assets and reject unsupported content without dropping it',()=>{
 const inputs=[
  {templateId:'title/basic',bullets:['副标题']},
  {templateId:'points/three',bullets:['一','二','三']},
  {templateId:'comparison/two',bullets:['左','右']},
  {templateId:'metric/hero',value:722,decimals:0,unit:'篇'},
  {templateId:'evidence/screenshot',imageArtifactId:'source.png',bullets:['说明']},
  {templateId:'demo/recording',videoArtifactId:'screen.webm'},
  {templateId:'diagram/image',imageArtifactId:'diagram.png'},
  {templateId:'media/sequence',visualSegments:[{imageArtifactId:'one.png',durationSeconds:2},{videoArtifactId:'two.mp4',durationSeconds:2}]}
 ]
 assert.equal(new Set(CARD_TEMPLATES.map(item=>item.category)).size,8)
 for(const input of inputs){const {templateId,value,decimals,unit,...content}=input;const cardSpec={version:1,templateId,...(value===undefined?{}:{value,decimals,unit})};const result=assertComposition({title:'Cards',scenes:[{title:'测试',durationSeconds:4,...content,cardSpec}]}).scenes[0];assert.deepEqual(result.cardSpec,cardSpec)}
 const make=(templateId:string,content:object={})=>assertComposition({title:'Invalid',scenes:[{title:'x',durationSeconds:4,cardSpec:{version:1,templateId},...content}]})
 assert.throws(()=>make('points/three',{bullets:['一','二']}),/恰好三项/)
 assert.throws(()=>make('comparison/two',{bullets:['一','二','三']}),/恰好两项/)
 assert.throws(()=>make('title/basic',{imageArtifactId:'source.png'}),/确认转换/)
 assert.throws(()=>make('demo/recording',{imageArtifactId:'source.png'}),/录屏视频/)
 assert.throws(()=>make('diagram/image',{videoArtifactId:'clip.mp4'}),/一张图片/)
 assert.throws(()=>make('evidence/screenshot'),/实际画面/)
 assert.throws(()=>make('points/three',{bullets:['一','二','三'],sceneTemplate:{kind:'summary'}}),/不能同时/)
})
test('closed card presets retain exact numeric representation and seek on original scene clocks',()=>{
 const metric=assertCardSpec({version:1,templateId:'metric/hero',value:722,decimals:0,unit:'篇',motion:'count-up'})
 assert.equal(metric.templateId,'metric/hero');if(metric.templateId!=='metric/hero')throw new Error('metric expected')
 assert.equal(cardMetricText(metric,0),'0篇');assert.equal(cardMetricText(metric,.6),'361篇');assert.equal(cardMetricText(metric,1.2),'722篇');assert.equal(cardMetricText(metric,50),'722篇')
 for(const patch of [{value:-1},{value:Infinity},{value:1000000000},{value:1.234,decimals:2},{value:1.2,decimals:0},{unit:'123456789'},{motion:'reveal-items'},{html:'<script>'},{version:2}])assert.throws(()=>assertCardSpec({...metric,...patch}))
 assert.throws(()=>assertCardSpec({version:1,templateId:'title/basic',motion:'count-up'}),/不支持/)
 const first=assertComposition({title:'Reveal',scenes:[{title:'三项',durationSeconds:8,bullets:['一','二','三'],cardSpec:{version:1,templateId:'points/three',motion:'reveal-items'}}]}).scenes[0]
 const continuation={...first,durationSeconds:4,presentationWindow:{originId:'first',startSeconds:4,durationSeconds:8,musicIndex:1,sceneNumber:1,sceneCount:1}}
 assert.deepEqual(cardPaintScene(first).bulletRevealSeconds,[0,1.5,3]);assert.deepEqual(cardPaintScene(continuation).bulletRevealSeconds,[0,1.5,3])
 assert.equal(scenePlaybackClock(continuation,1,2).startSeconds,4)
 assert.equal(first.sceneTemplate,undefined,'Rendering does not persist an alternate authority')
})
test('seekable composition validates Project IDs, bounds and real narration assets', () => {
  const composition = assertComposition({title:'产品介绍',scenes:[scene,{...scene,title:'下一段',durationSeconds:20}]})
  assert.equal(compositionDuration(composition),30); assert.deepEqual(compositionAssets(composition),['page.webm'])
  assert.deepEqual(sceneAtTime(composition,10),{index:1,localSeconds:0,startSeconds:10})
  assert.throws(()=>sceneAtTime(composition,30),/outside/)
  for (const changed of [{videoArtifactId:'../outside.webm'},{videoArtifactId:'https://example.com/a'},{durationSeconds:NaN},{durationSeconds:Infinity},{zoom:2},{playbackRate:0},{crop:{x:.7,y:0,width:.6,height:1}},{narration:'假旁白'},{script:'alert(1)'}]) assert.throws(()=>assertComposition({title:'x',scenes:[{...scene,...changed}]}))
  assert.throws(()=>assertComposition({title:'x',scenes:Array.from({length:13},()=>({...scene,durationSeconds:60}))}),/twelve minutes/)
})
test('narration fixes provider and voices and rejects SSML control or arbitrary endpoints', () => {
  assert.equal(assertNarration({text:'你好，世界。'}).voice,'zh-CN-YunxiNeural')
  for (const input of [{text:''},{text:'x',voice:'unknown'},{text:'x',endpoint:'https://evil.test'},{text:'x',ratePercent:NaN},{text:'x',ratePercent:100},{text:'\u0000'}]) assert.throws(()=>assertNarration(input))
})
test('composition output handle rejects input reads and cleans partial output on cancellation', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'bmw-composition-io-'))
  try {
    const io=await ArtifactJobIO.createOutput(root)
    await assert.rejects(io.read(0,1),/no input/)
    await io.write(0,0,new Uint8Array([0,0,0,20,102,116,121,112,0,0,0,0]))
    await assert.rejects(io.write(1,0,new Uint8Array([1])),/output index/)
    await io.close(); assert.deepEqual(await fs.readdir(root),[])
  } finally {await fs.rm(root,{recursive:true,force:true})}
})

test('Selected source sound trims, retimes, scales mono and stops at its endpoint and scene boundary',()=>{
  const mono=Float32Array.from({length:48000},(_,index)=>index/48000),chunk={sampleRate:48000,numberOfChannels:1,length:mono.length,getChannelData:()=>mono}
  const output=[new Float32Array(3*48000),new Float32Array(3*48000)];mixSourceAudioChunk(output,chunk,0,1,1,.25,2,.5)
  assert.equal(output[0][47999],0);assert.ok(Math.abs(output[0][48000]-.125)<1e-6);assert.ok(Math.abs(output[0][54000]-.25)<1e-6);assert.equal(output[0][66000],0,'No repeated sound after the available .375 seconds');assert.deepEqual(output[0],output[1])
  const bounded=[new Float32Array(48000)];mixSourceAudioChunk(bounded,chunk,0,0,.2,0,1,1);assert.ok(bounded[0][9500]>.19);assert.equal(bounded[0][9600],0,'No bleed into following scene')
  const full=[new Float32Array(3*48000)];mixSourceAudioChunk(full,chunk,0,.37,1.13,.13,.75,.6,t=>Math.min(1,t/.11,(1.13-t)/.17))
  for(const [start,count] of [[0,17000],[17000,40001],[57001,60000],[100001,43999]]){
    const window=[new Float32Array(count)];mixSourceAudioChunk(window,chunk,0,.37,1.13,.13,.75,.6,t=>Math.min(1,t/.11,(1.13-t)/.17),start)
    assert.deepEqual(window[0],full[0].slice(start,start+count),'PCM windows preserve the original source, interpolation and fade clocks.')
  }
})
test('Caption and source audio contracts stay closed and captions estimate within scene-local time',()=>{
  const style={fontSize:28,color:'#ffffff',background:'outline',position:'top',align:'left',offsetPercent:0};const raw={title:'Style',durationSeconds:4,narration:'One sentence. Another sentence.',audioArtifactId:'voice.wav',videoArtifactId:'clip.mp4',captionStyle:style,voiceMuted:true,voiceVolume:.4,keepSourceAudio:true,sourceVolume:.5}
  const composition=assertComposition({title:'x',scenes:[raw]});assert.equal(composition.scenes[0].keepSourceAudio,true);assert.equal(composition.scenes[0].voiceMuted,true);assert.equal(composition.scenes[0].voiceVolume,.4)
  const cues=estimatedCaptionCues(composition.scenes[0],640,360,2);assert.ok(cues.length);assert.equal(cues[0].startSeconds,.5);assert.equal(cues.at(-1)!.endSeconds,2.5)
  for(const changed of [{voiceMuted:'yes'},{voiceMuted:1},{voiceMuted:null},{keepSourceAudio:'yes'},{sourceVolume:3},{captionStyle:{...style,color:'url(https://example.com)'}},{captionStyle:{...style,fontSize:65}},{captionStyle:{...style,fontUrl:'https://example.com'}}])assert.throws(()=>assertComposition({title:'x',scenes:[{...raw,...changed}]}))
})


test('Visual segments admit bounded clips, preserve scene time and expose deterministic fade boundaries',()=>{
 const composition=assertComposition({title:'Segments',scenes:[{title:'Continuous speech',durationSeconds:4,audioArtifactId:'voice.wav',narration:'Speech',visualSegments:[{imageArtifactId:'one.png',durationSeconds:2},{videoArtifactId:'two.mp4',durationSeconds:2,sourceStartSeconds:.5,playbackRate:2,transition:'fade',transitionSeconds:.5,keepSourceAudio:true}]}]})
 const scene=composition.scenes[0];assert.deepEqual(compositionAssets(composition),['one.png','two.mp4','voice.wav']);assert.equal(visualAtTime(scene,1)?.index,0);assert.equal(visualAtTime(scene,2)?.index,1);assert.equal(visualAtTime(scene,2)?.opacity,0);assert.equal(visualAtTime(scene,2.25)?.opacity,.5);assert.equal(visualAtTime(scene,1.75)?.opacity,.5)
 fitVisualSegments(scene.visualSegments!,6);assert.deepEqual(scene.visualSegments!.map(segment=>segment.durationSeconds),[3,3]);assert.equal(scene.audioArtifactId,'voice.wav')
 for(const changed of [{...scene,durationSeconds:7},{...scene,imageArtifactId:'extra.png'},{...scene,visualSegments:Array(9).fill({imageArtifactId:'one.png',durationSeconds:1})},{...scene,visualSegments:[{imageArtifactId:'../outside',durationSeconds:6}]},{...scene,visualSegments:[{imageArtifactId:'one.png',durationSeconds:6,transition:'html'}]}])assert.throws(()=>assertComposition({title:'Invalid',scenes:[changed]}))
})

test('SRT and VTT use global cumulative milliseconds, respect disabled captions and label estimated timing',()=>{
 const scenes=assertComposition({title:'Subtitles',scenes:[{title:'First',durationSeconds:2,captions:[{startSeconds:.5,endSeconds:1.5,text:'你好\n<script>literal</script>'}]},{title:'Second',durationSeconds:3,narration:'Second sentence.',audioArtifactId:'voice.wav'},{title:'Disabled',durationSeconds:1,narration:'No captions',audioArtifactId:'voice.wav',captions:[]}]}).scenes
 const srt=captionDocument(scenes,640,360,'srt');assert.equal(srt.timing,'mixed');assert.match(srt.text,/00:00:00,500 --> 00:00:01,500/);assert.match(srt.text,/00:00:02,500 --> 00:00:03,000/);assert.match(srt.text,/&lt;script&gt;/);assert.doesNotMatch(srt.text,/No captions/)
 const vtt=captionDocument(scenes,640,360,'vtt');assert.ok(vtt.text.startsWith('WEBVTT\n\n'));assert.match(vtt.text,/00:00:02\.500 --> 00:00:03\.000/)
 assert.throws(()=>captionDocument([{...scenes[0],captions:[]}],640,360,'srt'),/No enabled/)
})

test('Bounded Project text export cancels and removes its own output without replacing existing artifacts',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'bmw-text-export-'));try{
  await fs.writeFile(path.join(root,'existing.srt'),'Keep');const controller=new AbortController();let checks=0
  await assert.rejects(exportProjectText(root,'srt','Caption',controller.signal,()=>{if(++checks===2)throw new Error('STUDIO_CONFLICT')}),/STUDIO_CONFLICT/);assert.deepEqual(await fs.readdir(root),['existing.srt'])
  controller.abort(new Error('Cancelled'));await assert.rejects(exportProjectText(root,'vtt','Caption',controller.signal),/Cancelled/)
  const result=await exportProjectText(root,'vtt','WEBVTT\n\n');assert.equal(await fs.readFile(path.join(root,result.artifactId),'utf8'),'WEBVTT\n\n');assert.equal(await fs.readFile(path.join(root,'existing.srt'),'utf8'),'Keep')
 }finally{await fs.rm(root,{recursive:true,force:true})}
})

test('Source focus retimes through trims and segments and keeps framing inside the original crop',()=>{
 const intervals=assertFocusIntervals([{startSeconds:4,endSeconds:8,x:.9,y:.1,zoom:4,emphasize:true}])
 const visual={videoArtifactId:'record.webm',sourceStartSeconds:2,playbackRate:2,focusIntervals:intervals,crop:{x:.2,y:.2,width:.6,height:.6}}
 assert.deepEqual(visibleFocusIntervals(visual,8).map(({start,end})=>({start,end})),[{start:1,end:3}])
 const frame=focusFraming(visual,2);assert.equal(frame.strength,1);assert.equal(frame.crop.width,.15);assert.equal(frame.crop.x,.65);assert.equal(frame.crop.y,.2)
 assert.deepEqual(focusFraming(visual,0).crop,visual.crop);assert.equal(focusFraming(visual,1).strength,0)
 const scene=assertComposition({title:'Focus',scenes:[{title:'x',durationSeconds:8,visualSegments:[{...visual,durationSeconds:8}]}]}).scenes[0]
 assert.deepEqual(scene.visualSegments![0].focusIntervals,intervals)
 for(const invalid of [[{...intervals[0],x:2}],[{...intervals[0],endSeconds:4}],[{...intervals[0],script:'paint()'}],[intervals[0],{...intervals[0],startSeconds:7}],Array(25).fill(intervals[0])])assert.throws(()=>assertFocusIntervals(invalid))
 assert.throws(()=>assertComposition({title:'x',scenes:[{...scene,focusIntervals:intervals}]}),/each visual segment/)
})
test('Recording evidence has a closed clock/coordinate domain, filters pre-roll and groups real and Agent clicks honestly',()=>{
 const event={epochMs:101000,kind:'click' as const,source:'page-event' as const,x:400,y:200,viewportWidth:800,viewportHeight:400,surfaceWidth:800,surfaceHeight:400,dpr:2,scrollX:0,scrollY:900}
 const record=recordingEvents('record.webm',{startedEpochMs:100000,width:1600,height:800},8,{events:[{...event,epochMs:99999},event,{...event,epochMs:101500,source:'agent-action'},{...event,epochMs:107000,x:700}],truncated:false,reason:'requested'},[{sourceEpochMs:101100,outputSeconds:1.1},{sourceEpochMs:101600,outputSeconds:1.6},{sourceEpochMs:107100,outputSeconds:7.1}])
 assert.equal(record.events.length,3);assert.equal(record.events[0].seconds,1.1);assert.equal(record.events[0].pageSeconds,1);assert.equal(record.events[0].timing,'measured-frame');assert.equal(record.events[1].source,'agent-action');assert.equal(record.events[0].dpr,2)
 const focus=suggestRecordingFocus(record);assert.equal(focus.length,2);assert.equal(focus[0].endSeconds,3.6);assert.equal(focus[0].zoom,1.5);assert.equal(focus[0].x,.5)
 assert.throws(()=>assertRecordingEvents(record,'other.webm'),/another video/)
 for(const raw of [{...record,events:[{...record.events[0],inputText:'secret'}]},{...record,events:[{...record.events[0],url:'https://site.test/?token=secret'}]},{...record,events:[{...record.events[0],seconds:9}]},{...record,events:[{...record.events[0],x:900}]},{...record,events:Array(5001).fill(record.events[0])}])assert.throws(()=>assertRecordingEvents(raw))
})

test('Title-card reveal has bounded scene-local times, exact bullet identity and no footage; legacy bullets stay immediate',()=>{
 const base={title:'板书',music:false,scenes:[{title:'推导',durationSeconds:4,bullets:['步骤一','步骤二'],bulletRevealSeconds:[.6,2]}]}
 assert.deepEqual(assertComposition(base).scenes[0].bulletRevealSeconds,[.6,2])
 for(const times of [[0],[-1,2],[0,4],[0,NaN],[0,Infinity]])assert.throws(()=>assertComposition({...base,scenes:[{...base.scenes[0],bulletRevealSeconds:times}]}))
 assert.throws(()=>assertComposition({...base,scenes:[{...base.scenes[0],imageArtifactId:'board.png'}]}),/no footage/)
 const {bulletRevealSeconds,...legacy}=base.scenes[0];assert.equal(assertComposition({...base,scenes:[legacy]}).scenes[0].bulletRevealSeconds,undefined)
})

test('Bilingual SRT and VTT select original, translation or both without changing timing',()=>{
 const composition=assertComposition({title:'字幕',scenes:[{title:'scene',durationSeconds:3,captions:[{startSeconds:0,endSeconds:2,text:'Hello world',translationText:'你好世界'}]}]})
 for(const mode of ['original','translation','bilingual'] as const){composition.scenes[0].captionDisplay=mode;const srt=captionDocument(composition.scenes,1280,720,'srt').text,vtt=captionDocument(composition.scenes,1280,720,'vtt').text;assert.ok(srt.includes('00:00:00,000 --> 00:00:02,000'));assert.equal(srt.includes('Hello world'),mode!=='translation');assert.equal(vtt.includes('你好世界'),mode!=='original')}
 assert.throws(()=>assertComposition({...composition,scenes:[{...composition.scenes[0],captionDisplay:'secret'}]}))
})
test('Fixed templates validate bounded colors/content and reject text overflow before encoding',()=>{
 const measure={font:'',measureText(text:string){const size=Number(/([0-9]+)px/.exec(this.font)?.[1]??24);return {width:text.length*size*.7}}}
 for(const kind of ['summary','comparison','screenshot'] as const){const composition=assertComposition({title:'template',width:540,height:720,scenes:[{title:'固定模板',durationSeconds:8,sceneTemplate:{kind,accentColor:'#22cc88'},bullets:kind==='summary'?['观点一','观点二','观点三']:kind==='comparison'?['方案一','方案二']:['截图说明'],...(kind==='screenshot'?{imageArtifactId:'source.png'}:{})}]});assertCompositionText(measure,composition);assert.equal(reviewSceneText(measure,composition.scenes[0],540,720).filter(i=>i.severity==='error').length,0)}
 for(const sceneTemplate of [{kind:'html',markup:'<b>x</b>'},{kind:'summary',accentColor:'url(x)'},{kind:'comparison',emphasisIndex:99}])assert.throws(()=>assertComposition({title:'bad',scenes:[{title:'s',durationSeconds:8,sceneTemplate}]}))
 const wrong=assertComposition({title:'wrong',scenes:[{title:'s',durationSeconds:8,sceneTemplate:{kind:'summary'},bullets:['only one']}]});assert.throws(()=>assertCompositionText(measure,wrong),/三点总结/)
 const overflowing=assertComposition({title:'overflow',width:360,height:640,scenes:[{title:'s',durationSeconds:8,captions:[{startSeconds:0,endSeconds:.3,text:'字幕'.repeat(90),translationText:'x'.repeat(190)}]}]});assert.throws(()=>assertCompositionText(measure,overflowing),/字幕/)
 const warnings=reviewSceneText(measure,{...wrong.scenes[0],sceneTemplate:undefined,captions:[{startSeconds:0,endSeconds:.1,text:'很密集的字幕内容'}],captionStyle:{fontSize:22,color:'#ffffff',background:'none',position:'center',align:'center',offsetPercent:0}},1280,720);assert.ok(warnings.some(i=>i.code==='caption-density'));assert.ok(warnings.some(i=>i.code==='text-overlap'))
})

const overlay={id:'pip',title:'画中画',kind:'image',artifactId:'picture.png',startSeconds:1,durationSeconds:2,x:.5,y:.2,width:.4,height:.4,color:'#ffffff'}
test('independent layers validate identities, Project references, ranges and video decoder overlap',()=>{
 const composition=assertComposition({title:'Layers',music:false,layers:[{...overlay,id:'global'}],audioTracks:[{id:'music',title:'配乐',artifactId:'music.wav',startSeconds:0,durationSeconds:4}],scenes:[{title:'One',durationSeconds:4,imageArtifactId:'base.png',layers:[overlay]}]})
 assert.deepEqual(compositionAssets(composition),['base.png','picture.png','music.wav'])
 assert.equal(activeVisualLayers(composition,composition.scenes[0],1.5,1.5).length,2)
 assert.equal(activeVisualLayers(composition,composition.scenes[0],.5,.5).length,0)
 assert.throws(()=>assertComposition({...composition,layers:[overlay]}),/Duplicate/)
 assert.throws(()=>assertVisualLayers([{...overlay,artifactId:'../elsewhere.png'}]),/artifactId/)
 assert.throws(()=>assertVisualLayers([{...overlay,script:'anything'}]),/Unsupported/)
 assert.throws(()=>assertVisualLayers([{...overlay,x:.9}]),/inside/)
 assert.throws(()=>assertAudioLayers([{id:'bad',title:'bad',artifactId:'http://example.com/music',startSeconds:0,durationSeconds:2}]),/artifactId/)
 assert.throws(()=>assertComposition({...composition,layers:[{...overlay,id:'range',durationSeconds:4}]}),/超过/)
 assert.throws(()=>assertComposition({title:'Too many decoders',scenes:[{title:'One',durationSeconds:4,layers:Array.from({length:5},(_,index)=>({...overlay,id:'video-'+index,kind:'video',artifactId:'clip.webm'}))}]}),/four simultaneous/)
 assertComposition({title:'Sequential decoders',scenes:[{title:'One',durationSeconds:4,layers:Array.from({length:5},(_,index)=>({...overlay,id:'video-'+index,kind:'video',artifactId:'clip.webm',startSeconds:index*.4,durationSeconds:.4}))}]})
})
test('explicit layer keyframes interpolate geometry and fading without changing base values',()=>{
 const layer=assertVisualLayers([{...overlay,opacity:.8,fadeInSeconds:1,fadeOutSeconds:1,keyframes:[{timeSeconds:0,x:0,y:.2,width:.4,height:.4,opacity:.4,easing:'linear'},{timeSeconds:2,x:.5,y:.2,width:.4,height:.4,opacity:1,easing:'ease-in-out'}]}])[0]
 const box=visualLayerBox(layer,1);assert.equal(box.x,.25);assert.equal(box.opacity,.7);assert.equal(layer.x,.5)
 assert.equal(visualLayerBox(layer,0).opacity,0);assert.ok(visualLayerBox(layer,1.8).opacity<.25)
 assert.throws(()=>assertVisualLayers([{...overlay,keyframes:layer.keyframes?.slice().reverse()}]),/increasing/)
 assert.throws(()=>assertVisualLayers([{...overlay,keyframes:[{timeSeconds:1,x:0,y:0,width:1,height:1,opacity:1,easing:'javascript'}]}]),/two to twelve/)
})
test('streamed source audio supports bounded fade gain without samples outside the selected interval',()=>{
 const target=[new Float32Array(48000)],chunk={sampleRate:48000,numberOfChannels:1,length:48000,getChannelData:()=>new Float32Array(48000).fill(.8)}
 mixSourceAudioChunk(target,chunk,0,.25,.5,0,1,.5,time=>Math.min(1,time/.1,(.5-time)/.1))
 assert.equal(target[0][11999],0);assert.equal(target[0][12000],0);assert.ok(Math.abs(target[0][24000]-.4)<.00001);assert.equal(target[0][36000],0)
})

test('Restricted easing admits only closed increasing domains and stays stable near curve endpoints',()=>{
 const frame={timeSeconds:0,x:0,y:0,width:.2,height:.2,opacity:.2,easing:'linear'},last={...frame,timeSeconds:2,x:.5,opacity:1,easing:'ease-in-out'}
 assert.throws(()=>assertVisualLayers([{...overlay,kind:['image']}]),/Unsupported/)
 for(const easing of [['linear'],['ease-in-out'],{toString:()=> 'linear'}])assert.throws(()=>assertVisualLayers([{...overlay,keyframes:[frame,{...last,easing}]}]),/Unknown animation/)
 for(const range of [[0,0],[.7,.3],[-.1,.5],[0,1.1],[0,NaN],[0,Infinity],[0,1,.5],'0,1',{}])assert.throws(()=>assertVisualLayers([{...overlay,keyframes:[frame,{...last,easingRange:range}]}]),/range/)
 assert.throws(()=>assertVisualLayers([{...overlay,keyframes:[frame,{...last,easing:'linear',easingRange:[0,1]}]}]),/range/)
 assert.throws(()=>assertVisualLayers([{...overlay,keyframes:[frame,{...last,easingRange:[0,1],expression:'code'}]}]),/Unsupported/)
 for(const range of [[0,1],[.1,.9],[0,1e-8],[1-1e-8,1]]){
  const layer=assertVisualLayers([{...overlay,keyframes:[frame,{...last,easingRange:range}]}])[0]
  assert.equal(visualLayerBox(layer,0).x,0);assert.equal(visualLayerBox(layer,2).x,.5)
  let previous=-1;for(let i=0;i<=100;i++){const x=visualLayerBox(layer,i/50).x;assert.ok(Number.isFinite(x)&&x>=previous-1e-12&&x>=0&&x<=.5);previous=x}
  const fraction=visualLayerBox(layer,1).x/.5
  if(range[1]===1e-8)assert.ok(Math.abs(fraction-.25)<1e-7)
  if(range[0]===1-1e-8)assert.ok(Math.abs(fraction-.75)<1e-7)
 }
})


test('Visual effect clocks are finite closed bounded data with unique piece identities',()=>{
 const window={originId:'origin',startSeconds:.2,durationSeconds:2,fadeInSeconds:.3,fadeOutSeconds:.3}
 const composition=()=>({title:'Window',scenes:[{title:'One',durationSeconds:1,visualSegments:[{id:'piece',imageArtifactId:'image.png',durationSeconds:1,effectWindow:window}]}]})
 assertComposition(composition());assert.deepEqual(assertVisualEffectWindow(window),window)
 for(const extra of [{expression:'code'},{startSeconds:NaN},{durationSeconds:Infinity},{originId:['origin']},{startSeconds:2},{fadeInSeconds:2}])assert.throws(()=>assertVisualEffectWindow({...window,...extra}))
 assert.throws(()=>assertComposition({...composition(),scenes:[{...composition().scenes[0],visualSegments:[{...composition().scenes[0].visualSegments[0],durationSeconds:1,effectWindow:{...window,startSeconds:1.2}}]}]}),/exceeds/)
 assert.throws(()=>assertComposition({...composition(),scenes:[{...composition().scenes[0],durationSeconds:2,visualSegments:[...composition().scenes[0].visualSegments,...composition().scenes[0].visualSegments]}]}),/Duplicate visual/)
})

test('Closed independent fade windows admit short preserved pieces and reject invalid original clocks',()=>{
 const fadeWindow={originId:'original-fade',startSeconds:.2,durationSeconds:2},visual={id:'window-visual',title:'Window',kind:'rectangle',startSeconds:0,durationSeconds:.1,x:.1,y:.1,width:.2,height:.2,color:'#ffffff',fadeInSeconds:1,fadeOutSeconds:.5,fadeWindow}
 const v=assertVisualLayers([visual])[0],a=assertAudioLayers([{id:'window-audio',title:'Audio',artifactId:'tone.wav',startSeconds:0,durationSeconds:.1,fadeInSeconds:1,fadeOutSeconds:.5,fadeWindow}])[0]
 assert.ok(Math.abs(layerFadeGain(v,.05)-.25)<1e-12);assert.equal(visualLayerBox(v,.05).opacity,layerFadeGain(a,.05));assert.deepEqual(assertLayerFadeWindow(fadeWindow),fadeWindow)
 for(const extra of [{expression:'code'},{startSeconds:-1},{startSeconds:Infinity},{startSeconds:2},{durationSeconds:NaN},{originId:'../outside'},{originId:false}])assert.throws(()=>assertVisualLayers([{...visual,fadeWindow:{...fadeWindow,...extra}}]))
 assert.throws(()=>assertAudioLayers([{...a,fadeWindow:{...fadeWindow,startSeconds:1.95}}]),/超过保留/)
 assert.throws(()=>assertVisualLayers([{...visual,fadeInSeconds:1.01}]),/fade in/);assert.throws(()=>layerFadeGain(a,NaN),/Invalid fade/)
 assert.equal(assertVisualLayers([{...visual,fadeWindow:undefined,fadeInSeconds:.05,fadeOutSeconds:.05}])[0].fadeWindow,undefined)
 const composition=assertComposition({title:'Window schema',music:false,layers:[visual],audioTracks:[a],scenes:[{title:'Base',durationSeconds:2}]});assert.deepEqual(composition.layers![0].fadeWindow,fadeWindow)
})

test('Original presentation windows validate root bounds and preserve counters after repeated cuts',()=>{
 const origin={originId:'root-scene',startSeconds:2.52,durationSeconds:4,musicIndex:1,sceneNumber:1,sceneCount:2}
 const root={title:'Cut',durationSeconds:1.48,bullets:['A','B','C'],bulletRevealSeconds:[.2,1.7,2.9],presentationWindow:origin}
 const parsed=assertComposition({title:'Root clock',scenes:[root]}).scenes[0]
 assert.deepEqual(parsed.presentationWindow,origin);assert.deepEqual(parsed.bulletRevealSeconds,root.bulletRevealSeconds)
 assert.deepEqual(scenePlaybackClock(parsed,2,4),origin)
 const legacy=assertComposition({title:'Legacy',scenes:[scene]}).scenes[0]
 assert.deepEqual(scenePlaybackClock(legacy,2,4),{originId:'unsegmented',startSeconds:0,durationSeconds:10,musicIndex:3,sceneNumber:3,sceneCount:4})
 for(const change of [{originId:'../root'},{originId:['root']},{startSeconds:-1},{startSeconds:2.53},{startSeconds:'2.52'},{durationSeconds:61},{durationSeconds:NaN},{musicIndex:0},{musicIndex:1.5},{sceneNumber:3},{sceneCount:97},{sceneCount:'2'},{url:'https://example.test'},{shell:'run'}])assert.throws(()=>assertComposition({title:'Invalid',scenes:[{...root,presentationWindow:{...origin,...change}}]}))
 assert.throws(()=>assertComposition({title:'Invalid',scenes:[{...root,presentationWindow:null}]}))
 assert.throws(()=>assertComposition({title:'Invalid',scenes:[{...root,bulletRevealSeconds:[0,1,4]}]}),/bullet reveal/)
})

test('Native narration receipts distinguish source duration from short and silent playback pieces',()=>{
 const source={title:'Piece',durationSeconds:1.2,audioArtifactId:'voice.wav',voiceSegments:[{id:'piece',startSeconds:0,sourceStartSeconds:1,durationSeconds:1,playbackRate:1}]}
 const scenes=assertComposition({title:'Receipt',scenes:[source,{...source,voiceSegments:[]},{title:'No voice',durationSeconds:1}]}).scenes
 assert.deepEqual(assertNarrationReceipt(scenes,[2,2,0]),[2,2,0])
 for(const value of [[0,2,0],[1.9,2,0],[2,2,1],[2,181,0],[2,'2',0],[2,NaN,0],[2,2],[2,2,0,0]])assert.throws(()=>assertNarrationReceipt(scenes,value))
 const legacy=assertComposition({title:'Receipt',scenes:[{title:'Legacy',durationSeconds:3,audioArtifactId:'voice.wav'}]}).scenes
 assert.deepEqual(assertNarrationReceipt(legacy,[2]),[2]);assert.throws(()=>assertNarrationReceipt(legacy,[2.01]),/播放区间/)
})

test('Visual effects are closed finite numbers shared by scene footage, segments and independent objects',()=>{
 const effects=assertVisualEffects({brightness:.7,contrast:1.2,saturation:0,blurPixels:8})
 assert.equal(visualEffectFilter(effects),'brightness(0.7) contrast(1.2) saturate(0) blur(8px)');assert.equal(visualEffectFilter(assertVisualEffects({})),'none')
 const input={title:'Effects',durationSeconds:2,imageArtifactId:'source.png',effects},composition=assertComposition({title:'Effects',scenes:[input]});assert.deepEqual(composition.scenes[0].effects,effects)
 const segmented=assertComposition({title:'Effects',scenes:[{title:'Parts',durationSeconds:2,visualSegments:[{durationSeconds:1,imageArtifactId:'source.png',effects},{durationSeconds:1,videoArtifactId:'source.mp4'}]}]});assert.deepEqual(segmented.scenes[0].visualSegments![0].effects,effects)
 const layer={id:'effects-object',title:'Object',kind:'rectangle',startSeconds:0,durationSeconds:2,x:.1,y:.1,width:.2,height:.2,color:'#00cc00',effects};assert.deepEqual(assertVisualLayers([layer])[0].effects,effects)
 for(const bad of [{brightness:0},{brightness:2.01},{contrast:-.1},{saturation:3},{blurPixels:13},{blurPixels:NaN},{brightness:Infinity},{saturation:null},{blurPixels:'8px'},{css:'url(file://outside)'},{filter:'contrast(1)'},null,[]]){assert.throws(()=>assertVisualEffects(bad));assert.throws(()=>assertComposition({title:'Invalid',scenes:[{...input,effects:bad}]}));assert.throws(()=>assertVisualLayers([{...layer,effects:bad}]))}
 assert.throws(()=>assertComposition({title:'Invalid',scenes:[{title:'No footage',durationSeconds:2,effects}]}),/footage/);assert.throws(()=>assertComposition({...segmented,scenes:[{...segmented.scenes[0],effects}]}),/visual segment/)
})

test('published card schemas and runtime agree on reading mode and actual visual binding',()=>{
 const ajv=new Ajv({strict:false}),specValid=ajv.compile(cardSpecSchema),sceneValid=ajv.compile({type:'object',allOf:cardSceneConditionalSchemas})
 const source={artifactId:'source.png',sha256:'a'.repeat(64)},target={source,rect:{x:.1,y:.1,width:.2,height:.2},name:'English 中文'}
 for(const mode of ['whole-to-detail','detail-to-whole','sequence'] as const)for(const count of [1,2,3]){
  const spec={version:2,templateId:'evidence/reading',reading:{mode,targets:Array.from({length:count},()=>target),returnToWhole:true}},valid=mode==='sequence'||count===1
  assert.equal(specValid(spec),valid,JSON.stringify(specValid.errors));if(valid)assert.doesNotThrow(()=>assertCardSpec(spec));else assert.throws(()=>assertCardSpec(spec),/CARD_READING/)
 }
 assert.equal(specValid({version:2,templateId:'evidence/reading',reading:{mode:'sequence',targets:[{...target,name:'bad\u0001'}],returnToWhole:true}}),false)
 const cardSpec={version:2,templateId:'evidence/reading',reading:{mode:'whole-to-detail',targets:[target],returnToWhole:true}}
 for(const binding of [{},{imageArtifactId:'source.png'},{videoArtifactId:'source.png'},{imageArtifactId:'source.png',videoArtifactId:'clip.mp4'}]){
  const scene={title:'Evidence',durationSeconds:8,bullets:[],cardSpec,...binding},valid='imageArtifactId' in binding&&!('videoArtifactId' in binding)
  assert.equal(sceneValid(scene),valid,JSON.stringify(sceneValid.errors));if(valid)assert.doesNotThrow(()=>assertComposition({title:'Test',scenes:[scene]}));else assert.throws(()=>assertComposition({title:'Test',scenes:[scene]}),/CARD_CONTENT|Choose a video or image/)
 }
})

test('recording suggestions cover every source frame and reserve wait compression for complete measured events',()=>{
 const event={kind:'click' as const,source:'page-event' as const,x:100,y:100,viewportWidth:800,viewportHeight:400,surfaceWidth:800,surfaceHeight:400,dpr:1,scrollX:0,scrollY:0}
 const record=recordingEvents('record.webm',{startedEpochMs:100000,width:800,height:400},20,{events:[{...event,epochMs:101000},{...event,epochMs:110000}],truncated:false,reason:'requested'},[{sourceEpochMs:101000,outputSeconds:1},{sourceEpochMs:110000,outputSeconds:10},{sourceEpochMs:120000,outputSeconds:20}],false,'a'.repeat(64))
 const plan=suggestRecordingPlan(record,.74,20);assert.equal(plan.segments[0].startSeconds,.74);assert.equal(plan.segments.at(-1)!.endSeconds,20);assert.ok(plan.segments.some(s=>s.kind==='wait-candidate'&&s.rate===2));for(const [i,s]of plan.segments.entries()){assert.ok(s.endSeconds-s.startSeconds>=.1);if(i)assert.equal(s.startSeconds,plan.segments[i-1].endSeconds)}
 assert.ok(!suggestRecordingPlan({...record,truncated:true},.74,20).segments.some(s=>s.rate===2));assert.equal(assertRecordingEvents(record).videoSha256,'a'.repeat(64));assert.throws(()=>suggestRecordingPlan(record,0,21),/duration/);assert.throws(()=>assertRecordingEvents({...record,videoSha256:'bad'}),/fingerprint/)
})
test('loupe keeps base framing while its source clock follows trims and rate changes',()=>{
 const focus={startSeconds:2,endSeconds:4,x:.7,y:.4,zoom:2,emphasize:true,mode:'loupe' as const,loupeCorner:'bottom-right' as const},visual={videoArtifactId:'screen.webm',sourceStartSeconds:1,playbackRate:2,crop:{x:.1,y:.1,width:.8,height:.8},focusIntervals:[focus]}
 assert.deepEqual(focusFraming(visual,1).crop,visual.crop);assert.equal(focusFraming(visual,1).strength,1);assert.equal(focusFraming(visual,0).strength,0);assert.deepEqual(assertFocusIntervals([focus]),[focus]);assert.throws(()=>assertFocusIntervals([{...focus,mode:'zoom'}]),/focus interval/)
})

test('quality observation bounds memory while preserving every actual paint and restoring the native method',async()=>{
 let draws=0,measured=0;const original=()=>{draws++},context={fillText:original,globalAlpha:1,font:'20px sans-serif',measureText:()=>{measured++;return {width:100,actualBoundingBoxLeft:0,actualBoundingBoxRight:100,actualBoundingBoxAscent:20,actualBoundingBoxDescent:2}},getTransform:()=>({a:1,b:0,c:0,d:1,e:0,f:0})} as unknown as CanvasRenderingContext2D,observed=await traceCanvasText(context,async()=>{for(let i=0;i<300;i++)context.fillText('Label '+i,0,20)});assert.equal(draws,300);assert.equal(measured,256);assert.equal(observed.texts.length,256);assert.equal(observed.omittedTexts,44);assert.equal(context.fillText,original);await assert.rejects(traceCanvasText(context,async()=>{throw new Error('paint failed')}),/paint failed/);assert.equal(context.fillText,original)
})

test('Qwen narration uses its news voice and rejects cross-provider choices and model controls',()=>{
  assert.deepEqual(assertNarration({text:'新闻速递',provider:'qwen-tts'}),{text:'新闻速递',provider:'qwen-tts',voice:'wenhuaizhi_v3.1',ratePercent:0})
  assert.equal(assertNarration({text:'新闻',voice:'xuyanchu_v3.1'}).provider,'qwen-tts')
  assert.equal(assertNarration({text:'科技新闻',voice:'anmingyuan_v3.1'}).provider,'qwen-tts')
  for(const patch of [{provider:'qwen-tts',voice:'zh-CN-YunxiNeural'},{provider:'edge-readaloud',voice:'wenhuaizhi_v3.1'},{provider:'edge-readaloud',voice:'anmingyuan_v3.1'},{provider:'qwen-tts',model:'other'},{provider:'qwen-tts',apiKey:'secret'},{provider:'qwen-tts',workspace:'other'}])assert.throws(()=>assertNarration({text:'新闻',...patch}))
})

import {qwenNarrationConfiguration,qwenAudioUrl,synthesizeQwenNarration} from '../src/qwen-narration.js'
const qwenFixtureEnvironment={apiKey:'fixture-native-secret',workspaceId:'workspace-fixture'}
function qwenWavFixture():Uint8Array {
  const bytes=new Uint8Array(1024);bytes.set(new TextEncoder().encode('RIFF'),0);bytes.set(new TextEncoder().encode('WAVE'),8);return bytes
}
function qwenOutput(url='http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/pre/audio.wav?signature=fixture'):Response{return Response.json({output:{finish_reason:'stop',audio:{url}}})}
test('Qwen native adapter sends the fixed Beijing model and rate, retrieves bounded WAV without credentials or redirects',async()=>{
  const calls:{url:string;init:RequestInit}[]=[]
  const data=await synthesizeQwenNarration({text:'今日新闻。',provider:'qwen-tts',ratePercent:15},async(url,init)=>{calls.push({url,init});return calls.length===1?qwenOutput():new Response(qwenWavFixture() as Uint8Array<ArrayBuffer>)},new AbortController().signal,qwenFixtureEnvironment)
  assert.deepEqual(data,qwenWavFixture());assert.equal(calls.length,2)
  assert.equal(calls[0].url,'https://workspace-fixture.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer')
  assert.deepEqual(JSON.parse(String(calls[0].init.body)),{model:'qwen-audio-3.1-tts-flash',input:{text:'今日新闻。',voice:'wenhuaizhi_v3.1',format:'wav',sample_rate:24000,rate:1.15,language_hints:['zh'],enable_ssml:false}})
  assert.equal((calls[0].init.headers as Record<string,string>).Authorization,'Bearer fixture-native-secret')
  assert.equal(calls[1].init.headers,undefined);assert.ok(calls[1].url.startsWith('https:'))
  for(const call of calls){assert.equal(call.init.redirect,'error');assert.equal(call.init.credentials,'omit')}
})
test('Qwen rejects untrusted download origins, missing credentials, provider errors, excessive bytes and invalid WAV without retries',async()=>{
  for(const url of ['https://evil.test/a','https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com.evil.test/a','https://u:p@dashscope-result-bj.oss-cn-beijing.aliyuncs.com/a','file:///tmp/a','https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com:444/a'])assert.throws(()=>qwenAudioUrl(url))
  for(const env of [{},{...qwenFixtureEnvironment,apiKey:'bad\r\nkey'},{...qwenFixtureEnvironment,workspaceId:'user@evil.test'}])assert.throws(()=>qwenNarrationConfiguration(env))
  for(const responses of [
    [new Response('fixture-native-secret',{status:401})],
    [Response.json({code:'InvalidParameter',message:'fixture-native-secret'})],
    [qwenOutput('https://127.0.0.1/audio')],
    [qwenOutput(),new Response('bad wav')],
    [qwenOutput(),new Response('oversize',{headers:{'content-length':String(8*1024*1024+1)}})],
    [qwenOutput(),new Response(new Uint8Array(8*1024*1024+1))],
    [new Response('{invalid')],
    [Response.json({output:{finish_reason:null,audio:{}}})]
  ]){
    let calls=0
    await assert.rejects(synthesizeQwenNarration({text:'新闻',provider:'qwen-tts'},async()=>{const response=responses[calls++];assert.ok(response,'No automatic retry');return response},new AbortController().signal,qwenFixtureEnvironment),error=>error instanceof Error&&!error.message.includes('fixture-native-secret'))
    assert.equal(calls,responses.length)
  }
})
test('Qwen cancellation cancels an in-flight audio body and does not retry synthesis',async()=>{
  const abort=new AbortController();let calls=0,cancelled=false
  await assert.rejects(synthesizeQwenNarration({text:'新闻',provider:'qwen-tts'},async()=>{
    calls++;if(calls===1)return qwenOutput()
    return new Response(new ReadableStream<Uint8Array>({pull(controller){controller.enqueue(new Uint8Array(32));abort.abort(new Error('Cancel Qwen fixture'))},cancel(){cancelled=true}}))
  },abort.signal,qwenFixtureEnvironment),/Cancel Qwen fixture/)
  assert.equal(calls,2);assert.equal(cancelled,true)
  await assert.rejects(synthesizeQwenNarration({text:'新闻',provider:'qwen-tts'},async()=>{throw new Error('Must not fetch')},abort.signal,qwenFixtureEnvironment),/Cancel Qwen fixture/)
})
