const {ipcRenderer}=require('electron')

// Product-owned mode/context controls. No tool, credential or arbitrary RPC bridge.
let state:{mode?:string;selection?:{revision?:number;dirty?:boolean};draftTitle?:string;sceneTitle?:string}={mode:'browser'}
let rail:HTMLDivElement|undefined
function render():void {
  const editor=document.querySelector('[data-composer-input],[contenteditable="true"][role="textbox"]')
  if(!editor)return
  if(!rail||!rail.isConnected){
    rail=document.createElement('div');rail.id='bmw-video-mode';rail.style.cssText='display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:6px 0;margin:0 12px;flex-shrink:0;font:inherit;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,currentColor);'
    const mode=document.createElement('select');mode.id='bmw-workspace-mode';mode.setAttribute('aria-label','BMW 工作区模式');mode.style.cssText='font:inherit;color:inherit;background:var(--dsw-alias-bg-base,transparent);border:1px solid var(--dsw-alias-border-l1,#777);border-radius:6px;padding:3px 6px;'
    for(const [value,text] of [['browser','浏览器'],['studio','视频工作区']]){const option=document.createElement('option');option.value=value;option.textContent=text;mode.append(option)}
    const context=document.createElement('span');context.id='bmw-video-context';context.setAttribute('role','status');context.style.cssText='min-width:0;overflow-wrap:anywhere;'
    mode.onchange=()=>{mode.disabled=true;void ipcRenderer.invoke('video-workspace-mode',mode.value).then((value:typeof state)=>{state=value;render()}).catch((error:Error)=>{context.textContent=error.message}).finally(()=>{mode.disabled=false})}
    rail.append(mode,context);const scroll=editor.closest('[data-input-scroll]')??editor;scroll.parentElement?.insertBefore(rail,scroll)
  }
  const mode=rail.querySelector<HTMLSelectElement>('select')!,context=rail.querySelector<HTMLElement>('span')!
  mode.value=state.mode==='studio'?'studio':'browser'
  context.textContent=state.mode==='studio'?(state.draftTitle?state.draftTitle+' · '+(state.sceneTitle??'未选择分镜')+' · v'+state.selection?.revision+(state.selection?.dirty?' · 有未保存修改':''):'视频工作区 · 选择或创建草稿'):'同一会话 · 视频草稿保留'
}
ipcRenderer.on('video-workspace-state',(_event:unknown,value:typeof state)=>{state=value;render()})
window.addEventListener('DOMContentLoaded',()=>{
  const observer=new MutationObserver(()=>{if(!rail?.isConnected)render()});observer.observe(document.body,{childList:true,subtree:true})
  void ipcRenderer.invoke('video-workspace-state').then((value:typeof state)=>{state=value;render()}).catch(()=>{})
})
