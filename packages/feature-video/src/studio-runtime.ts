import {sourceBindings,sourceLookup} from '@bmw-agent/media-native/sources'
import {NEWS_RESEARCH_PROMPT,newsProductionPrompt} from './news-contract.js'
import {executeVideoReview} from './video-review.js'
import {NewsJournal,newsFingerprint} from './news-store.js'
import {requireSimpleVideo} from './studio-compatibility.js'
import {studioAssistantRequest,studioAssistantPrompt} from './studio-assistant.js'
import {assertStudioRecoveryRequest,canPrepareStudioRecovery,studioRecoveryPrompt} from './studio-production-progress.js'
import type {FeatureRuntime,FeatureHost,FeatureStudioRegion} from '@bmw-agent/platform/feature-contract'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import {constants} from 'node:fs'
import path from 'node:path'
import {WebContentsView,dialog,nativeTheme,session} from 'electron'
import type {IpcMain,IpcMainInvokeEvent} from 'electron'
import {ArtifactJobIO} from '../../media-native/src/artifact-job-io.js'
import {MEDIA_LIMITS,assertArtifactId,mediaRecord} from '../../media-native/src/media-contract.js'
import {studioService} from './studio-service.js'
import type {BrowserSessionOwner} from '@bmw-agent/browser-capability/host'
import {VideoStudioStore} from './studio-store.js'
import {assertStudioMode,assertStudioSelection,studioPromptContext,assertStudioView,defaultStudioView,assertStudioChatView,assertStudioRegion,assertStudioPrompt,studioSelectedObject} from './studio-context.js'
import type {StudioMode,StudioSelection,StudioViewPreferences,StudioChatView} from './studio-context.js'

type Configuration = FeatureHost

export class VideoStudioRuntime implements FeatureRuntime {
  private newsReads=new Map<AbortController,Promise<unknown>>()
  private stopping=false
  private config?:Configuration
  private view?:WebContentsView
  private views=new Map<string,WebContentsView>()
  private suspendedViews=new Set<WebContentsView>()
  private selections=new Map<string,StudioSelection>()
  private preferences=new Map<string,StudioViewPreferences>()
  private chats=new Map<string,StudioChatView>()
  private manualChatPositions=new Set<string>()
  private floatingHeights=new Map<string,number>()
  private regions=new Map<string,FeatureStudioRegion>()
  private mode:StudioMode='browser'
  private present():void{
    const key=this.key(this.ownerId??'',this.ownerSessionId),view=this.preferences.get(key)??defaultStudioView,chat=this.chats.get(key)??{open:false}
    const region=this.regions.get(key)
    this.config?.setStudioPresentation?.({immersive:view.mode==='advanced',chatOpen:chat.open&&!region?.obscured,position:chat.position,docked:chat.docked===true,region,floatHeight:this.floatingHeights.get(key)})
    this.view?.webContents.send('video-studio-chat-view',{...chat,open:chat.open&&!region?.obscured,docked:this.bounds.width<1000||chat.docked===true})
  }
  private updateChat(key:string,value:StudioChatView):void {
    const previous=this.chats.get(key),next={...previous,...value}
    if(value.position)this.manualChatPositions.add(key)
    else if(value.open&&!previous?.open&&!this.manualChatPositions.has(key)){delete next.position;this.floatingHeights.delete(key)}
    // Explicit reopen may choose a new free corner; an open or manually placed float never jumps.
    this.chats.set(key,next)
  }
  private suspendWorkspace():void{const view=this.view;if(view&&!view.webContents.isDestroyed()){this.suspendedViews.add(view);view.webContents.send('video-studio-change',{workspaceHidden:true})}}
  private bounds={x:0,y:102,width:900,height:700}
  private ownerId?:string
  private ownerSessionId?:string
  private key(projectId:string,sessionId:string|undefined|null):string{return projectId+':'+(sessionId??'')}
  private scope():BrowserSessionOwner {
    const config=this.config,sessionId=config?.getCurrentSessionId?.()
    if(!config||!sessionId)throw new Error('STUDIO_SESSION_REQUIRED: 请先选择对话。')
    return {projectId:config.projectStore.active().id,sessionId}
  }
  private cancellation?:AbortController
  private inputs=new Map<string,Promise<ArtifactJobIO>>()
  configure(config:Configuration):void {this.config=config;config.browserKernel.videoReviewRun=owner=>{const id=config.getAssistantActivity?.().runId;if(!id)return undefined;try{return config.assistantTasks?.read(owner,id).state==='running'?id:undefined}catch{return undefined}};config.browserKernel.videoReview=(owner,request,signal)=>executeVideoReview(config,owner,request,signal);config.browserKernel.videoStudioUse=async(owner,material,target)=>{if(owner.projectId!==config.projectStore.active().id||owner.sessionId!==config.getCurrentSessionId?.())throw new Error('Studio Project changed.');const store=new VideoStudioStore(config.projectStore.active().directory,owner.sessionId),draft=store.read(target.draftId);if(draft.revision!==target.expectedRevision)throw new Error('STUDIO_CONFLICT: Material was copied, but the video changed. Reopen the picker to add it.');const sourcePort=config.browserKernel.projectSources?.(),artifactId=material.artifactId;let artifactIds:string[]=[],sourceIds:string[]=[];if(artifactId){if(!store.assets(config.projectStore.active().directory).some(a=>a.artifactId===artifactId))throw new Error('Choose an existing Project material.');artifactIds=[artifactId];sourceIds=sourcePort?sourceBindings(sourcePort,artifactId).map(v=>v.source.id):[]}else{const found=sourcePort?sourceLookup(sourcePort,material.sourceId!,material.acquisitionId!):undefined,source=found?.source,acquisition=found?.acquisition;if(!source||!acquisition)throw new Error('Choose an existing Project source.');const body=await config.browserKernel.projectSources!().readBody(source.id,acquisition.id);artifactIds=acquisition.media.filter(m=>m.artifactId&&body.mediaAvailability.find(a=>a.mediaId===m.id)?.available).map(m=>m.artifactId!);sourceIds=[source.id]}draft.preparation.artifactIds=[...new Set([...draft.preparation.artifactIds,...artifactIds])];draft.preparation.sourceIds=[...new Set([...(draft.preparation.sourceIds??[]),...sourceIds])];const saved=await config.browserKernel.execute({action:'video.studio',studioRequest:{operation:'update',draftId:draft.id,expectedRevision:draft.revision,draft}},{actor:'user',sessionOwner:owner});await config.browserKernel.videoStudioSelect?.(owner,draft.id);return saved};config.browserKernel.videoStudioSelect=async(owner,draftId)=>{if(owner.projectId!==config.projectStore.active().id||owner.sessionId!==config.getCurrentSessionId?.())throw new Error('Only the selected Session may choose a Studio draft.');const draft=new VideoStudioStore(config.projectStore.active().directory,owner.sessionId).read(draftId);await this.requestMode('studio');this.selections.set(this.key(owner.projectId,owner.sessionId),{draftId,stage:0,revision:draft.revision,dirty:false});this.view?.webContents.send('video-studio-change',{selectedDraftId:draftId});this.publishContext();return {opened:true,draftId}};config.browserKernel.videoStudioOpen=owner=>{if(owner.sessionId!==config.getCurrentSessionId?.())throw new Error('Only the selected Session may open Studio.');return this.requestMode('studio').then(()=>({opened:true}))};config.browserKernel.videoStudioContext=owner=>this.currentContext(owner);config.browserKernel.videoStudioChanged=(owner,productionProgress)=>{if(owner){const view=this.views.get(this.key(owner.projectId,owner.sessionId));if(view&&!view.webContents.isDestroyed())view.webContents.send('video-studio-change',{projectId:owner.projectId,...(productionProgress?{productionProgress}:{})})}else for(const view of this.views.values())if(!view.webContents.isDestroyed())view.webContents.send('video-studio-change',{settingsChanged:true});this.publishContext()}}
  async openPanel(id:string):Promise<{opened:boolean}> {
    if(this.stopping)throw new Error('Studio 已停止，不能重新打开。')
    if(id!=='video-studio'||!this.config||this.config.isProjectChanging())throw new Error('Unknown product panel.')
    const owner=this.config.projectStore.active(),host=this.config.getMainWindow()
    if(!host)throw new Error('Studio requires the BMW main window.')
    const sessionId=this.config.getCurrentSessionId?.()??undefined,key=this.key(owner.id,sessionId),ownerChanged=this.ownerId!==owner.id||this.ownerSessionId!==sessionId
    if(ownerChanged){await this.closeInputs();this.suspendWorkspace();this.view?.setVisible(false);this.ownerId=owner.id;this.ownerSessionId=sessionId}
    let view=this.views.get(key)
    const reused=Boolean(view&&!view.webContents.isDestroyed())
    if(!view||view.webContents.isDestroyed()){
      const isolated=session.fromPartition('bmw-studio-'+crypto.randomUUID())
      isolated.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*','ws://*/*','wss://*/*']},(_details,callback)=>callback({cancel:true}))
      view=new WebContentsView({webPreferences:{session:isolated,sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,preload:path.join(import.meta.dirname,'preload/studio-preload.cjs')}})
      this.views.set(key,view);this.view=view;view.setVisible(false);host.contentView.addChildView(view)
      view.webContents.setWindowOpenHandler(()=>({action:'deny'}));view.webContents.on('will-navigate',event=>event.preventDefault())
      view.webContents.on('destroyed',()=>{this.views.delete(key);this.suspendedViews.delete(view!);isolated.webRequest.onBeforeRequest(null)})
      await view.webContents.loadFile(path.join(import.meta.dirname,'renderer/studio.html'))
    }else this.view=view
    if(this.config.isProjectChanging()||this.config.projectStore.active().id!==owner.id||this.view!==view||(this.config.getCurrentSessionId?.()??undefined)!==sessionId){view.setVisible(false);throw new Error('Studio Project changed while opening. Retry from the active Project.')}
    if(reused&&(ownerChanged||this.suspendedViews.has(view))){this.suspendedViews.delete(view);view.webContents.send('video-studio-change',{projectRestored:true})}
    this.mode='studio';this.config.setWorkspaceMode?.('studio');this.layout(this.bounds,true);this.present();this.publishContext();if((this.preferences.get(key)??defaultStudioView).mode==='simple')this.config.revealAgent();host.show();view.webContents.focus()
    return {opened:true}
  }
  layout(bounds:{x:number;y:number;width:number;height:number},visible:boolean):void {
    this.bounds=bounds
    for(const view of this.views.values())view.setVisible(visible&&view===this.view&&this.ownerId===this.config?.projectStore.active().id&&this.ownerSessionId===(this.config?.getCurrentSessionId?.()??undefined))
    if(!visible||!this.view||this.view.webContents.isDestroyed())return
    const host=this.config?.getMainWindow();if(!host)return
    // Browser foregrounding may change child order; keep this workspace above pages.
    // Reorder the attached View directly: detaching interrupts viewport delivery.
    host.contentView.addChildView(this.view);this.view.setBounds(bounds);this.view.setVisible(true)
  }
  private requestMode(mode:StudioMode):Promise<void>{return this.config?.openWorkspace?this.config.openWorkspace(mode):this.setMode(mode)}
  async setMode(raw:unknown):Promise<void> {
    const mode=assertStudioMode(raw)
    if(mode==='studio'){await this.openPanel('video-studio');return}
    this.suspendWorkspace();this.mode=mode;this.layout(this.bounds,false);this.config?.setWorkspaceMode?.(mode);this.publishContext()
  }
  private authorizeAgent(event:IpcMainInvokeEvent):Configuration {
    if(this.stopping)throw new Error('Studio 已停止。')
    const config=this.config,wc=config?.getAgentWebContents?.(),url=config?.getAgentUrl?.()
    if(!config||!wc||!url||event.sender!==wc||event.senderFrame!==wc.mainFrame||new URL(wc.getURL()).origin!==new URL(url).origin||config.isProjectChanging())throw new Error('Only the current Agent main frame may select BMW workspace modes.')
    return config
  }
  private currentContext(owner?:BrowserSessionOwner):Record<string,unknown> {
    const project=this.config?.projectStore.active(),sessionId=owner?.sessionId??this.config?.getCurrentSessionId?.()??undefined,key=project?this.key(project.id,sessionId):'',selection=project&&(!owner||owner.projectId===project.id)?this.selections.get(key):undefined
    if(!project)return {mode:this.mode,selection:null}
    let draft
    if(selection){try{draft=new VideoStudioStore(project.directory,sessionId).read(selection.draftId);assertStudioSelection(selection,draft)}catch{this.selections.delete(key);draft=undefined}}
    return {mode:this.mode,projectId:project.id,sessionId,chat:this.chats.get(key)??{open:false},view:this.preferences.get(key)??defaultStudioView,selection:selection&&draft?{...selection,revision:draft.revision}:null,draftTitle:draft?.title,object:studioSelectedObject(draft,selection),sceneTitle:draft?.scenes.find(scene=>scene.id===selection?.sceneId)?.title}
  }
  private publishContext():void {
    const value=this.currentContext();if(this.config?.sendToShell)this.config.sendToShell('video-workspace-state',value);else this.config?.getShellWebContents()?.send('video-workspace-state',value);if(this.config?.sendToAgent)this.config.sendToAgent('video-workspace-state',value);else this.config?.getAgentWebContents?.()?.send('video-workspace-state',value)
  }
  async contextForSession(sessionId:string,projectId:string):Promise<{text:string}> {
    const config=this.config
    if(config?.isProjectChanging())throw new Error('Studio Project is changing; retry after activation.')
    if(!config||config.projectStore.active().id!==projectId||config.getCurrentSessionId?.()!==sessionId||this.mode!=='studio')return {text:''}
    // Flush pending GUI edits before the driver assembles its logged context snapshot.
    if(this.view&&!this.view.webContents.isDestroyed())await this.view.webContents.executeJavaScript('window.bmwStudioFlush?.()')
    if(config.isProjectChanging()||config.projectStore.active().id!==projectId||config.getCurrentSessionId?.()!==sessionId)throw new Error('Studio context changed during prompt admission.')
    const selection=this.selections.get(this.key(projectId,sessionId)),draft=selection?new VideoStudioStore(config.projectStore.active().directory,sessionId).read(selection.draftId):undefined
    if(selection?.dirty)throw new Error('Save or resolve conflicting Studio edits before sending an Assistant task.')
    return {text:studioPromptContext(this.mode,selection,draft,this.preferences.get(this.key(projectId,sessionId))??defaultStudioView)}
  }
  private authorize(event:IpcMainInvokeEvent,projectId?:unknown):Configuration {
    if(this.stopping)throw new Error('Studio 已停止。')
    const config=this.config
    if(!config||!this.view||event.sender!==this.view.webContents||event.senderFrame!==this.view.webContents.mainFrame)throw new Error('Only the owning Studio main frame may use this interface.')
    if(config.isProjectChanging()||config.projectStore.active().id!==this.ownerId||config.getCurrentSessionId?.()!==this.ownerSessionId||(projectId!==undefined&&projectId!==this.ownerId))throw new Error('Studio Project is no longer active. Reopen from the current Project.')
    return config
  }
  installIpc(ipc:IpcMain):void {
    ipc.handle('video-studio-review',async(event,raw:unknown)=>{const config=this.authorize(event);return config.browserKernel.execute({action:'video.review',reviewRequest:raw},{actor:'user',sessionOwner:this.scope()})})
    ipc.handle('video-studio-news-status',event=>{const config=this.authorize(event),batch=new NewsJournal(config.projectStore.active().directory,this.scope()).read();return {revision:batch.revision,selection:batch.selection??null,closed:batch.closed??false,topics:[],fingerprint:newsFingerprint(batch.topics),asOf:new Date().toISOString()}})
    ipc.handle('video-studio-library',async event=>{const config=this.authorize(event),owner=this.scope();if(this.view&&!this.view.webContents.isDestroyed())await this.view.webContents.executeJavaScript('window.bmwStudioFlush?.()');this.authorize(event);const selection=this.selections.get(this.key(owner.projectId,owner.sessionId));return config.browserKernel.libraryOpen?.(owner,selection?{draftId:selection.draftId,expectedRevision:selection.revision}:undefined)})
    ipc.handle('video-workspace-state',event=>{this.authorizeAgent(event);return this.currentContext()})
    ipc.handle('video-workspace-mode',async(event,mode:unknown)=>{this.authorizeAgent(event);await this.requestMode(assertStudioMode(mode));return this.currentContext()})
    ipc.handle('video-studio-selection',(event,raw:unknown)=>{
      const config=this.authorize(event),key=this.key(config.projectStore.active().id,this.ownerSessionId)
      if(raw===null){this.selections.delete(key);this.publishContext();return {selected:false}}
      const value=mediaRecord(raw),draft=new VideoStudioStore(config.projectStore.active().directory,this.ownerSessionId).read(String(value.draftId))
      this.selections.set(key,assertStudioSelection(raw,draft));this.publishContext();return {selected:true}
    })
    ipc.handle('video-studio-view',(event,raw:unknown)=>{
      const config=this.authorize(event);const owner=this.scope(),value=assertStudioView(raw)
      const key=this.key(owner.projectId,owner.sessionId),previous=this.preferences.get(key)??defaultStudioView
      if(previous.mode==='advanced'&&value.mode==='simple'){const selection=this.selections.get(key);if(selection){const draft=new VideoStudioStore(config.projectStore.active().directory,owner.sessionId).read(selection.draftId);if(draft.revision!==selection.revision||selection.dirty)throw new Error('STUDIO_CONFLICT: 返回简洁模式前请保存并重新加载当前草稿。');requireSimpleVideo(draft)}}
      this.preferences.set(key,value)
      // A view transition stages the chat until the renderer has measured the new workspace.
      // Changing task preferences within advanced editing preserves the user's open/closed choice.
      if(previous.mode!==value.mode&&value.mode==='advanced')this.chats.set(key,{...this.chats.get(key),open:false})
      this.present();this.publishContext();return value
    })
    ipc.handle('video-studio-chat',(event,raw:unknown)=>{
      if(event.sender===this.config?.getAgentWebContents?.())this.authorizeAgent(event);else this.authorize(event)
      if(this.mode!=='studio')throw new Error('Studio chat requires the video workspace.')
      const owner=this.scope(),{owner:expected,...value}=assertStudioChatView(raw)
      if(expected&&(expected.projectId!==owner.projectId||expected.sessionId!==owner.sessionId))throw new Error('Studio chat gesture belongs to another Project or Session.')
      this.updateChat(this.key(owner.projectId,owner.sessionId),value);this.present();this.publishContext();return value
    })
    ipc.handle('video-studio-geometry',(event,raw:unknown)=>{
      this.authorize(event);const owner=this.scope(),region=assertStudioRegion(raw)
      this.regions.set(this.key(owner.projectId,owner.sessionId),region);this.present();return {updated:true}
    })
    ipc.handle('video-studio-prompt',async(event,raw:unknown)=>{
      const config=this.authorizeAgent(event),owner=this.scope(),request=assertStudioPrompt(raw),target=request.target
      if(target.projectId!==owner.projectId||target.sessionId!==owner.sessionId)throw new Error('Studio prompt target belongs to another Project or Session.')
      if(this.view&&!this.view.webContents.isDestroyed())await this.view.webContents.executeJavaScript('window.bmwStudioFlush?.()')
      this.authorizeAgent(event);const active=this.scope();if(active.projectId!==owner.projectId||active.sessionId!==owner.sessionId)throw new Error('Studio prompt owner changed while saving.')
      const store=new VideoStudioStore(config.projectStore.active().directory,owner.sessionId),draft=store.read(target.draftId)
      if(target.sceneId&&!draft.scenes.some(scene=>scene.id===target.sceneId))throw new Error('The pinned scene was deleted; choose a new request scope.')
      const selection=assertStudioSelection({draftId:draft.id,...(target.sceneId?{sceneId:target.sceneId}:{}),...(target.objectKind?{objectKind:target.objectKind}:{}),...(target.layer?{layer:target.layer}:{}),...(target.voiceSegmentId?{voiceSegmentId:target.voiceSegmentId}:{}),...(target.visualSegmentId?{visualSegmentId:target.visualSegmentId}:{}),stage:4,revision:draft.revision,dirty:false},draft)
      const context=studioPromptContext('studio',selection,draft,this.preferences.get(this.key(owner.projectId,owner.sessionId))??defaultStudioView)+'\nUser-selected edit target (frozen data): '+JSON.stringify(target)+'\nThis request targets the identified draft/scene/object even if the UI selection changes. Read that draft before changes; preserve unrelated content.'
      if(store.read(draft.id).revision!==draft.revision)throw new Error('STUDIO_CONFLICT: Target changed before submission.')
      return {runId:await config.enqueueAssistant(owner.sessionId,request.text,context)}
    })
    ipc.handle('video-studio-prefill',(event,raw:unknown)=>{
      const config=this.authorize(event),owner=this.scope()
      if(typeof raw!=='string'||!raw.trim()||raw.length>4000)throw new TypeError('Invalid Studio prompt example.')
      this.revealChat();const selection=this.selections.get(this.key(owner.projectId,owner.sessionId))
      const draft=selection?new VideoStudioStore(config.projectStore.active().directory,owner.sessionId).read(selection.draftId):undefined
      if(selection&&draft)assertStudioSelection(selection,draft)
      const target=selection&&draft?{projectId:owner.projectId,sessionId:owner.sessionId,draftId:draft.id,kind:selection.layer||selection.voiceSegmentId||selection.visualSegmentId?'object':selection.sceneId?'scene':'film',...(selection.sceneId?{sceneId:selection.sceneId}:{}),...(selection.objectKind?{objectKind:selection.objectKind}:{}),...(selection.layer?{layer:selection.layer}:{}),...(selection.voiceSegmentId?{voiceSegmentId:selection.voiceSegmentId}:{}),...(selection.visualSegmentId?{visualSegmentId:selection.visualSegmentId}:{})}:undefined
      config.sendToAgent?.('bmw-assistant-prefill',{projectId:owner.projectId,sessionId:owner.sessionId,text:raw,target,targetLabel:studioSelectedObject(draft,selection)?.title??draft?.scenes.find(scene=>scene.id===selection?.sceneId)?.title??draft?.title});return {prepared:true}
    })
    ipc.handle('video-studio-recovery', (event,raw:unknown)=>{
      const config=this.authorize(event),owner=this.scope(),request=assertStudioRecoveryRequest(raw),store=new VideoStudioStore(config.projectStore.active().directory,owner.sessionId),draft=store.read(request.draftId),activity=this.activity()
      if(draft.revision!==request.expectedRevision)throw new Error('STUDIO_CONFLICT: 请先读取最新制作进度。')
      if(this.cancellation||!canPrepareStudioRecovery(activity,draft))throw new Error('STUDIO_RECOVERY_NOT_READY: 当前任务或资源清理尚未结束；断线和投递不确定的请求不会自动重发。')
      if(!config.sendToAgent)throw new Error('Studio Assistant composer is unavailable.')
      const text=studioRecoveryPrompt(draft,store.reusableExport(draft)?.artifactId??null)
      this.authorize(event);if(store.read(draft.id).revision!==request.expectedRevision)throw new Error('STUDIO_CONFLICT: 草稿已变化，请重新准备续做说明。')
      this.revealChat();config.sendToAgent('bmw-assistant-prefill',{projectId:owner.projectId,sessionId:owner.sessionId,text,target:{...owner,draftId:draft.id,kind:'film'},targetLabel:draft.title})
      return {prepared:true,draftId:draft.id,revision:draft.revision,automaticReplay:false,submitted:false}
    })
    ipc.handle('video-studio-task-cancel',async event=>{
      const config=this.authorize(event),owner=this.scope(),activity=this.activity()
      if(!activity||!['running','queued','waiting-user','waiting-approval','cancelling'].includes(activity.status)||!config.cancelAssistant)throw new Error('No active Assistant task in this Session.')
      await config.cancelAssistant(owner.sessionId);this.authorize(event);return {cancelled:true}
    })
    ipc.handle('video-studio-leave' ,event=>{this.authorize(event);return this.requestMode('browser')})
    ipc.handle('video-studio-state',async event=>{
      const config=this.authorize(event),kernel=config.browserKernel
      if(!this.ownerSessionId)return {project:{id:config.projectStore.active().id,name:config.projectStore.active().name},drafts:[],assets:[],theme:config.getTheme()}
      const owner=this.scope(),result=mediaRecord(await studioService(kernel).execute({operation:'list'},undefined,owner)),assets=mediaRecord(await studioService(kernel).execute({operation:'assets'},undefined,owner))
      return {...result,...assets,chat:this.chats.get(this.key(owner.projectId,owner.sessionId))??{open:false},view:this.preferences.get(this.key(owner.projectId,owner.sessionId))??defaultStudioView,activity:this.activity(),theme:config.getTheme()==='dark'||config.getTheme()==='system'&&nativeTheme.shouldUseDarkColors?'dark':'light'}
    })
    ipc.handle('video-studio-command',async(event,projectId:unknown,raw:unknown)=>{
      const config=this.authorize(event,projectId)
      if(['news-topics','news-guide'].includes(String(mediaRecord(raw).operation))){
        if(this.newsReads.size>=2)throw new Error('News reads are busy; wait for the current preview.')
        const controller=new AbortController(),pending=config.browserKernel.execute({action:'video.studio',studioRequest:raw},{actor:'user',signal:controller.signal,sessionOwner:this.scope()})
        this.newsReads.set(controller,pending)
        try{return await pending}finally{this.newsReads.delete(controller)}
      }
      if(this.cancellation)throw new Error('Finish or cancel the current Studio command.')
      const cancellation=new AbortController();this.cancellation=cancellation
      try {
        const result=await config.browserKernel.execute({action:'video.studio',studioRequest:raw},{actor:'user',signal:cancellation.signal,sessionOwner:this.scope()})
        const request=mediaRecord(raw),owner=this.scope()
        if(request.operation==='select-news-topic'){
          const selection=mediaRecord(mediaRecord(result).batch).selection,chosen=mediaRecord(selection),draftId=String(chosen.draftId),journal=new NewsJournal(config.projectStore.active().directory,owner)
          if(journal.dispatch(draftId,'uncertain')){try{const runId=await config.enqueueAssistant(owner.sessionId,newsProductionPrompt(draftId));journal.dispatch(draftId,'sent',runId)}catch(error){journal.dispatch(draftId,'failed');throw error}}
          this.revealChat()
        }
        this.view?.webContents.send('video-studio-change',{projectId:this.ownerId});return result
      } finally {if(this.cancellation===cancellation)this.cancellation=undefined}
    })
    ipc.handle('video-studio-read',async(event,projectId:unknown,id:unknown,offset:unknown,length:unknown)=>{
      const config=this.authorize(event,projectId),artifactId=assertArtifactId(id)
      let pending=this.inputs.get(artifactId)
      if(!pending){pending=ArtifactJobIO.open(path.join(config.projectStore.active().directory,'artifacts'),{action:'media.inspect',artifactId});this.inputs.set(artifactId,pending)}
      const input=await pending;this.authorize(event,projectId);return input.read(offset,length)
    })
    ipc.handle('video-studio-import',async(event,projectId:unknown)=>{
      const config=this.authorize(event,projectId),owner=config.projectStore.active()
      const result=await dialog.showOpenDialog(config.getMainWindow()!,{properties:['openFile'],filters:[{name:'Text, video, audio and images',extensions:['txt','md','mp4','webm','mov','wav','mp3','m4a','png','jpg','jpeg','webp']}]})
      this.authorize(event,projectId);if(result.canceled)return {cancelled:true}
      const source=result.filePaths[0],extension=path.extname(source).toLowerCase()
      if(!['.txt','.md','.mp4','.webm','.mov','.wav','.mp3','.m4a','.png','.jpg','.jpeg','.webp'].includes(extension))throw new Error('Unsupported preparation material import.')
      const input=await fs.open(source,constants.O_RDONLY|constants.O_NOFOLLOW)
      const artifactId='import-'+crypto.randomUUID()+extension,target=path.join(owner.directory,'artifacts',artifactId)
      let completed=false
      try {
        const stat=await input.stat();if(!stat.isFile()||stat.size<1||stat.size>(['.txt','.md'].includes(extension)?2*1024*1024:MEDIA_LIMITS.inputBytes))throw new Error('Import requires a nonempty file up to 512 MiB (text: 2 MiB).')
        const output=await fs.open(target,'wx',0o600)
        try{for(let offset=0;offset<stat.size;offset+=MEDIA_LIMITS.chunkBytes){this.authorize(event,projectId);const buffer=Buffer.alloc(Math.min(MEDIA_LIMITS.chunkBytes,stat.size-offset));const read=await input.read(buffer,0,buffer.length,offset);if(read.bytesRead!==buffer.length)throw new Error('Import file changed.');await output.writeFile(buffer)}await output.sync();completed=true}finally{await output.close()}
      }finally{await input.close();if(!completed)await fs.rm(target,{force:true})}
      return {artifactId}
    })
    ipc.handle('video-studio-cancel',event=>{this.authorize(event);this.cancellation?.abort(new Error('Cancelled by the user.'));return {cancelled:true}})
    ipc.handle('video-studio-news-close',async event=>{
      const config=this.authorize(event),owner=this.scope()
      if(this.cancellation)throw new Error('Wait for the current Studio command cleanup.')
      if(['queued','running','waiting-user','waiting-approval','cancelling'].includes(this.activity()?.status??'')){if(!config.cancelAssistant)throw new Error('News research remains restricted until actual Assistant cleanup can be confirmed.');await config.cancelAssistant(owner.sessionId)}
      this.authorize(event);const journal=new NewsJournal(config.projectStore.active().directory,owner)
      return config.browserKernel.execute({action:'video.studio',studioRequest:{operation:'propose-news-topics',expectedTopicRevision:journal.read().revision,newsCandidates:[],closeNewsTask:true}},{actor:'user',sessionOwner:owner})
    })
    ipc.handle('video-studio-news-source',async(event,raw:unknown)=>{
      const config=this.authorize(event),owner=this.scope();if(typeof raw!=='string')throw new Error('Choose a news topic.')
      const topic=new NewsJournal(config.projectStore.active().directory,owner).read().topics.find(t=>t.candidate.id===raw)
      if(!topic)throw new Error('Unknown current news topic.')
      if(this.cancellation)throw new Error('Finish the current Studio command before opening a source.')
      const cancellation=new AbortController();this.cancellation=cancellation
      try{
        const state=mediaRecord(await config.browserKernel.execute({action:'tabs.list'},{actor:'user',signal:cancellation.signal,sessionOwner:owner})),tabs=Array.isArray(state.tabs)?state.tabs.map(mediaRecord):[],existing=tabs.find(tab=>tab.projectId===owner.projectId&&tab.url===topic.facts.url&&typeof tab.id==='string')
        this.authorize(event);cancellation.signal.throwIfAborted()
        const result=await config.browserKernel.execute(existing?{action:'tabs.show',tabId:existing.id}:{action:'tabs.open',url:topic.facts.url,foreground:true},{actor:'user',signal:cancellation.signal,sessionOwner:owner})
        this.authorize(event);await this.requestMode('browser');return result
      }finally{if(this.cancellation===cancellation)this.cancellation=undefined}
    })
    ipc.handle('video-studio-news',async event=>{
      const config=this.authorize(event),owner=this.scope()
      if(this.cancellation||config.isProjectChanging()||['queued','running','waiting-user','waiting-approval','cancelling'].includes(this.activity()?.status??''))throw new Error('Finish current Assistant or Studio work before requesting news.')
      const cancellation=new AbortController();this.cancellation=cancellation
      try{const kernel=config.browserKernel,previous=new NewsJournal(config.projectStore.active().directory,owner).read()
        await kernel.execute({action:'video.studio',studioRequest:{operation:'propose-news-topics',expectedTopicRevision:previous.revision,newsCandidates:[]}},{actor:'user',signal:cancellation.signal,sessionOwner:owner})
        this.authorize(event);const runId=await config.enqueueAssistant(owner.sessionId,NEWS_RESEARCH_PROMPT);this.revealChat();return {runId}
      }finally{if(this.cancellation===cancellation)this.cancellation=undefined}
    })
    ipc.handle('video-studio-assistant',async(event,raw:unknown)=>{
      const config=this.authorize(event)
      if(raw!==undefined){
        const request=studioAssistantRequest(raw);this.authorize(event,request.projectId)
        const project=config.projectStore.active(),owner=this.scope(),draft=new VideoStudioStore(project.directory,owner.sessionId).read(request.draftId)
        if(draft.revision!==request.expectedRevision)throw new Error('STUDIO_CONFLICT: Reload the current draft before requesting an Assistant task.')
        const prompt=studioAssistantPrompt(draft,request.intent,request.sceneId,request.referenceId)
        this.authorize(event,request.projectId)
        if(new VideoStudioStore(project.directory,owner.sessionId).read(draft.id).revision!==request.expectedRevision)throw new Error('STUDIO_CONFLICT: Draft changed before Assistant submission.')
        const context=request.intent==='materials'?studioPromptContext('studio',assertStudioSelection({draftId:draft.id,stage:0,revision:draft.revision,dirty:false},draft),draft,this.preferences.get(this.key(owner.projectId,owner.sessionId))??defaultStudioView)+'\nUser-selected material preparation target (frozen data): '+JSON.stringify({projectId:owner.projectId,sessionId:owner.sessionId,draftId:draft.id,kind:'film'})+'\nThis is material preparation only; preserve scenes and stop after actual material collection.':undefined
        await config.enqueueAssistant(owner.sessionId,prompt,context)

      }
      this.revealChat();config.getMainWindow()?.show();config.getMainWindow()?.focus();return {opened:true}
    })
  }
  onStudioPresentation(value:import('@bmw-agent/platform/feature-contract').FeatureStudioPresentation):void{
    const key=this.key(this.ownerId??'',this.ownerSessionId),chat=this.chats.get(key)??{open:false}
    if(value.immersive&&value.chatOpen&&value.docked===false&&Number.isFinite(value.floatHeight)&&!this.floatingHeights.has(key))this.floatingHeights.set(key,value.floatHeight!)
    if(value.immersive&&value.chatOpen&&value.docked===false&&value.position&&!chat.position&&this.config?.getCurrentSessionId?.()===this.ownerSessionId)this.chats.set(this.key(this.ownerId??'',this.ownerSessionId),{...chat,position:value.position})
    this.view?.webContents.send('video-studio-chat-view',{...chat,open:value.chatOpen,docked:value.docked!==false})
  }
  private revealChat():void{
    const key=this.key(this.ownerId??'',this.ownerSessionId)
    this.updateChat(key,{open:true});this.present();this.config?.revealAgent();this.publishContext()
  }
  onProjectActivated():void {
    this.view?.webContents.send('video-studio-change',this.config?.projectStore.active().id===this.ownerId?{projectRestored:true}:{projectChanged:true})
    if(this.mode==='studio'&&this.config?.projectStore.active().id!==this.ownerId)void this.requestMode('browser')
    this.publishContext()
  }
  async onSessionWillChange():Promise<void>{
    if(this.cancellation)throw new Error('请先完成或取消当前视频作业，再切换对话。')
    if(this.view&&!this.view.webContents.isDestroyed()&&this.ownerId===this.config?.projectStore.active().id&&this.ownerSessionId===this.config?.getCurrentSessionId?.())await this.view.webContents.executeJavaScript('window.bmwStudioFlush?.()')
  }
  async onSessionChanged():Promise<void>{
    this.suspendWorkspace();this.view?.setVisible(false)
    if(this.mode==='studio')await this.openPanel('video-studio')
    this.publishContext()
  }
  private activity():ReturnType<NonNullable<FeatureHost['getAssistantActivity']>>|null {
    const value=this.config?.getAssistantActivity?.()
    return value&&value.projectId===this.ownerId&&value.sessionId===this.ownerSessionId?value:null
  }
  onAssistantChanged():void {
    if(this.view&&!this.view.webContents.isDestroyed())this.view.webContents.send('video-studio-task',this.activity())
  }
  onAgentLoaded():void {this.publishContext();this.onAssistantChanged()}
  onMediaStatus(value:unknown):void {this.view?.webContents.send('video-studio-progress',value)}
  private async closeInputs():Promise<void>{const inputs=[...this.inputs.values()];this.inputs.clear();await Promise.allSettled(inputs.map(async input=>(await input).close()))}
  async stop():Promise<void>{this.stopping=true;this.cancellation?.abort();for(const controller of this.newsReads.keys())controller.abort();await Promise.allSettled([...this.newsReads.values()]);for(const view of this.views.values()){const host=this.config?.getMainWindow();if(host&&!host.isDestroyed()&&host.contentView.children.includes(view))host.contentView.removeChildView(view);if(!view.webContents.isDestroyed())view.webContents.close({waitForBeforeUnload:false})}this.views.clear();await this.closeInputs()}
}
