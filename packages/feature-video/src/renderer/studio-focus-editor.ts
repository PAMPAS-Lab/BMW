import type {StudioScene} from '../studio-contract.js'
import type {FocusInterval} from '../../../media-native/src/focus-contract.js'
import {focusSourceTime} from '../../../media-native/src/focus-contract.js'
export function renderFocusEditor(root:HTMLElement,scene:StudioScene,index:number|undefined,disabled:boolean,edit:(fn:(scene:StudioScene)=>void)=>Promise<void>,suggest:(index?:number)=>Promise<FocusInterval[]>,message:(text:string)=>void,pending:(id:string,commit:()=>Promise<void>)=>void,flush:()=>Promise<void>,discard:(fieldPrefix:string)=>void):void{
  const visual=index===undefined?scene:scene.visualSegments![index],section=document.createElement('section');section.className='focus-editor'
  const title=document.createElement('h4');title.textContent='重点区间 · 原素材时间';section.append(title)
  const run=(action:()=>Promise<void>)=>{void action().catch(error=>message(error instanceof Error?error.message:String(error)))}
  const update=(fn:(list:FocusInterval[])=>void)=>edit(scene=>{const target=index===undefined?scene:scene.visualSegments![index];const list=target.focusIntervals??=[];fn(list);list.sort((a,b)=>a.startSeconds-b.startSeconds)})
  const info=document.createElement('p');info.className='muted';info.textContent='视频使用原素材秒数，剪裁/变速后自动映射；图片使用片段内秒数。中心 X/Y 为完整原画面 0–1 比例。修改后可撤销。';section.append(info)
  const add=document.createElement('button');add.textContent='手动添加焦点';add.disabled=disabled||(visual.focusIntervals?.length??0)>=24
  add.onclick=()=>run(()=>update(list=>{const start=Math.max(focusSourceTime(visual,0),list.at(-1)?.endSeconds??0);list.push({startSeconds:start,endSeconds:start+1,x:.5,y:.5,zoom:1.5,emphasize:false})}));section.append(add)
  const auto=document.createElement('button');auto.textContent='根据录制点击建议';auto.disabled=disabled||!visual.videoArtifactId
  auto.onclick=()=>run(async()=>{if(visual.focusIntervals?.length)throw new Error('请先清空或保留现有手动区间；建议不会覆盖已有编辑。');const proposed=await suggest(index);if(!proposed.length)throw new Error('事件记录没有具备帧时钟映射的点击，请手动添加焦点。');await update(list=>{if(list.length)throw new Error('区间已更新，请重新检查。');list.push(...proposed)});message('已添加可编辑建议。请预览并检查操作结果是否完整。')});section.append(auto)
  for(const [i,interval] of (visual.focusIntervals??[]).entries()){
    const row=document.createElement('div');row.className='focus-interval';row.dataset.focusIndex=String(i)
    for(const [key,name] of [['startSeconds','开始秒'],['endSeconds','结束秒'],['x','中心 X'],['y','中心 Y'],['zoom','缩放']] as const){
      const label=document.createElement('label');label.textContent=name;const input=document.createElement('input');input.type='number';input.step='.01';input.disabled=disabled;input.value=String(interval[key]);input.min=key==='zoom'?'1':'0';input.max=key==='zoom'?'4':key==='x'||key==='y'?'1':'1800'
      input.id=`focus-${index??'scene'}-${i}-${key}`;input.oninput=()=>pending(input.id,()=>{const value=Number(input.value);return update(list=>{list[i][key]=value})});input.onchange=()=>run(flush);label.append(input);row.append(label)
    }
    const emphasis=document.createElement('input');emphasis.type='checkbox';emphasis.checked=interval.emphasize;emphasis.disabled=disabled;emphasis.onchange=()=>{const value=emphasis.checked;run(()=>update(list=>{list[i].emphasize=value}))};const label=document.createElement('label');label.textContent='强调中心';label.prepend(emphasis);row.append(label)
    const remove=document.createElement('button');remove.textContent='删除重点';remove.disabled=disabled;remove.onclick=()=>{discard(`focus-${index??'scene'}-${i}-`);run(()=>update(list=>{list.splice(i,1)}))};row.append(remove);section.append(row)
  }
  root.append(section)
}
