import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createServer} from 'node:http'
import {app,session,net} from 'electron'
import {createMediaSessionFetch} from '../packages/browser-capability/src/media-session-fetch.js'
import {downloadMediaArtifact} from '../packages/browser-capability/src/media-artifact.js'

const root=fs.mkdtempSync(path.join(os.tmpdir(),'bmw-download-smoke-'))
app.setPath('userData',path.join(root,'profile'))
const server=createServer((req,res)=>{
  if(!req.headers.referer){res.writeHead(403);res.end();return}
  if(req.url==='/redirect'){res.writeHead(302,{location:'/clip'});res.end();return}
  if(req.url==='/partial'){res.writeHead(206,{'content-type':'video/mp4','content-range':'bytes 0-1/4'});res.end('ab');return}
  res.writeHead(200,{'content-type':'video/mp4','content-length':'4'});res.end('abcd')
})
async function run(){await app.whenReady();await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address();if(!address||typeof address==='string')throw new Error('Missing fixture address')
 const origin='http://127.0.0.1:'+address.port,source=origin+'/player?private=1',isolated=session.fromPartition('media-download-'+process.pid)
 assert.equal((await isolated.fetch(origin+'/clip',{referrer:source})).status,403,'Fixture reproduces Electron referrer omission')
 const fetchImpl=createMediaSessionFetch(isolated,source,'',net.request)
 const artifact=await downloadMediaArtifact({projectDirectory:root,url:origin+'/redirect',fetchImpl,referrer:source})
 assert.equal(fs.readFileSync(artifact.path,'utf8'),'abcd')
 await assert.rejects(downloadMediaArtifact({projectDirectory:root,url:origin+'/partial',fetchImpl}),/full HTTP 200/)
 assert.equal((await createMediaSessionFetch(isolated,source,'no-referrer',net.request)(origin+'/clip')).status,403)
 console.log('BMW media download runtime: referrer wire header, redirect, no-referrer and partial-response rejection passed.')
}
const watchdog=setTimeout(()=>app.exit(1),30000)
run().then(()=>{clearTimeout(watchdog);server.close();fs.rmSync(root,{recursive:true,force:true});app.exit(0)}).catch(error=>{console.error(error);server.close();app.exit(1)})
