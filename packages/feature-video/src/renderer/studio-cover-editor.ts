import {assertCoverOptions} from '../../../media-native/src/media/processing.cover-contract.js'
import type {VideoCoverOptions} from '../../../media-native/src/media/processing.cover-contract.js'
import type {VideoDraft,StudioAsset} from '../studio-contract.js'
type CoverState={projectId:string;draft:VideoDraft;assets:StudioAsset[];disabled:boolean}
const fields=['title','subtitle','sourceArtifactId','timestampSeconds','position','fit','background','textColor','accentColor'] as const
const node=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T
export class StudioCoverEditor {
  private url:string|undefined;private owner='';private shown='';private generation=0
  constructor(private state:()=>CoverState|undefined,private pending:(id:string|undefined)=>void,private pendingId:()=>string|undefined,private change:(options:VideoCoverOptions)=>Promise<void>,private generate:()=>Promise<void>,private read:(id:string)=>Promise<Uint8Array>,private message:(text:string)=>void){
    const guard=(fn:()=>Promise<void>)=>()=>{void fn().catch(error=>this.message(error instanceof Error?error.message:String(error)))}
    for(const field of fields){const control=node<HTMLInputElement|HTMLSelectElement>('cover-'+field);control.oninput=()=>this.pending(control.id);control.onchange=guard(async()=>{
      const state=this.state();if(!state||state.disabled)return
      const values:Record<string,unknown>={};for(const name of fields){const value=node<HTMLInputElement|HTMLSelectElement>('cover-'+name).value;if(name==='sourceArtifactId'){if(value)values[name]=value}else values[name]=name==='timestampSeconds'?Number(value):value}
      if(state.assets.find(asset=>asset.artifactId===values.sourceArtifactId)?.kind!=='video')values.timestampSeconds=0
      const options=assertCoverOptions(values);this.pending(undefined);await this.change(options)
    })}
    node<HTMLButtonElement>('cover-generate').onclick=guard(async()=>{await this.generate();await this.preview();this.message('视频封面已保存到当前 Project，可下载 PNG。')})
    node<HTMLButtonElement>('cover-show').onclick=guard(()=>this.preview())
  }
  clear():void{this.generation++;if(this.url)URL.revokeObjectURL(this.url);this.url=undefined;this.shown='';node('cover-preview').hidden=true;node('cover-preview-empty').hidden=false;node('cover-download').hidden=true;node<HTMLImageElement>('cover-image').removeAttribute('src')}
  render():void{
    const state=this.state();if(!state){this.clear();return}
    const owner=state.projectId+'/'+state.draft.id;if(owner!==this.owner){this.clear();this.owner=owner}
    const options=assertCoverOptions(state.draft.cover??{title:state.draft.title}),source=node<HTMLSelectElement>('cover-sourceArtifactId')
    if(this.pendingId()!==source.id){source.replaceChildren(new Option('纯文字封面',''),...state.assets.filter(asset=>asset.kind==='image'||asset.kind==='video').map(asset=>new Option((asset.kind==='video'?'视频 · ':'图片 · ')+asset.artifactId,asset.artifactId)));if(options.sourceArtifactId&&!state.assets.some(asset=>asset.artifactId===options.sourceArtifactId))source.append(new Option('素材不可用 · '+options.sourceArtifactId,options.sourceArtifactId));source.value=options.sourceArtifactId??''}
    for(const field of fields){const control=node<HTMLInputElement|HTMLSelectElement>('cover-'+field);if(this.pendingId()!==control.id)control.value=String(options[field]??'');control.disabled=state.disabled}
    node<HTMLInputElement>('cover-timestampSeconds').disabled=state.disabled||state.assets.find(asset=>asset.artifactId===options.sourceArtifactId)?.kind!=='video'
    node<HTMLButtonElement>('cover-generate').disabled=state.disabled
    const latest=state.draft.coverExports?.at(-1);node<HTMLButtonElement>('cover-show').disabled=state.disabled||!latest
    const changed=latest&&(latest.width!==state.draft.width||latest.height!==state.draft.height||JSON.stringify(latest.options)!==JSON.stringify(options))
    node('cover-note').textContent=`${state.draft.width} × ${state.draft.height} PNG · 封面独立于视频、配音和字幕。${changed?'封面设置已变化，请重新生成。':latest?'已保存最近生成的封面。':''}`
    if(this.shown&&this.shown!==latest?.artifactId)this.clear()
  }
  async preview():Promise<void>{
    const state=this.state(),latest=state?.draft.coverExports?.at(-1);if(!state||state.disabled||!latest)return
    const owner=this.owner,attempt=++this.generation,bytes=await this.read(latest.artifactId)
    if(owner!==this.owner||attempt!==this.generation||this.state()?.disabled)return
    if(this.url)URL.revokeObjectURL(this.url);this.url=URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:'image/png'}));this.shown=latest.artifactId
    const image=node<HTMLImageElement>('cover-image');image.src=this.url;image.alt=latest.options.title||'视频封面';node('cover-preview').hidden=false;node('cover-preview-empty').hidden=true
    const link=node<HTMLAnchorElement>('cover-download');link.href=this.url;link.download=(state.draft.title||'video')+'-cover.png';link.hidden=false
  }
}
