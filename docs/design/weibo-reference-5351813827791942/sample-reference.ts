// Developer research only. This does not add an action or executable to BMW's model catalog.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {execFileSync} from 'node:child_process'

const directory=path.dirname(new URL(import.meta.url).pathname)
const source=path.join(directory,'reference.mp4'),output=path.join(directory,'dense-2fps')
const sourceSha256=crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex')
if(sourceSha256!=='f676a8b05e5d47c7d473379864a5a01d7c0409feaadc3ba319a965857a2b674a')throw new Error('Original reference identity changed')
fs.mkdirSync(output,{recursive:true})
const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-select_streams','v:0','-show_frames','-show_entries','frame=best_effort_timestamp_time','-of','json',source],{encoding:'utf8',maxBuffer:4*1024*1024})) as {frames:{best_effort_timestamp_time:string}[]}
const frames=probe.frames.filter((_,index)=>index%15===0).map((frame,index)=>({index,indexInSource:index*15,timestampSeconds:Number(frame.best_effort_timestamp_time),file:`frame-${String(index+1).padStart(3,'0')}.jpg`,sheet:`sheet-${String(Math.floor(index/20)+1).padStart(2,'0')}.jpg`}))
if(frames.length!==265||frames.some((frame,index)=>Math.abs(frame.timestampSeconds-index/2)>.00001))throw new Error('Source no longer supports exact half-second sampling')
execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',source,'-vf','select=not(mod(n\\,15))','-fps_mode','vfr','-q:v','2',path.join(output,'frame-%03d.jpg')],{timeout:120000,stdio:'inherit'})
execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-framerate','2','-i',path.join(output,'frame-%03d.jpg'),'-vf',"scale=180:320,drawbox=x=0:y=0:w=iw:h=24:color=black@0.8:t=fill,drawtext=fontcolor=white:fontsize=18:x=6:y=2:text='%{pts\\:hms}',tile=5x4:nb_frames=20:padding=4:margin=6:color=0x333333",'-fps_mode','vfr','-q:v','2',path.join(output,'sheet-%02d.jpg')],{timeout:120000,stdio:'inherit'})
for(const frame of frames)if(!fs.existsSync(path.join(output,frame.file)))throw new Error('Missing sample '+frame.file)
fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify({source:'../reference.mp4',sourceSha256,sourceVideoFrames:probe.frames.length,samplesPerSecond:2,sampling:'Original decoded frame 0,15,30,...; probed PTS verified at 0,0.5,1,...,132 seconds. No interpolated frames.',frameCount:frames.length,firstSeconds:frames[0].timestampSeconds,lastSeconds:frames.at(-1)!.timestampSeconds,sheetCount:Math.ceil(frames.length/20),frames},null,2)+'\n')
const gallery=Array.from({length:Math.ceil(frames.length/20)},(_,index)=>{
 const samples=frames.slice(index*20,index*20+20),file=`sheet-${String(index+1).padStart(2,'0')}.jpg`
 return `<section id="sheet-${index+1}"><h2>${samples[0].timestampSeconds}–${samples.at(-1)!.timestampSeconds} 秒</h2><a href="${file}"><img src="${file}" alt="${samples.length} 个半秒样本" loading="lazy"></a><p>${samples.map(f=>`<a href="${f.file}">${f.timestampSeconds.toFixed(1)}s</a>`).join(' · ')}</p></section>`
}).join('\n')
fs.writeFileSync(path.join(output,'index.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>原始参考 · 每秒两帧</title><style>body{font:16px system-ui;margin:32px auto;max-width:980px;padding:0 20px;background:#222;color:#eee}a{color:#a7d7ff}img{display:block;width:100%;height:auto}section{margin:36px 0}p{line-height:1.8}nav{position:sticky;top:0;background:#222;padding:12px}</style><h1>原始参考：每秒两帧</h1><p>265 个实际解码样本，0–132 秒；半秒间隔，无插帧。点击时间查看原尺寸图。空白格不属于样本。</p><p><a href="../DENSE_RESEARCH.md">调研</a> · <a href="../DENSE_DESIGN.md">设计</a> · <a href="manifest.json">PTS 与来源清单</a></p><nav>${Array.from({length:Math.ceil(frames.length/20)},(_,i)=>`<a href="#sheet-${i+1}">${i*10}s</a>`).join(' · ')}</nav>${gallery}</html>`)
console.log(JSON.stringify({output,frames:frames.length,sheets:Math.ceil(frames.length/20),first:frames[0].timestampSeconds,last:frames.at(-1)!.timestampSeconds}))
