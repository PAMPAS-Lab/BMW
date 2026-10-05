import crypto from 'node:crypto'
import type {WebContents} from 'electron'
import type {PageRecordingEvent,RecordingClock,RecordingEventSource} from '@bmw-agent/media-native/recording'
/** Trusted top-frame isolated-world events only. No text, selectors, keys, inputs or cookies. */
export class PageRecordingEvents implements RecordingEventSource {
  private readonly name='bmwRecording'+crypto.randomUUID().replaceAll('-','')
  private readonly world='BMW Recording '+this.name
  private scriptId?:string
  private contexts=new Set<number>()
  private events:PageRecordingEvent[]=[]
  private startedEpochMs=Infinity
  private truncated=false
  private reason='requested'
  private closed=false
  private frameId=''
  private readonly pageDebugger:WebContents['debugger']
  constructor(private readonly wc:WebContents,private readonly onPageClosed:()=>void,private readonly surface:()=>{width:number;height:number}){this.pageDebugger=wc.debugger}
  private readonly message=(_event:unknown,method:string,raw:unknown):void=>{
    if(this.closed||this.wc.isDestroyed()||!raw||typeof raw!=='object')return
    const p=raw as Record<string,unknown>
    if(method==='Runtime.executionContextsCleared')this.contexts.clear()
    if(method==='Page.frameNavigated'){const frame=p.frame as {id?:string;parentId?:string}|undefined;if(frame?.id&&!frame.parentId)this.frameId=frame.id}
    if(method==='Runtime.executionContextCreated'){
      const context=p.context as {id?:number;name?:string;auxData?:{frameId?:string}}|undefined
      if(context?.name===this.world&&context.auxData?.frameId===this.frameId&&typeof context.id==='number')this.contexts.add(context.id)
    }
    if(method==='Runtime.executionContextDestroyed')this.contexts.delete(Number(p.executionContextId))
    if(method==='Runtime.bindingCalled'&&p.name===this.name&&this.contexts.has(Number(p.executionContextId))&&typeof p.payload==='string'&&p.payload.length<=2048){
      try{const value:unknown=JSON.parse(p.payload);this.accept(value)}catch{/* Invalid/untrusted messages never enter the recording. */}
    }
  }
  private readonly pageClosed=():void=>{this.reason='page-closed';this.onPageClosed()}
  private readonly debuggerDetached=():void=>{this.truncated=true;this.reason='observer-detached';this.onPageClosed()}
  async prepare():Promise<this>{
    try{
      if(!this.pageDebugger.isAttached())this.pageDebugger.attach('1.3')
      this.pageDebugger.on('message',this.message);this.pageDebugger.on('detach',this.debuggerDetached);this.wc.once('destroyed',this.pageClosed)
      const tree=await this.pageDebugger.sendCommand('Page.getFrameTree') as {frameTree:{frame:{id:string}}};this.frameId=tree.frameTree.frame.id
      await this.pageDebugger.sendCommand('Page.enable')
      await this.pageDebugger.sendCommand('Runtime.enable')
      await this.pageDebugger.sendCommand('Runtime.addBinding',{name:this.name,executionContextName:this.world})
      const source=this.source()
      const script=await this.pageDebugger.sendCommand('Page.addScriptToEvaluateOnNewDocument',{source,worldName:this.world}) as {identifier:string};this.scriptId=script.identifier
      const world=await this.pageDebugger.sendCommand('Page.createIsolatedWorld',{frameId:this.frameId,worldName:this.world}) as {executionContextId:number};this.contexts.add(world.executionContextId)
      await this.pageDebugger.sendCommand('Runtime.evaluate',{expression:source,contextId:world.executionContextId})
      return this
    }catch(error){await this.dispose();throw error}
  }
  private source():string{return `(()=>{
    const key=${JSON.stringify(this.name)},previous=globalThis[key+'Cleanup'];if(previous)previous();
    const epoch=()=>performance.timeOrigin+performance.now();let lastScroll=0,lastViewport=0;
    const send=(kind,event)=>{const now=epoch();if(kind==='scroll'&&now-lastScroll<100)return;if(kind==='viewport'&&now-lastViewport<100)return;if(kind==='scroll')lastScroll=now;if(kind==='viewport')lastViewport=now;
      const data={kind,epochMs:now,source:kind==='navigation'?'browser-lifecycle':'page-event',viewportWidth:innerWidth,viewportHeight:innerHeight,dpr:devicePixelRatio,scrollX:Math.max(0,scrollX),scrollY:Math.max(0,scrollY)};
      if(kind==='click'){if(!event.isTrusted)return;data.x=event.clientX;data.y=event.clientY;}
      if(kind==='navigation'){const u=new URL(location.href);u.username='';u.password='';u.search='';u.hash='';if(['http:','https:','about:'].includes(u.protocol))data.url=u.href;}
      globalThis[key](JSON.stringify(data));};
    const click=e=>send('click',e),scroll=()=>send('scroll'),resize=()=>send('viewport');
    addEventListener('click',click,true);addEventListener('scroll',scroll,true);addEventListener('resize',resize,true);visualViewport?.addEventListener('resize',resize);
    globalThis[key+'Snapshot']=()=>{send('navigation');send('viewport');};globalThis[key+'Cleanup']=()=>{removeEventListener('click',click,true);removeEventListener('scroll',scroll,true);removeEventListener('resize',resize,true);visualViewport?.removeEventListener('resize',resize);delete globalThis[key+'Cleanup'];delete globalThis[key+'Snapshot'];};send('navigation');send('viewport');
  })()`}
  private accept(raw:unknown):void{
    if(!raw||typeof raw!=='object'||this.closed)return
    const e=raw as PageRecordingEvent
    if(!Number.isFinite(e.epochMs)||e.epochMs<this.startedEpochMs||e.epochMs>this.startedEpochMs+1800000)return
    if(this.events.length>=5000){this.truncated=true;this.reason='event-budget';return}
    let bounds:{width:number;height:number}|undefined,zoom=0
    try{bounds=this.surface();zoom=this.wc.getZoomFactor()}catch{this.truncated=true;this.reason='surface-unavailable';return}
    if(!bounds||!Number.isFinite(zoom)||zoom<=0){this.truncated=true;this.reason='surface-unavailable';return}
    this.events.push({...e,surfaceWidth:bounds.width/zoom,surfaceHeight:bounds.height/zoom})
  }
  /** Agent click evidence is explicitly tagged; programmatic clicks are not user events. */
  agentClick(value:Omit<PageRecordingEvent,'surfaceWidth'|'surfaceHeight'>):void{this.accept({...value,kind:'click',source:'agent-action'})}
  begin(clock:RecordingClock):void{this.startedEpochMs=clock.startedEpochMs;if(this.wc.isDestroyed()){this.truncated=true;this.reason='page-closed';this.onPageClosed();return;}void this.pageDebugger.sendCommand('Runtime.evaluate',{expression:`globalThis[${JSON.stringify(this.name+'Snapshot')}]?.()`,contextId:[...this.contexts][0]}).catch(()=>{this.truncated=true})}
  async collect(endEpochMs:number):Promise<{events:PageRecordingEvent[];truncated:boolean;reason:string}>{await this.dispose();const events=this.events.filter(e=>e.epochMs<=endEpochMs);this.events=[];return {events,truncated:this.truncated,reason:this.reason}}
  async dispose():Promise<void>{
    if(this.closed)return;this.closed=true
    this.wc.removeListener('destroyed',this.pageClosed);this.pageDebugger.removeListener('message',this.message);this.pageDebugger.removeListener('detach',this.debuggerDetached)
    if(!this.wc.isDestroyed()&&this.pageDebugger.isAttached()){
      await Promise.allSettled([...this.contexts].map(contextId=>this.pageDebugger.sendCommand('Runtime.evaluate',{expression:`globalThis[${JSON.stringify(this.name+'Cleanup')}]?.()`,contextId})))
      if(this.scriptId)await this.pageDebugger.sendCommand('Page.removeScriptToEvaluateOnNewDocument',{identifier:this.scriptId}).catch(()=>{})
      await this.pageDebugger.sendCommand('Runtime.removeBinding',{name:this.name}).catch(()=>{})
    }
  }
}
