import type {LibraryIdentity,LibraryEntry} from '../library-contract.js'
import type {ExportSummary,ExportUse} from '../export-contract.js'
type Version=ExportSummary&{status:string;versionNumber:number;projectName?:string}
type Use=ExportUse&{status:string}
interface Page<T> {items:T[];total:number;nextOffset:number|null;issues:{message:string}[];issuesOmitted?:number}
interface Port {exports(request:unknown):Promise<unknown>}
const labels:Record<ExportUse['role'],string>={'main-video':'主画面视频','main-image':'主画面图片','source-audio':'视频原声',narration:'旁白','visual-layer':'画面图层','audio-layer':'音频轨道','card-image':'卡片图片'}
const status=(value:string)=>({available:'当前文件指纹一致',changed:'当前文件已变化',missing:'文件缺失',unavailable:'当前文件不可核对','legacy-unknown':'旧导出，采用详情未知'}[value]??value)
const text=(tag:string,value:string)=>{const el=document.createElement(tag);el.textContent=value;return el}
const range=(r:{startSeconds:number;endSeconds:number})=>`${r.startSeconds.toFixed(3)}–${r.endSeconds.toFixed(3)} 秒`
export class ExportPanel {
 constructor(private api:Port,private run:(operation:()=>Promise<unknown>)=>void,private open:(identity:LibraryIdentity)=>Promise<void>){}
 private button(label:string,operation:()=>Promise<unknown>){const b=document.createElement('button');b.textContent=label;b.onclick=()=>this.run(operation);return b}
 async material(entry:LibraryEntry,root:HTMLElement,current:()=>boolean):Promise<void>{
  const identity:LibraryIdentity=entry.artifactId?{projectId:entry.projectId,artifactId:entry.artifactId}:{projectId:entry.projectId,sourceId:entry.sourceId!,acquisitionId:entry.acquisitionId!},section=document.createElement('section');section.className='material-research export-provenance';section.append(text('h3','导出版本与实际采用'),text('p','采用来自导出时启用的合成输入；源区间使用素材文件时钟，区别于参考、计划使用与人工验收。'))
  const versions=document.createElement('div'),adoptions=document.createElement('div');section.append(versions,adoptions);root.append(section)
  const showUses=async(version:Version,offset=0)=>{const page=await this.api.exports({operation:'uses',projectId:version.projectId,exportId:version.id,offset,limit:20}) as Page<Use>&{known:boolean;reason?:string;export:Version};if(!current())return
   let details=section.querySelector<HTMLElement>('[data-export-uses]');if(!details){details=document.createElement('div');details.dataset.exportUses='true';section.append(details)}details.replaceChildren(text('h4',version.title+' · '+new Date(version.createdAt).toLocaleString()),text('p',status(page.export.status)));if(!page.known)details.append(text('p',page.reason??'旧版本采用未知。'))
   for(const use of page.items){const row=document.createElement('div');row.className='export-use';row.append(text('strong',labels[use.role]+' · '+use.artifactId),text('p',`成品 ${range(use.outputRange)} · ${use.sourceRange?'素材 '+range(use.sourceRange)+' · '+use.playbackRate+' 倍速':'静态图片'} · ${status(use.status)}`));if(use.holdFromOutputSeconds!==null)row.append(text('p','从成品 '+use.holdFromOutputSeconds.toFixed(3)+' 秒起停留末帧。'));if(use.sources.length)row.append(text('p','关联 '+use.sources.length+' 份原始获取记录；采集范围不等于精确原片映射。'));row.append(this.button('查看这份素材',()=>this.open({projectId:version.projectId,artifactId:use.artifactId})));details.append(row)}
   details.append(text('p',`共 ${page.total} 个采用区间`));if(offset)details.append(this.button('上一页采用',()=>showUses(version,Math.max(0,offset-20))));if(page.nextOffset!==null)details.append(this.button('下一页采用',()=>showUses(version,page.nextOffset!)));if(page.issuesOmitted)details.append(text('p',`另有 ${page.issuesOmitted} 项问题未展开，结果可能不完整。`));for(const issue of page.issues)details.append(text('p',issue.message))
  }
  const showVersions=async(offset=0)=>{if(!entry.artifactId)return;const page=await this.api.exports({operation:'versions',projectId:entry.projectId,artifactId:entry.artifactId,offset,limit:20}) as Page<Version>;if(!current())return;versions.replaceChildren();if(!page.total)return
   versions.append(text('h4',`此作品的 ${page.total} 个导出版本`));for(const version of page.items){const row=document.createElement('div');row.className='export-version';row.append(text('p',`版本 ${version.versionNumber} · ${new Date(version.createdAt).toLocaleString()} · ${status(version.status)}`),this.button('查看采用素材与区间',()=>showUses(version)),this.button('查看此版本文件',()=>this.open({projectId:version.projectId,artifactId:version.artifactId})));versions.append(row)}if(offset)versions.append(this.button('上一页版本',()=>showVersions(Math.max(0,offset-20))));if(page.nextOffset!==null)versions.append(this.button('下一页版本',()=>showVersions(page.nextOffset!)));if(page.issuesOmitted)versions.append(text('p',`另有 ${page.issuesOmitted} 项问题未展开，结果可能不完整。`));for(const issue of page.issues)versions.append(text('p',issue.message))
  }
  const showAdoptions=async(offset=0)=>{const page=await this.api.exports({operation:'adoptions',identity,includeArchived:true,offset,limit:20}) as Page<{export:Version;useCount:number;uses:Use[];usesNextOffset:number|null}>;if(!current())return;adoptions.replaceChildren(text('h4','被哪些成品采用'))
   if(!page.total)adoptions.append(text('p','没有已记录的实际采用；旧成品的采用可能未知。'))
   for(const item of page.items){const row=document.createElement('div');row.className='export-adoption';row.append(text('strong',item.export.title),text('p',(item.export.projectName??'')+' · '+new Date(item.export.createdAt).toLocaleString()+' · '+status(item.export.status)));for(const use of item.uses)row.append(text('p',`${labels[use.role]} · 成品 ${range(use.outputRange)}${use.sourceRange?' · 素材 '+range(use.sourceRange):''}`));row.append(this.button('查看此成品',()=>this.open({projectId:item.export.projectId,artifactId:item.export.artifactId})),this.button('查看完整采用区间',()=>showUses(item.export)));adoptions.append(row)}if(offset)adoptions.append(this.button('上一页成品',()=>showAdoptions(Math.max(0,offset-20))));if(page.nextOffset!==null)adoptions.append(this.button('下一页成品',()=>showAdoptions(page.nextOffset!)));if(page.issuesOmitted)adoptions.append(text('p',`另有 ${page.issuesOmitted} 项问题未展开，结果可能不完整。`));for(const issue of page.issues)adoptions.append(text('p',issue.message))
  }
  await showVersions();if(current())await showAdoptions()
 }
}
