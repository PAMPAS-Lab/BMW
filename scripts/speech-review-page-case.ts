import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import {app,BrowserWindow} from 'electron'
const url=new URL(process.env.BMW_SPEECH_REVIEW_URL??'http://127.0.0.1:62572')
if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.username||url.password||url.pathname!=='/')throw new Error('Review validation accepts the loopback annotation page only.')
const temporary=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bmw-speech-review-ui-')));app.setPath('userData',temporary);app.on('window-all-closed',()=>{})
const output=path.resolve('.bmw-runtime/p0-speech-review');fs.mkdirSync(output,{recursive:true});let window:BrowserWindow|undefined,code=0
async function run(){try{
 await app.whenReady();window=new BrowserWindow({show:false,width:1360,height:1000,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,partition:'bmw-speech-review-ui-'+process.pid}});await window.loadURL(url.toString())
 const results=await window.webContents.executeJavaScript(`(async()=>{const audios=[...document.querySelectorAll('audio')];await Promise.all(audios.map(audio=>audio.readyState>=1?Promise.resolve():new Promise((resolve,reject)=>{audio.addEventListener('loadedmetadata',resolve,{once:true});audio.addEventListener('error',()=>reject(Error('Audio preview failed')),{once:true})})));return {articles:document.querySelectorAll('article').length,audio:audios.map(audio=>({duration:audio.duration,seekable:audio.seekable.length?audio.seekable.end(0):0})),blankTimes:[...document.querySelectorAll('input[type=number]')].every(input=>input.value===''),reviewed:document.getElementById('reviewed').checked,overflow:document.documentElement.scrollWidth>innerWidth}})()`)
 assert.equal(results.articles,10);assert.equal(results.audio.length,10);assert.ok(results.audio.every((audio:{duration:number;seekable:number})=>audio.duration>0&&audio.seekable===audio.duration));assert.equal(results.blankTimes,true);assert.equal(results.reviewed,false);assert.equal(results.overflow,false)
 const action=await window.webContents.executeJavaScript(`(async()=>{document.getElementById('save').click();await Promise.resolve();const message=document.getElementById('status').textContent;const audio=document.querySelector('audio');audio.currentTime=1.23;await new Promise(resolve=>audio.addEventListener('seeked',resolve,{once:true}));document.querySelector('article button').textContent;[...document.querySelectorAll('article button')].find(button=>button.textContent==='设开始').click();return {message,time:Number(document.querySelector('article input[type=number]').value),audioTime:audio.currentTime}})()`)
 assert.match(action.message,/核对/);assert.equal(action.time,1.23);assert.equal(action.audioTime,1.23)
 await window.reload();await new Promise(resolve=>setTimeout(resolve,500));const screenshot=await window.webContents.capturePage();fs.writeFileSync(path.join(output,'annotation-page.png'),screenshot.toPNG());fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({status:'passed',...results,seekAndButton:action,submittedHumanReference:false},null,2));console.log('PASS ten audio previews, actual seeking, empty manual boundaries, review guard and native screenshot')
}catch(error){code=1;console.error(error)}finally{window?.destroy();fs.rmSync(temporary,{recursive:true,force:true});app.exit(code)}}
void run()
