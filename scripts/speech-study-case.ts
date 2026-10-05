import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import {app,session} from 'electron'
import {MediaController} from '../packages/media-native/src/media-controller.js'
import {assertSpeechEvidence} from '../packages/media-native/src/speech-contract.js'
import {mediaRecord} from '../packages/media-native/src/media-contract.js'
const cases=[
 {id:'mixed-product',category:'中英混读',script:'第一条事实来自 HyperFrames 官方制作指南。它说明原始录屏并不是默认成片。我的判断是，操作证据和成片表达应当分开设计。'},
 {id:'mixed-studio',category:'中英混读、长句',script:'第二条事实来自 Cap 官方文档。Studio 模式创建本地可编辑项目。我的判断是，录屏中的重点、隐私遮挡和节奏调整，需要保存为可以修改的数据。'},
 {id:'mixed-hypit',category:'中英混读、否定句',script:'第三条事实来自 Hypit 的语音对齐模块说明。这个模块本身不运行语音识别。我的判断是，字幕时间和重点揭示必须保留证据来源，不能把估算改名为实测。'},
 {id:'numbers-video',category:'数字、英文缩写',script:'这个视频有二十四帧每秒，宽度一千二百八十，高度七百二十。导出格式是 MP4，声音采样率是四万八千赫兹。'},
 {id:'formula',category:'公式读法',script:'题目是 x 平方减五 x 加六等于零。先把左边写成 x 减二，乘以 x 减三。两个根分别是二和三。'},
 {id:'pauses',category:'句间停顿',script:'第一步，打开项目。第二步，选择素材。请停一下，核对预览。第三步，保存结果。'},
 {id:'added-word',category:'补词',script:'打开项目，然后选择视频。最后保存草稿。',spoken:'先打开当前项目，然后选择视频。最后，请保存草稿。'},
 {id:'missing-word',category:'漏词',script:'打开当前项目，选择清晰的视频素材。仔细检查预览，再保存完整草稿。',spoken:'打开项目，选择视频素材。检查预览，再保存草稿。'},
 {id:'decimal',category:'小数、百分比、时间',script:'播放速度设为零点七五倍，音量保留百分之八十。开始时间是三点五秒，结束时间是十二点二秒。'},
 {id:'english-api',category:'中文与API名称',script:'browser 是唯一的模型工具。调用 JSON 接口时，请先读取 Project 和 Session，再检查 revision。不能把估算字幕称为实测对齐。'}
]
if(process.env.BMW_SPEECH_STUDY_CASE!=='1')throw new Error('Speech study is an explicit opt-in validation case.')
const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bmw-speech-study-'))),artifacts=path.join(root,'project','artifacts'),profile=path.join(root,'profile')
fs.mkdirSync(artifacts,{recursive:true});fs.mkdirSync(profile);app.setPath('userData',profile);app.on('window-all-closed',()=>{})
const output=path.resolve('.bmw-runtime/p0-speech-study',new Date().toISOString().replaceAll(':','-'));fs.mkdirSync(output,{recursive:true})
const receipts:Record<string,unknown>[]=[];let code=0
const timer=setTimeout(()=>{process.stderr.write('Speech study exceeded fifteen minutes.\n');app.exit(1)},900000)
function save(){fs.writeFileSync(path.join(output,'study.json'),JSON.stringify({version:1,status:'study-only',humanReferenceComplete:false,automaticTimingApproved:false,wordTimingAvailable:false,profile:'disposable',cases:receipts},null,2)+'\n')}
async function run(){try{
 await app.whenReady();const isolated=session.fromPartition('bmw-speech-study-'+process.pid),media=new MediaController({session:isolated,pagePath:path.resolve('packages/media-native/src/media/media.html'),preloadPath:path.resolve('packages/media-native/src/preload/media-preload.cjs'),artifactsDirectory:artifacts,resolveArtifactsDirectory:()=>artifacts,onStatus:undefined})
 for(const [index,sample] of cases.entries()){
  console.log('Preparing speech study '+(index+1)+'/10 '+sample.id)
  const audio=mediaRecord(await media.narrate({text:'spoken' in sample?sample.spoken:sample.script,provider:'local-matcha',voice:'local-zh-en',ratePercent:0})),artifactId=String(audio.artifactId),bytes=fs.readFileSync(path.join(artifacts,artifactId)),filename='clip-'+index+'.wav'
  fs.copyFileSync(path.join(artifacts,artifactId),path.join(output,filename))
  const receipt:Record<string,unknown>={...sample,spoken:'spoken' in sample?sample.spoken:sample.script,audio:filename,audioSha256:crypto.createHash('sha256').update(bytes).digest('hex'),audioDurationSeconds:audio.durationSeconds,audioOrigin:{provider:'local-matcha',voice:'local-zh-en',ratePercent:0},humanReference:null,boundaryP95Ms:null,candidates:[]};receipts.push(receipt);save()
  for(const model of ['base','small'] as const){
   const evidence=assertSpeechEvidence(await media.processArtifact({action:'media.speech.align',artifactId,model}))
   const evidenceFile='clip-'+index+'-'+model+'-evidence.json';fs.writeFileSync(path.join(output,evidenceFile),JSON.stringify(evidence,null,2)+'\n')
   for(const artifact of [evidence.normalizedArtifactId,evidence.rawArtifactId,evidence.logArtifactId])fs.copyFileSync(path.join(artifacts,artifact),path.join(output,artifact))
   ;(receipt.candidates as Record<string,unknown>[]).push({model,engineVersion:evidence.engineVersion,modelSha256:evidence.modelSha256,evidence:evidenceFile,raw:evidence.rawArtifactId,normalized:evidence.normalizedArtifactId,elapsedSeconds:evidence.elapsedSeconds,segments:evidence.segments,boundaryP95Ms:null});save()
   console.log('Recorded '+sample.id+' '+model+' '+evidence.elapsedSeconds.toFixed(2)+'s')
  }
 }
 save();console.log('Speech study audio and candidates ready at '+output)
}catch(error){code=1;console.error(error);fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({error:error instanceof Error?error.stack:String(error)},null,2))}finally{clearTimeout(timer);fs.rmSync(root,{recursive:true,force:true});app.exit(code)}}
void run()
