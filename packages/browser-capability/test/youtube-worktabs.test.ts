import assert from 'node:assert/strict'
import test from 'node:test'
import {YoutubeWorkTabs,youtubeWatchAddress,youtubeNativePageTheme} from '../src/youtube-worktabs.js'
import {agentTabsToClose} from '../src/tab-policy.js'
test('YouTube uses its native site appearance bootstrap without affecting unrelated hosts',()=>{
 for(const url of ['https://www.youtube.com/watch?v=jNQXAC9IVRw','https://m.youtube.com/','https://youtube.com/results?search_query=video'])assert.equal(youtubeNativePageTheme(url),true)
 for(const url of ['https://youtube.com.evil.test/','file:///tmp/youtube.com','https://example.com/youtube.com','invalid'])assert.equal(youtubeNativePageTheme(url),false)
})

test('Only concrete HTTPS watch addresses authorize the work tab; playback modifiers require a reload',()=>{
 assert.equal(youtubeWatchAddress('https://www.youtube.com/watch?v=jNQXAC9IVRw&si=abc')?.simple,true)
 assert.equal(youtubeWatchAddress('https://www.youtube.com/watch?v=jNQXAC9IVRw&t=10')?.simple,false)
 for(const url of ['http://www.youtube.com/watch?v=jNQXAC9IVRw','https://youtube.com.evil/watch?v=jNQXAC9IVRw','https://www.youtube.com/shorts/jNQXAC9IVRw','https://www.youtube.com/watch?v=wrong','https://www.youtube.com/watch?v=jNQXAC9IVRw&v=zHBrUVyQJWc','https://user@www.youtube.com/watch?v=jNQXAC9IVRw'])assert.equal(youtubeWatchAddress(url),null)
})
test('Residency is Project-owned; closing forgets the role and LRU preserves the worker within the cap',()=>{
 const tabs=new YoutubeWorkTabs();tabs.assign('a','worker');tabs.assign('b','other');assert.throws(()=>tabs.assign('b','worker'),/OWNER/)
 const all=Array.from({length:7},(_,n)=>({id:n?'ordinary-'+n:'worker',projectId:'a',source:'agent',url:'about:blank',lastUsedAt:n}))
 assert.deepEqual(agentTabsToClose(all,{projectId:'a',protectedTabIds:['worker']}).map(t=>t.id),['ordinary-1'])
 tabs.forget('worker');assert.equal(tabs.get('a'),undefined);assert.equal(tabs.get('b'),'other');assert.equal(tabs.owns('worker'),false)
})
test('FIFO includes awaited cleanup, cancellation does not replay, and a failed job releases only its own queue',async()=>{
 const tabs=new YoutubeWorkTabs(),events:string[]=[],controller=new AbortController();let finish!:()=>void
 const barrier=new Promise<void>(resolve=>{finish=resolve})
 const first=tabs.run('a',()=>{},async()=>{events.push('first');try{await barrier;throw new Error('controlled')}finally{await Promise.resolve();events.push('cleanup')}})
 const cancelled=tabs.run('a',()=>controller.signal.throwIfAborted(),async()=>{events.push('must-not-run')})
 const next=tabs.run('a',()=>{},async()=>{events.push('next')})
 await tabs.run('b',()=>{},async()=>{events.push('independent')});assert.deepEqual(events,['first','independent']);assert.equal(tabs.busy('a'),true)
 controller.abort();const rejected=assert.rejects(first,/controlled/),aborted=assert.rejects(cancelled,/abort/i);finish();await Promise.all([rejected,aborted,next]);assert.deepEqual(events,['first','independent','cleanup','next'])
})
