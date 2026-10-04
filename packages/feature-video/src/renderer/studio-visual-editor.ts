import {fitVisualSegments} from '../../../media-native/src/visual-segments.js'
import type {StudioScene,StudioAsset} from '../studio-contract.js'
export class StudioVisualEditor {
  private selectedAsset?:string
  constructor(private context:()=>{scene:StudioScene;assets:StudioAsset[];disabled:boolean}|undefined,private edit:(fn:(scene:StudioScene)=>void)=>Promise<void>,private attach:(asset:StudioAsset,sceneId:string,index:number)=>Promise<void>,private message:(value:string)=>void){}
  private run(fn:()=>Promise<void>):void{void fn().catch(error=>this.message(error instanceof Error?error.message:String(error)))}
  render():void{
    const context=this.context(),root=document.getElementById('visual-segments')!;root.replaceChildren();if(!context)return
    const {scene,assets,disabled}=context,segments=scene.visualSegments
    const title=document.createElement('h3');title.textContent='分镜画面片段 · 最多 8 段';root.append(title)
    const choices=document.createElement('select');choices.id='segment-asset';choices.disabled=disabled
    for(const asset of assets.filter(asset=>asset.kind==='image'||asset.kind==='video'))choices.append(new Option(asset.artifactId,asset.artifactId))
    if(assets.some(asset=>asset.artifactId===this.selectedAsset))choices.value=this.selectedAsset!
    choices.onchange=()=>{this.selectedAsset=choices.value}
    const picker=document.createElement('div');picker.id='segment-source-picker';
    const add=document.createElement('button');add.id='segment-add';add.textContent='追加画面片段';add.disabled=disabled||!choices.options.length||(segments?.length??(scene.imageArtifactId||scene.videoArtifactId?1:0))>=8
    add.onclick=()=>{const asset=assets.find(asset=>asset.artifactId===choices.value);if(asset)this.run(()=>this.attach(asset,scene.id,segments?.length??(scene.imageArtifactId||scene.videoArtifactId?1:0)))};root.append(choices,picker,add)
    for(const [index,segment] of (segments??[]).entries()){
      const row=document.createElement('section');row.className='visual-segment';row.dataset.segmentIndex=String(index)
      const label=document.createElement('p');label.textContent=`${index+1} · ${segment.imageArtifactId??segment.videoArtifactId}`;row.append(label)
      const preview=document.createElement('div');preview.dataset.segmentPreview=segment.imageArtifactId??segment.videoArtifactId;row.append(preview)
      for(const [key,label] of [['durationSeconds','时长'],['sourceStartSeconds','源起点'],['playbackRate','速度'],['sourceVolume','原声音量']] as const){
        const wrapper=document.createElement('label');wrapper.textContent=label;const input=document.createElement('input');input.type='number';input.step='.05';input.value=String(segment[key]??1);input.disabled=disabled||((key==='sourceStartSeconds'||key==='sourceVolume')&&!segment.videoArtifactId)
        input.onchange=()=>this.run(()=>this.edit(scene=>{const list=scene.visualSegments!,target=list[index],next=Number(input.value)
          if(key==='durationSeconds'){const other=list[index===list.length-1?index-1:list.length-1];if(!other){if(next!==scene.durationSeconds)throw new Error('单片段时长必须等于分镜时长。')}else{other.durationSeconds+=target.durationSeconds-next;other.transitionSeconds=Math.min(other.transitionSeconds,other.durationSeconds/2)}}
          target[key]=next;target.transitionSeconds=Math.min(target.transitionSeconds,target.durationSeconds/2)
        }));wrapper.append(input);row.append(wrapper)
      }
      const transition=document.createElement('select');transition.append(new Option('直接切换','cut'),new Option('淡出 / 淡入','fade'));transition.value=segment.transition;transition.disabled=disabled;transition.onchange=()=>this.run(()=>this.edit(scene=>{scene.visualSegments![index].transition=transition.value as 'cut'|'fade'}));row.append(transition)
      const keep=document.createElement('input');keep.type='checkbox';keep.checked=Boolean(segment.keepSourceAudio);keep.disabled=disabled||!segment.videoArtifactId;keep.onchange=()=>this.run(()=>this.edit(scene=>{scene.visualSegments![index].keepSourceAudio=keep.checked}));const keepLabel=document.createElement('label');keepLabel.textContent='保留此片段原声';keepLabel.prepend(keep);row.append(keepLabel)
      const remove=document.createElement('button');remove.textContent='移除此片段';remove.disabled=disabled;remove.onclick=()=>this.run(()=>this.edit(scene=>{scene.visualSegments!.splice(index,1);if(!scene.visualSegments!.length)delete scene.visualSegments;else fitVisualSegments(scene.visualSegments!,scene.durationSeconds)}));row.append(remove);root.append(row)
    }
    const note=document.createElement('p');note.className='muted';note.textContent='追加后按分镜时长等分；修改片段时长由另一段补足。画面淡入淡出不改变总长，旁白与字幕保持连续；原声跟随各片段起点、速度和边界。拖放替换整个分镜画面可恢复单素材模式。';root.append(note)
  }
}
