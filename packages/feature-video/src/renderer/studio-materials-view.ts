import {imageHeader,DECODE_BUDGET} from '../../../media-native/src/image-contract.js'
import {Input,CustomSource,ALL_FORMATS,CanvasSink} from 'mediabunny'
import {normalizeBrowserVideoColor} from '../../../media-native/src/media/linear-frames.js'
import {groupMaterials,MATERIAL_DRAG_TYPE,parseMaterialDrop} from '../studio-materials.js'
import type {StudioAsset,StudioState,VideoDraft} from '../studio-contract.js'

type Context={state:StudioState;draft:VideoDraft;sceneId?:string;stage:number;disabled:boolean}
type Thumbnail={url:string;detail?:string}
const kinds={image:'图片',video:'视频',audio:'原始音频',text:'文字'}
const MiB=1024*1024
export class StudioMaterialsView {
  private cache=new Map<string,Thumbnail>();private thumbnailJobs=new Map<string,Promise<Thumbnail>>();private queue:(()=>Promise<void>)[]=[];private workers=0
  private observer?:IntersectionObserver;private cancelVisibility?:()=>void;private generation=0;private projectId=''
  private inputs=new Set<Input>();private dialog?:HTMLDialogElement;private modalURL?:string;private modalGeneration=0
  private mode:'preparation'|'matching'='preparation'
  private displayMode:'icons'|'list'='icons';private pickerDisposers:(()=>void)[]=[]
  constructor(private context:()=>Context|undefined,private read:(project:string,id:string,offset:number,length:number)=>Promise<Uint8Array>,private attach:(asset:StudioAsset,sceneId:string)=>Promise<void>,private collect:(asset:StudioAsset,selected:boolean)=>Promise<void>,private message:(text:string)=>void,private rerender:()=>void=()=>{}){}
  private key(project:string,asset:StudioAsset):string{return `${project}/${asset.artifactId}/${asset.bytes}/${asset.modifiedAt}`}
  private guard(fn:()=>Promise<void>):()=>void{return ()=>{void fn().catch(error=>this.message(String(error instanceof Error?error.message:error)))}}
  bindDrop(target:HTMLElement,sceneId:string,slot?:'visual'|'audio'):void{
    target.dataset.dropScene=sceneId;if(slot)target.dataset.dropSlot=slot
    target.addEventListener('dragover',event=>{const context=this.context();if(!context||context.disabled||context.stage!==3||!event.dataTransfer?.types.includes(MATERIAL_DRAG_TYPE))return;event.preventDefault();event.dataTransfer.dropEffect='copy';target.classList.add('drag-over')})
    target.addEventListener('dragleave',()=>target.classList.remove('drag-over'))
    target.addEventListener('drop',event=>{event.preventDefault();target.classList.remove('drag-over');const context=this.context();if(!context||context.disabled||context.stage!==3)return;const asset=parseMaterialDrop(event.dataTransfer?.getData(MATERIAL_DRAG_TYPE)??'',context.state.project.id,context.state.assets,'visual');if(!asset){this.message('请拖入当前 Project 的图片或视频素材。');return}this.guard(()=>this.attach(asset,sceneId))()})
  }
  render(container:HTMLElement,mode:'preparation'|'matching'):void{
    this.mode=mode
    this.cancelVisibility?.();this.cancelVisibility=undefined;this.observer?.disconnect();this.queue=[];const context=this.context();if(!context)return
    const {state,draft,sceneId,disabled}=context
    container.append(this.viewToolbar())
    if(this.projectId!==state.project.id){this.clear();this.projectId=state.project.id}
    const generation=++this.generation
    const scene=draft.scenes.find(scene=>scene.id===sceneId)
    if(mode==='matching'){
      if(!scene){const empty=document.createElement('p');empty.textContent='请先在「脚本与旁白」中创建分镜，再匹配画面。';container.append(empty);return}
      const heading=document.createElement('h3');heading.textContent=`当前分镜 · ${draft.scenes.indexOf(scene)+1} ${scene.title}`;container.append(heading)
      const target=document.createElement('div');target.className='material-slot';target.setAttribute('aria-label','画面素材拖放区域');target.textContent=`画面素材：${scene.videoArtifactId??scene.imageArtifactId??(scene.bullets.length?'使用标题卡':'未绑定')} · 拖入替换`;this.bindDrop(target,scene.id,'visual');container.append(target)
    }
    const prepared=new Set(draft.preparation.artifactIds),visuals=state.assets.filter(asset=>asset.kind==='image'||asset.kind==='video')
    const groups=mode==='matching'?groupMaterials(visuals,state.drafts,draft,sceneId!):{current:state.assets.filter(asset=>prepared.has(asset.artifactId)).map(asset=>({asset,usage:[]})),unused:state.assets.filter(asset=>!prepared.has(asset.artifactId)).map(asset=>({asset,usage:[]})),elsewhere:[]}
    const pending=new Map<Element,()=>Promise<void>>()
    const root=document.querySelector('.center') as HTMLElement
    this.observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){this.observer?.unobserve(entry.target);const work=pending.get(entry.target);if(work){pending.delete(entry.target);this.queue.push(work)}}this.pump()},{root,rootMargin:'160px'})
    for(const [key,label] of (mode==='matching'?[['current','当前分镜画面'],['unused','其他未用画面'],['elsewhere','其他分镜或视频已用']]:[['current','此次视频素材'],['unused','Project 素材 · 可加入此次制作']]) as ['current'|'unused'|'elsewhere',string][]){
      const section=document.createElement('section');section.dataset.materialGroup=key;section.className='material-group';const title=document.createElement('h3');title.textContent=`${label} · ${groups[key].length}`;section.append(title)
      const grid=document.createElement('div');grid.className='material-grid';grid.dataset.view=this.displayMode;section.append(grid)
      if(!groups[key].length){const empty=document.createElement('p');empty.className='muted';empty.textContent=key==='current'?(mode==='matching'?'当前分镜尚未绑定画面。':'尚未准备素材，可以导入文件或从下方选择。'):'暂无素材。';section.append(empty)}
      for(const {asset,usage} of groups[key]){
        const card=document.createElement('article');card.className='material-card';card.dataset.assetId=asset.artifactId;card.draggable=!disabled&&mode==='matching'
        card.addEventListener('dragstart',event=>{const live=this.context();if(!live||live.disabled){event.preventDefault();return}event.dataTransfer?.setData(MATERIAL_DRAG_TYPE,JSON.stringify({projectId:state.project.id,artifactId:asset.artifactId}));if(event.dataTransfer)event.dataTransfer.effectAllowed='copy'})
        const preview=document.createElement('button');preview.className='material-thumb';preview.disabled=disabled;preview.setAttribute('aria-label','预览 '+asset.artifactId);preview.textContent=asset.kind==='audio'?'♫ 原始音频':asset.kind==='text'?'文字资料 · 点击阅读':'缩略图加载中';preview.onclick=this.guard(()=>this.open(asset,sceneId))
        const name=document.createElement('div');name.className='material-name';name.textContent=asset.artifactId;name.title=asset.artifactId
        const detail=document.createElement('small');detail.className='material-detail';detail.textContent=`${kinds[asset.kind]} · ${(asset.bytes/MiB).toFixed(1)} MB`
        const refs=document.createElement('small');refs.className='material-usage';refs.textContent=mode==='preparation'?(key==='current'?'已加入此次制作':'保存在当前 Project'):usage.length?`已用 ${usage.length} 处分镜`:'尚未使用';refs.title=usage.map(item=>item.label).join('\n')
        const use=document.createElement('button');use.textContent=mode==='preparation'?(key==='current'?'移出此次素材':'加入此次素材'):key==='current'?'已用于此分镜':'用于当前分镜';use.disabled=disabled||(mode==='matching'&&key==='current');use.onclick=this.guard(()=>mode==='preparation'?this.collect(asset,key!=='current'):this.attach(asset,sceneId!))
        card.append(preview,name,detail,refs,use);grid.append(card)
        if(asset.kind==='image'||asset.kind==='video'){
          const apply=(thumb:Thumbnail)=>{if(generation!==this.generation)return;const img=document.createElement('img');img.src=thumb.url;img.alt=kinds[asset.kind]+'缩略图';img.draggable=false;preview.replaceChildren(img);if(thumb.detail)detail.textContent+=' · '+thumb.detail}
          const cached=this.cache.get(this.key(state.project.id,asset));if(cached)apply(cached)
          else{pending.set(card,async()=>{if(generation!==this.generation)return;try{const thumb=await this.thumbnail(state.project.id,asset);if(generation===this.generation)apply(thumb)}catch{if(generation===this.generation)preview.textContent=kinds[asset.kind]+' · 点击预览'}});this.observer.observe(card)}
        }
      }
      container.append(section)
    }
    // Native occlusion can suppress IntersectionObserver deliveries. A layout scan
    // on render/scroll/resize keeps visible thumbnails available without a busy loop.
    let timer:ReturnType<typeof setTimeout>|undefined
    const scan=()=>{
      if(generation!==this.generation)return
      const viewport=root.getBoundingClientRect()
      for(const [card,work] of pending){
        const rect=card.getBoundingClientRect()
        if(rect.width>0&&rect.height>0&&rect.bottom>=viewport.top-160&&rect.top<=viewport.bottom+160){
          pending.delete(card);this.observer?.unobserve(card);this.queue.push(work)
        }
      }
      this.pump()
    }
    const schedule=()=>{clearTimeout(timer);timer=setTimeout(scan,80)}
    root.addEventListener('scroll',schedule,{passive:true});window.addEventListener('resize',schedule)
    this.cancelVisibility=()=>{clearTimeout(timer);root.removeEventListener('scroll',schedule);window.removeEventListener('resize',schedule)}
    schedule()
  }
  private viewToolbar():HTMLElement {
    const bar=document.createElement('div');bar.className='asset-view-toolbar';bar.setAttribute('aria-label','素材显示方式')
    for(const [mode,label] of [['icons','图标'],['list','列表']] as const){const button=document.createElement('button');button.textContent=label;button.dataset.assetView=mode;button.setAttribute('aria-pressed',String(this.displayMode===mode));button.disabled=this.context()?.disabled??true;button.onclick=()=>{this.displayMode=mode;this.rerender()};bar.append(button)}
    return bar
  }
  renderPicker(container:HTMLElement,assets:StudioAsset[],selected:string|undefined,choose?:((asset:StudioAsset)=>Promise<void>|void)):void {
    const context=this.context();container.replaceChildren();if(!context)return
    const project=context.state.project.id;if(this.projectId!==project){this.clear();this.projectId=project}
    const token=this.generation,owner=context.draft.id,active=()=>token===this.generation&&project===this.context()?.state.project.id&&owner===this.context()?.draft.id&&container.isConnected
    container.append(this.viewToolbar());const grid=document.createElement('div');grid.className='asset-choice-grid material-grid';grid.dataset.view=this.displayMode;container.append(grid)
    const pending=new Map<Element,()=>Promise<void>>()
    const apply=(button:HTMLButtonElement,thumb:Thumbnail)=>{if(!active())return;const img=document.createElement('img');img.src=thumb.url;img.alt='素材缩略图';img.draggable=false;button.replaceChildren(img)}
    for(const asset of assets){
      const card=document.createElement('article');card.className='material-card asset-choice';card.dataset.choiceId=asset.artifactId;card.classList.toggle('selected',selected===asset.artifactId)
      const thumb=document.createElement('button');thumb.className='material-thumb';thumb.textContent=asset.kind==='audio'?'♫ 音频':asset.kind==='text'?'文字':'加载预览…';thumb.disabled=context.disabled;thumb.setAttribute('aria-label','预览 '+asset.artifactId);thumb.onclick=this.guard(()=>this.open(asset,undefined,true))
      const name=document.createElement('div');name.className='material-name';name.textContent=asset.artifactId;name.title=asset.artifactId
      const detail=document.createElement('small');detail.className='material-detail';detail.textContent=kinds[asset.kind]+' · '+(asset.bytes/MiB).toFixed(1)+' MB'
      card.append(thumb,name,detail)
      if(choose){const use=document.createElement('button');use.className='asset-choose';use.textContent=selected===asset.artifactId?'已选择':'选择此素材';use.disabled=context.disabled||selected===asset.artifactId;use.setAttribute('aria-pressed',String(selected===asset.artifactId));use.onclick=this.guard(async()=>{if(active())await choose(asset)});card.append(use)}
      grid.append(card)
      if(asset.kind==='image'||asset.kind==='video'){
        const cached=this.cache.get(this.key(project,asset));if(cached)apply(thumb,cached)
        else pending.set(card,async()=>{if(!active())return;try{apply(thumb,await this.thumbnail(project,asset))}catch{if(active())thumb.textContent=kinds[asset.kind]+' · 点击预览'}})
      }
    }
    if(!assets.length){const empty=document.createElement('p');empty.className='muted';empty.textContent='暂无素材，请在素材步骤导入或收集。';container.append(empty)}
    const observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){const work=pending.get(entry.target);if(work){pending.delete(entry.target);observer.unobserve(entry.target);this.queue.push(work)}}this.pump()},{root:grid,rootMargin:'80px'})
    for(const card of pending.keys())observer.observe(card)
    let timer:ReturnType<typeof setTimeout>|undefined
    const scan=()=>{if(!active())return;const rect=grid.getBoundingClientRect(),parent=container.closest('.scenes,#inspector-scroll,.center')?.getBoundingClientRect(),top=Math.max(0,rect.top,parent?.top??0),bottom=Math.min(innerHeight,rect.bottom,parent?.bottom??innerHeight);if(!rect.width||!rect.height||bottom<=top)return;for(const [card,work] of pending){const box=card.getBoundingClientRect();if(box.bottom>=top-80&&box.top<=bottom+80){pending.delete(card);observer.unobserve(card);this.queue.push(work)}}this.pump()}
    const schedule=()=>{clearTimeout(timer);timer=setTimeout(scan,80)};grid.addEventListener('scroll',schedule,{passive:true});window.addEventListener('resize',schedule);schedule()
    this.pickerDisposers.push(()=>{clearTimeout(timer);observer.disconnect();grid.removeEventListener('scroll',schedule);window.removeEventListener('resize',schedule)})
  }
  private pump():void{while(this.workers<2&&this.queue.length){const job=this.queue.shift()!;this.workers++;void job().finally(()=>{this.workers--;this.pump()})}}
  private async load(project:string,asset:StudioAsset,limit:number,active:()=>boolean=()=>true):Promise<Uint8Array<ArrayBuffer>>{
    if(asset.bytes>limit)throw new Error('素材超过页内预览大小上限；仍可绑定此素材。')
    const data=new Uint8Array(asset.bytes);for(let offset=0;offset<data.length;offset+=MiB){if(this.projectId!==project||!active())throw new Error('素材预览已取消。');const length=Math.min(MiB,data.length-offset),chunk=await this.read(project,asset.artifactId,offset,length);if(chunk.length!==length)throw new Error('素材读取不完整，请刷新素材库。');data.set(chunk,offset)}return data
  }
  private async thumbnail(project:string,asset:StudioAsset):Promise<Thumbnail>{
    const key=this.key(project,asset),cached=this.cache.get(key);if(cached)return cached
    const existing=this.thumbnailJobs.get(key);if(existing)return existing
    const pending=this.createThumbnail(project,asset);this.thumbnailJobs.set(key,pending)
    try{return await pending}finally{if(this.thumbnailJobs.get(key)===pending)this.thumbnailJobs.delete(key)}
  }
  private async createThumbnail(project:string,asset:StudioAsset):Promise<Thumbnail>{
    const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;const x=canvas.getContext('2d')!;let detail:string|undefined
    if(asset.kind==='image'){
      const data=await this.load(project,asset,DECODE_BUDGET.imageBytes),header=imageHeader(data),image=await createImageBitmap(new Blob([data]));try{if(image.width*image.height!==header.pixels)throw new Error('Image exceeds decode limit.');const scale=Math.min(320/image.width,180/image.height);x.drawImage(image,(320-image.width*scale)/2,(180-image.height*scale)/2,image.width*scale,image.height*scale);detail=`${image.width} × ${image.height}`}finally{image.close()}
    }else{
      let readBytes=0;const source=new CustomSource({getSize:()=>asset.bytes,prefetchProfile:'none',maxCacheSize:2*MiB,handleUnhandledError:()=>{},read:async(start,end)=>{
        const length=end-start;readBytes+=length;if(readBytes>8*MiB||length>8*MiB||this.projectId!==project)throw new Error('Thumbnail read limit reached.')
        const data=new Uint8Array(length);for(let offset=0;offset<length;offset+=MiB){const count=Math.min(MiB,length-offset),chunk=await this.read(project,asset.artifactId,start+offset,count);if(chunk.length!==count)throw new Error('Incomplete material.');data.set(chunk,offset)}return data
      }})
      const input=new Input({source,formats:ALL_FORMATS});this.inputs.add(input);const timer=window.setTimeout(()=>input.dispose(),12_000)
      try{const track=await input.getPrimaryVideoTrack();if(!track||!await track.canDecode())throw new Error('Video cannot be decoded.');const width=await track.getDisplayWidth(),height=await track.getDisplayHeight();if(width*height>16_777_216)throw new Error('Video exceeds decode limit.');await normalizeBrowserVideoColor(track)
        const sink=new CanvasSink(track,{width:320,height:180,fit:'contain',poolSize:1}),frames=sink.canvases()
        try{const frame=(await frames.next()).value;if(!frame)throw new Error('No video frame.');x.drawImage(frame.canvas,0,0,320,180)}finally{await frames.return()}
        const duration=await input.getDurationFromMetadata();detail=`${width} × ${height}${duration===null?'':` · 约 ${duration.toFixed(1)}s`}`
      }finally{clearTimeout(timer);input.dispose();this.inputs.delete(input)}
    }
    const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('Thumbnail failed.')),'image/png'))
    if(this.projectId!==project)throw new Error('Project 已切换。')
    const thumb={url:URL.createObjectURL(blob),detail},key=this.key(project,asset),old=this.cache.get(key);if(old)URL.revokeObjectURL(old.url);this.cache.set(key,thumb)
    while(this.cache.size>64){const [id,item]=this.cache.entries().next().value!;URL.revokeObjectURL(item.url);this.cache.delete(id)}return thumb
  }
  async open(asset:StudioAsset,sceneId?:string,previewOnly=false):Promise<void>{
    const context=this.context();if(!context||context.disabled)return;const project=context.state.project.id;if(this.projectId!==project){this.clear();this.projectId=project}this.close();const token=++this.modalGeneration
    const dialog=document.createElement('dialog');dialog.className='material-preview-dialog';dialog.setAttribute('aria-label','素材预览');const title=document.createElement('h3');title.textContent=asset.artifactId
    const close=document.createElement('button');close.textContent='关闭';close.onclick=()=>this.close();const content=document.createElement('div');content.className='material-preview-body';content.textContent='正在加载素材…'
    const use=document.createElement('button');use.textContent=this.mode==='preparation'?'加入此次素材':'用于当前分镜';use.className='primary';use.disabled=this.mode==='preparation'&&context.draft.preparation.artifactIds.includes(asset.artifactId);const mode=this.mode;use.onclick=this.guard(async()=>{this.close();if(mode==='preparation')await this.collect(asset,true);else if(sceneId)await this.attach(asset,sceneId)})
    const actions=document.createElement('div');actions.className='row';actions.append(close);if(!previewOnly)actions.append(use);dialog.append(title,content,actions);document.body.append(dialog);this.dialog=dialog;dialog.addEventListener('cancel',()=>this.close());dialog.showModal()
    try{const data=await this.load(project,asset,asset.kind==='text'?2*MiB:asset.kind==='image'?DECODE_BUDGET.imageBytes:128*MiB,()=>token===this.modalGeneration);if(token!==this.modalGeneration)return
      if(asset.kind==='text'){const text=document.createElement('pre');text.className='material-text';text.textContent=new TextDecoder('utf-8',{fatal:true}).decode(data);content.replaceChildren(text);return}
      if(asset.kind==='image'){const header=imageHeader(data),bitmap=await createImageBitmap(new Blob([data]));const large=bitmap.width*bitmap.height!==header.pixels;bitmap.close();if(large)throw new Error('图片超过页内预览像素上限。');if(token!==this.modalGeneration)return}
      const url=URL.createObjectURL(new Blob([data]));this.modalURL=url
      const media=asset.kind==='image'?document.createElement('img'):document.createElement(asset.kind==='video'?'video':'audio');media.src=url
      if(media instanceof HTMLMediaElement){media.controls=true;media.preload='metadata'}else media.alt=asset.artifactId
      content.replaceChildren(media)
    }catch(error){if(token===this.modalGeneration)content.textContent=error instanceof Error?error.message:String(error)}
  }
  close():void{this.modalGeneration++;for(const media of this.dialog?.querySelectorAll('video,audio')??[])if(media instanceof HTMLMediaElement){media.pause();media.removeAttribute('src');media.load()}this.dialog?.close();this.dialog?.remove();this.dialog=undefined;if(this.modalURL)URL.revokeObjectURL(this.modalURL);this.modalURL=undefined}
  suspend():void{this.pickerDisposers.splice(0).forEach(dispose=>dispose());this.cancelVisibility?.();this.cancelVisibility=undefined;this.generation++;this.queue=[];this.observer?.disconnect();this.inputs.forEach(input=>input.dispose());this.inputs.clear();this.close()}
  clear():void{this.suspend();this.projectId='';this.cache.forEach(thumb=>URL.revokeObjectURL(thumb.url));this.cache.clear()}
}
