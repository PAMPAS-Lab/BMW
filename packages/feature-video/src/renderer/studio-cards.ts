import type {StudioState,VideoDraft} from '../studio-contract.js'
import {sceneCoverage} from '../studio-contract.js'
import {sceneVisuals} from '../../../media-native/src/visual-segments.js'
import type {InspectorMode} from './studio-workbench.js'

type CardContext={state:StudioState;draft?:VideoDraft;index:number;simple:boolean;stage:number;mode:InspectorMode;disabled:boolean;pending:boolean}
export type StudioCardMoveOwner={projectId:string;sessionId:string|null;draftId:string;revision:number}
type CardActions={
  select(index:number):Promise<void>
  advanced():Promise<void>
  open(mode:InspectorMode):Promise<void>
  material(matching:boolean):Promise<void>
  action(id:string):Promise<void>
  move(id:string,targetId:string,after:boolean,owner:StudioCardMoveOwner):Promise<void>
  ask(id:string):Promise<void>
  text():Promise<void>
  pause():void
  flush():Promise<void>
  thumbnail(container:HTMLElement,artifactId:string):void
  notify(text:string):void
}
const node=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T
type CardDrag={pointerId:number;sceneId:string;owner:StudioCardMoveOwner;startX:number;startY:number;x:number;y:number;moved:boolean;targetId?:string;after:boolean;timer?:ReturnType<typeof setInterval>}
/** Card layout reuses the canonical editor and Inspector; it owns no draft copy. */
export class StudioCards {
  private editor=node('script-current').closest<HTMLElement>('.script-editor')!
  private home=node('script-workspace')
  private inspectorHome=node('studio-workspace')
  private detail?:'visual'|'voice'|'captions'|'materials'
  private owner=''
  private matching=false
  private scrollPositions=new Map<string,number>()
  private expandedIntents=new Set<string>()
  private lastFocus?:HTMLElement
  private drag?:CardDrag
  private pendingDrag?:CardDrag
  constructor(private context:()=>CardContext,private actions:CardActions){
    node('card-workspace').addEventListener('scroll',()=>{if(this.owner&&this.context().simple&&!node('card-workspace').hidden)this.scrollPositions.set(this.owner,node('card-workspace').scrollTop)})
    node('cards-add').onclick=this.guard(()=>actions.action('add-scene'))
    node('cards-materials').onclick=this.guard(()=>this.openMaterials())
    node('card-detail-close').onclick=this.guard(()=>this.close())
    node('card-detail-back').onclick=this.guard(()=>this.close())
    node<HTMLDialogElement>('card-detail').addEventListener('cancel',event=>{event.preventDefault();this.guard(()=>this.close())()})
    node('card-list').addEventListener('click',event=>{
      const button=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-card-action]');if(!button)return
      this.guard(async()=>{
        const c=this.context(),index=c.draft?.scenes.findIndex(scene=>scene.id===button.dataset.cardScene)??-1
        if(index<0||c.disabled)return
        if(index!==c.index)await actions.select(index)
        switch(button.dataset.cardAction){
          case 'select':return
          case 'advanced':await actions.advanced();return
          case 'visual':await this.open('visual');return
          case 'voice':await this.open('voice');return
          case 'asset':await this.openMaterials(true);return
          case 'ask':await actions.ask(button.dataset.cardScene!);return
          case 'text':await actions.text();return
          default:await actions.action(button.dataset.cardAction!);return
        }
      })()
    })

    const workspace=node('card-workspace')
    workspace.addEventListener('pointerdown',event=>{
      const handle=(event.target as HTMLElement).closest<HTMLElement>('[data-drag-scene]'),c=this.context()
      if(!handle||event.button!==0||!event.isPrimary||c.disabled||!c.simple||!c.draft||this.drag||this.pendingDrag)return
      event.preventDefault();this.actions.pause()
      const drag:CardDrag={pointerId:event.pointerId,sceneId:handle.dataset.dragScene!,owner:{projectId:c.state.project.id,sessionId:c.state.sessionId??null,draftId:c.draft.id,revision:c.draft.revision},startX:event.clientX,startY:event.clientY,x:event.clientX,y:event.clientY,moved:false,after:false}
      workspace.setPointerCapture(event.pointerId)
      if(!c.pending)this.drag=drag
      else{
        this.pendingDrag=drag;const order=c.draft.scenes.map(scene=>scene.id).join(',')
        this.guard(async()=>{try{
          await actions.flush();if(this.pendingDrag!==drag)return
          const current=this.context(),owner=drag.owner
          if(current.disabled||!current.simple||current.state.project.id!==owner.projectId||(current.state.sessionId??null)!==owner.sessionId||current.draft?.id!==owner.draftId||current.draft.scenes.map(scene=>scene.id).join(',')!==order)throw new Error('STUDIO_CONFLICT: 保存输入期间视频上下文已变化，请重新拖动。')
          drag.owner={...owner,revision:current.draft.revision};this.pendingDrag=undefined;this.drag=drag;this.moveDrag(drag,drag.x,drag.y)
        }catch(error){if(this.pendingDrag===drag)this.cancelDrag();throw error}})()
      }
    })
    workspace.addEventListener('pointermove',event=>{
      const pending=this.pendingDrag;if(pending&&event.pointerId===pending.pointerId){pending.x=event.clientX;pending.y=event.clientY;return}
      const drag=this.drag;if(!drag||event.pointerId!==drag.pointerId)return
      this.moveDrag(drag,event.clientX,event.clientY)
    })
    workspace.addEventListener('pointerup',event=>{
      if(this.pendingDrag?.pointerId===event.pointerId){this.cancelDrag();return}
      const drag=this.drag;if(!drag||event.pointerId!==drag.pointerId)return
      if(drag.moved)this.moveDrag(drag,event.clientX,event.clientY)
      const valid=this.dragCurrent(drag);this.cancelDrag()
      if(valid&&drag.moved&&drag.targetId&&drag.targetId!==drag.sceneId)this.guard(()=>actions.move(drag.sceneId,drag.targetId!,drag.after,drag.owner))()
      else if(!valid)actions.notify('当前视频或版本已变化，请重新拖动镜头。')
    })
    for(const event of ['pointercancel','lostpointercapture'] as const)workspace.addEventListener(event,e=>{if(e.pointerId===this.drag?.pointerId||e.pointerId===this.pendingDrag?.pointerId)this.cancelDrag()})
    window.addEventListener('keydown',event=>{if(event.key==='Escape'&&(this.drag||this.pendingDrag)){event.preventDefault();this.cancelDrag()}},true)
    window.addEventListener('blur',()=>this.cancelDrag())
    window.addEventListener('resize',()=>this.cancelDrag())
    document.addEventListener('visibilitychange',()=>{if(document.hidden)this.cancelDrag()})
  }
  private moveDrag(drag:CardDrag,x:number,y:number):void{
    drag.x=x;drag.y=y
    if(!drag.moved&&Math.hypot(x-drag.startX,y-drag.startY)>=5){drag.moved=true;document.body.classList.add('studio-card-sorting');node('card-list').querySelector<HTMLElement>('[data-card-id="'+drag.sceneId+'"]')?.classList.add('sorting');drag.timer=setInterval(()=>this.scrollDrag(),32)}
    if(drag.moved)this.markDrag()
  }
  private dragCurrent(drag:CardDrag):boolean{
    const c=this.context(),owner=drag.owner
    return c.simple&&!c.disabled&&Boolean(c.draft)&&c.state.project.id===owner.projectId&&(c.state.sessionId??null)===owner.sessionId&&c.draft!.id===owner.draftId&&c.draft!.revision===owner.revision&&c.draft!.scenes.some(s=>s.id===drag.sceneId)
  }
  private clearMarkers():void{for(const card of node('card-list').querySelectorAll<HTMLElement>('[data-card-id]')){card.classList.remove('sort-before','sort-after','sorting');delete card.dataset.sortDrop}}
  private markDrag():void{
    const drag=this.drag;if(!drag)return
    if(!this.dragCurrent(drag)){this.cancelDrag();this.actions.notify('当前视频或版本已变化，请重新拖动镜头。');return}
    for(const card of node('card-list').querySelectorAll<HTMLElement>('[data-card-id]')){card.classList.remove('sort-before','sort-after');delete card.dataset.sortDrop}
    drag.targetId=undefined
    const workspace=node('card-workspace').getBoundingClientRect()
    if(drag.x<workspace.left||drag.x>workspace.right||drag.y<workspace.top||drag.y>workspace.bottom)return
    const target=document.elementFromPoint(drag.x,drag.y)?.closest<HTMLElement>('[data-card-id]')
    if(!target||!node('card-list').contains(target)||target.dataset.cardId===drag.sceneId)return
    const bounds=target.getBoundingClientRect();drag.targetId=target.dataset.cardId;drag.after=drag.y>=bounds.top+bounds.height/2
    target.classList.add(drag.after?'sort-after':'sort-before');target.dataset.sortDrop=drag.after?'after':'before'
  }
  private scrollDrag():void{
    const drag=this.drag;if(!drag?.moved)return
    if(!this.dragCurrent(drag)){this.cancelDrag();return}
    const workspace=node('card-workspace'),bounds=workspace.getBoundingClientRect(),edge=40
    if(drag.x<bounds.left||drag.x>bounds.right||drag.y<bounds.top||drag.y>bounds.bottom)return
    const delta=drag.y<bounds.top+edge?-Math.max(2,(bounds.top+edge-drag.y)/3):drag.y>bounds.bottom-edge?Math.max(2,(drag.y-bounds.bottom+edge)/3):0
    if(delta){workspace.scrollTop+=delta;this.markDrag()}
  }
  private cancelDrag():void{
    const drag=this.drag??this.pendingDrag;this.drag=undefined;this.pendingDrag=undefined;if(drag?.timer)clearInterval(drag.timer)
    const workspace=node('card-workspace');if(drag&&workspace.hasPointerCapture(drag.pointerId))workspace.releasePointerCapture(drag.pointerId)
    document.body.classList.remove('studio-card-sorting');this.clearMarkers()
  }

  private guard(fn:()=>Promise<void>):()=>void{return ()=>{void fn().catch(error=>this.actions.notify(error instanceof Error?error.message:String(error)))}}
  private button(label:string,action:string,id:string,disabled:boolean):HTMLButtonElement{
    const b=document.createElement('button');b.type='button';b.textContent=label;b.dataset.cardAction=action;b.dataset.cardScene=id;b.disabled=disabled;return b
  }
  render():void{
    const c=this.context(),editing=c.simple&&Boolean(c.draft)&&(c.stage===4||this.detail==='materials')&&!['delivery','cover'].includes(c.mode)
    if(this.drag&&(!editing||!this.dragCurrent(this.drag)))this.cancelDrag()
    if(this.pendingDrag&&(!editing||c.state.project.id!==this.pendingDrag.owner.projectId||(c.state.sessionId??null)!==this.pendingDrag.owner.sessionId||c.draft?.id!==this.pendingDrag.owner.draftId))this.cancelDrag()
    const workspace=node('card-workspace')
    if(this.owner&&c.simple&&!workspace.hidden)this.scrollPositions.set(this.owner,workspace.scrollTop)
    workspace.hidden=!editing
    const nextOwner=c.state.project.id+':'+(c.state.sessionId??'')+':'+(c.draft?.id??'')
    if(nextOwner!==this.owner){this.restoreDetail();this.expandedIntents.clear();this.owner=nextOwner;if(this.scrollPositions.size>16)this.scrollPositions.delete(this.scrollPositions.keys().next().value!)}
    else if(editing)for(const details of (document.querySelectorAll('[data-card-intent]') as HTMLDetailsElement[])){if(details.open)this.expandedIntents.add(details.dataset.cardIntent!);else this.expandedIntents.delete(details.dataset.cardIntent!)}
    if(this.editor.parentElement!==this.home)this.home.append(this.editor)
    if(!editing){if(this.detail)this.restoreDetail();return}
    node('scene-strip').hidden=true
    node('cards-summary').textContent=`${c.draft!.scenes.length} 个镜头 · ${c.draft!.scenes.reduce((n,s)=>n+s.durationSeconds,0).toFixed(1)} 秒`
    node<HTMLButtonElement>('cards-add').disabled=c.disabled||c.draft!.scenes.length>=24
    node<HTMLButtonElement>('cards-materials').disabled=c.disabled
    const list=node('card-list');list.replaceChildren()
    for(const [index,scene]of c.draft!.scenes.entries()){
      const selected=index===c.index,card=document.createElement('article');card.className='studio-card'+(selected?' selected':'');card.dataset.cardId=scene.id
      const heading=document.createElement('div');heading.className='studio-card-heading'
      const number=document.createElement('span');number.className='studio-card-number';number.textContent=String(index+1).padStart(2,'0')
      const title=this.button(scene.title,'select',scene.id,c.disabled);title.className='studio-card-title';title.setAttribute('aria-pressed',String(selected))
      const length=document.createElement('small');length.textContent=scene.durationSeconds.toFixed(1)+'s'
      const menu=document.createElement('details');menu.className='studio-card-menu';const summary=document.createElement('summary');summary.textContent='···';summary.setAttribute('aria-label','镜头 '+(index+1)+' 的操作')
      const menuBody=document.createElement('div');for(const [action,label]of [['move-up','向前移动'],['move-down','向后移动'],['duplicate','复制镜头'],['visual','画面取景'],['ask','让 Assistant 改这一镜…'],['remove-scene','删除镜头']] as const){const b=this.button(label,action,scene.id,c.disabled||action==='move-up'&&index===0||action==='move-down'&&index===c.draft!.scenes.length-1);menuBody.append(b)}menu.append(summary,menuBody)
      const handle=document.createElement('span');handle.textContent='⠿';handle.className='studio-card-drag';handle.draggable=false;handle.setAttribute('aria-disabled',String(c.disabled));handle.dataset.dragScene=scene.id;handle.setAttribute('aria-label','拖动镜头排序，也可使用操作菜单')
      heading.append(handle,number,title,length,menu);card.append(heading)
      const content=document.createElement('div');content.className='studio-card-content'
      const picture=document.createElement('div');picture.className='studio-card-picture';const body=document.createElement('div');body.className='studio-card-script-content';content.append(picture,body);card.append(content)
      const asset=sceneVisuals(scene)[0],id=asset?.imageArtifactId??asset?.videoArtifactId
      if(id){const thumbnail=document.createElement('div');thumbnail.className='studio-card-thumbnail';picture.append(thumbnail);list.append(card);this.actions.thumbnail(thumbnail,id)}
      else {const placeholder=document.createElement('span');placeholder.className='muted';placeholder.textContent=scene.bullets.length?'标题卡':'尚未选择画面';picture.append(placeholder)}
      if(scene.visualBrief){const intent=document.createElement('p');intent.className='studio-card-intent';intent.textContent=scene.visualBrief
        if(scene.visualBrief.length>120){const detail=document.createElement('details'),summary=document.createElement('summary');detail.className='studio-card-intent-detail';detail.dataset.cardIntent=scene.id;detail.open=this.expandedIntents.has(scene.id);summary.textContent='画面意图 · 展开查看';detail.append(summary,intent);picture.append(detail)}else{const label=document.createElement('small');label.textContent='画面意图';picture.append(label,intent)}
      }
      if(selected){body.classList.add('studio-card-editor');body.append(this.editor)
        const tools=document.createElement('div');tools.className='studio-card-tools';for(const [action,label]of [['text','编辑卡片'],['asset','换画面'],['voice','声音与字幕']] as const)tools.append(this.button(label,action,scene.id,c.disabled));card.append(tools)
      }else{const label=document.createElement('small');label.className='studio-card-script-label';label.textContent='旁白 / 脚本';const text=document.createElement('p');text.className='studio-card-script';text.textContent=scene.narration||'点击此镜头编写脚本';body.append(label,text)}
      if(scene.layers?.length||scene.audioTracks?.length||c.draft!.layers?.length||c.draft!.audioTracks?.length||(scene.visualSegments?.length??0)>1||scene.focusIntervals?.length){const advanced=this.button('含高级编辑 ›','advanced',scene.id,c.disabled);advanced.className='studio-card-advanced';advanced.title='在高级编辑中查看此镜头的图层、音轨与取景';card.append(advanced)}
      if(scene.presentationWindow&&scene.presentationWindow.startSeconds>0){const continuation=document.createElement('small');continuation.className='muted';continuation.textContent='续段 · 保留完整脚本，复用原旁白区间';card.append(continuation)}
      const audio=document.createElement('small');audio.className='studio-card-audio';audio.textContent=sceneCoverage(scene,c.draft!.tts).audioStale?'此段旁白待更新':scene.audioArtifactId?'旁白已就绪':'未使用旁白';card.append(audio)
      if(card.parentElement!==list)list.append(card)
    }
    this.renderDetail()
    workspace.scrollTop=this.scrollPositions.get(this.owner)??0
    if(this.drag?.moved){list.querySelector<HTMLElement>('[data-card-id="'+this.drag.sceneId+'"]')?.classList.add('sorting');this.markDrag()}
  }
  finishPreparation():void{if(this.detail==='materials')this.restoreDetail()}
  private renderDetail():void{
    if(!this.detail)return
    const inspector=node('inspector'),body=node('card-detail-body'),preparation=node('preparation-workspace'),materials=node('stage-content')
    if(this.detail==='materials'){body.append(preparation,materials);preparation.hidden=this.matching;materials.hidden=false;inspector.hidden=true}
    else{body.append(inspector);inspector.hidden=false}
    node('card-detail-title').textContent=this.detail==='materials'?(this.matching?'更换此镜头画面':'目标与素材'):this.detail==='visual'?'画面与取景':'旁白与字幕'
    node('card-detail-back').hidden=false
  }
  async open(mode:'visual'|'voice'|'captions'):Promise<void>{
    await this.actions.open(mode);this.detail=mode;this.lastFocus=document.activeElement as HTMLElement;this.renderDetail();if(!node<HTMLDialogElement>('card-detail').open)node<HTMLDialogElement>('card-detail').showModal()
  }
  async openMaterials(matching=false):Promise<void>{
    await this.actions.material(matching);this.detail='materials';this.matching=matching;this.lastFocus=document.activeElement as HTMLElement;this.renderDetail()
    node('preparation-workspace').hidden=matching
    node('card-detail-title').textContent=matching?'更换此镜头画面':'目标与素材'
    if(!node<HTMLDialogElement>('card-detail').open)node<HTMLDialogElement>('card-detail').showModal()
  }
  private restoreDetail():void{
    node<HTMLDialogElement>('card-detail').close();this.detail=undefined
    if(node('inspector').parentElement!==this.inspectorHome)this.inspectorHome.append(node('inspector'))
    const center=document.querySelector('.center')!;for(const id of ['preparation-workspace','stage-content'])if(node(id).parentElement!==center)center.append(node(id))
  }
  async close():Promise<void>{await this.actions.flush();this.restoreDetail();await this.actions.open('visual');this.lastFocus?.focus()}
}
