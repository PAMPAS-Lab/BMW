import test from 'node:test'
import assert from 'node:assert/strict'
import {compactText,compactGeometry,compactCue,paintCompactNews} from '../src/media/compact-news-layout.js'
import {assertComposition} from '../src/composition-contract.js'
import {assertCompositionText} from '../src/media/composition-text.js'
import {assertVideoOptions} from '../src/video-options.js'
function measure(){return {font:'500 42px sans-serif',measureText(text:string){const size=Number(/([\d.]+)px/.exec(this.font)?.[1]??42);return {width:Array.from(text).reduce((n,c)=>n+(/[\u3000-\u9fff]/.test(c)?size:size*.52),0)}}}}
test('Compact native geometry keeps every landscape aspect caption-adjacent and within vertical safety',()=>{
 for(const aspect of [1.01,4/3,16/9,2.39]){const g=compactGeometry(aspect);assert.equal(g.captionY-g.media.y-g.media.height,24);assert.ok(Math.abs(g.media.width/g.media.height-aspect)<1e-9);assert.ok(g.footerY+64<=g.safeBottom);assert.ok(g.media.x>=40)}
 assert.throws(()=>compactGeometry(9/16),/横屏/);assert.throws(()=>assertVideoOptions({cardLayout:'news-compact',aspectRatio:'16:9'}),/9:16/)
 assert.equal(assertVideoOptions({cardLayout:'news-compact',aspectRatio:'9:16'}).cardLayout,'news-compact')
})
test('Compact text keeps content and Latin words, balances a Chinese orphan, and rejects overflow without shrink',()=>{
 const c=measure(),input='但一份昔日的誓言，迫使他远赴战场。',block=compactText(c,input,42,2)
 assert.equal(block.lines.join(''),input);assert.equal(block.size,42);assert.equal(block.overflow,false);assert.ok(Array.from(block.lines.at(-1)!).length>=4)
 const long=compactText(c,'Microduck'.repeat(30),42,2);assert.equal(long.lines.join(''),'Microduck'.repeat(30));assert.equal(long.overflow,true);assert.equal(long.size,42)
 const cue=compactCue(c,{startSeconds:0,endSeconds:5,text:'But an old oath had bound him to a distant war.',translationText:input},'bilingual');assert.equal(cue.chinese.overflow,false);assert.equal(cue.english.overflow,false);assert.equal(cue.english.lines.join(' ').replace(/\s+/g,' '),'But an old oath had bound him to a distant war.')
 const saved=compactText(c,input,42,2);saved.lines[0]='mutated caller';assert.equal(compactText(c,input,42,2).lines.join(''),input)
})
test('Compact preflight rejects layout overrides/long cues and shared native painter uses the same fixed slots',()=>{
 const composition=assertComposition({title:'Grok奥德赛\n先看第一集',width:720,height:1280,cardLayout:'news-compact',style:'clean-light',scenes:[{title:'原声',label:'AI生成影片片段｜发布2026-10-25',durationSeconds:5,videoArtifactId:'source.mp4',captions:[{startSeconds:0,endSeconds:5,text:'But an old oath had bound him to a distant war.',translationText:'但一份昔日的誓言，迫使他远赴战场。'}]}]})
 const c=measure();assert.doesNotThrow(()=>assertCompositionText(c,composition));const long=structuredClone(composition);long.scenes[0].captions![0].translationText='完整字幕不应被隐藏。'.repeat(30);assert.throws(()=>assertCompositionText(c,long),/拆cue/)
 const texts:{text:string;x:number;y:number}[]=[],images:unknown[][]=[]
 const canvas={...c,save(){},restore(){},scale(){},fillRect(){},fillText(text:string,x:number,y:number){texts.push({text,x,y})},drawImage(...args:unknown[]){images.push(args)}} as unknown as CanvasRenderingContext2D
 paintCompactNews(canvas,composition.scenes[0],{canvas:{width:640,height:360} as HTMLCanvasElement},1,5,composition)
 const image=images[0],bottom=Number(image[6])+Number(image[8]),cn=texts.find(t=>t.text.includes('昔日'))!;assert.equal(cn.y-bottom,24);assert.equal(texts.filter(t=>t.text.includes('AI生成')).length,1);assert.equal(images.length,1)
 const noVideo=structuredClone(composition);delete noVideo.scenes[0].videoArtifactId;assert.throws(()=>assertCompositionText(c,noVideo),/实际横屏主视频/)
})
