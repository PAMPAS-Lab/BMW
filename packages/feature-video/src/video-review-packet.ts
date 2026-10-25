import {speechScene} from './studio-speech-contract.js'
import {estimatedCaptionCues} from '../../media-native/src/composition-contract.js'
import crypto from 'node:crypto'
import {sceneVisuals} from '../../media-native/src/visual-segments.js'
import type {SourceCitation} from '../../media-native/src/source-contract.js'
import type {VideoDraft} from './studio-contract.js'
export interface ReviewCitationProof {url:string;title:string;author:string|null;publishedAt:string|null;capturedAt:string;contentId:string|null}
const excerpt=(text:string,limit:number)=>({text:text.slice(0,limit),truncated:text.length>limit})
/** Bounded editorial data, not semantic approval. Export images and original
 * audio remain independently inspected by the official runtime. */
export async function videoReviewPacket(draft:VideoDraft,fingerprint:string,resolve:(citation:SourceCitation)=>Promise<ReviewCitationProof>,guard:()=>void){
 let offset=0
 const scenes:Record<string,unknown>[]=[],omissions:{sceneId:string;section:string}[]=[]
 for(const scene of draft.scenes.slice(0,8)){
  guard();const citations:Record<string,unknown>[]=[]
  for(const citation of (scene.citations??[]).slice(0,2)){
   const quote=excerpt(citation.quote,600),coordinates={kind:citation.kind,claim:excerpt(citation.claim,400),conflict:citation.conflict,eventAt:citation.eventAt,sourceId:citation.sourceId,acquisitionId:citation.acquisitionId,startCharacter:citation.startCharacter,endCharacter:citation.endCharacter}
   try{const source=await resolve(citation);guard();citations.push({...coordinates,source,quoteExcerpt:quote,excerptEndCharacter:citation.startCharacter+quote.text.length,storedQuoteVerified:true})}
   catch(error){guard();citations.push({...coordinates,storedQuoteVerified:false,error:String(error instanceof Error?error.message:error).slice(0,200)})}
  }
  if((scene.citations?.length??0)>2)omissions.push({sceneId:scene.id,section:'citations'})
  let rendered=scene
  try{rendered=speechScene(scene)}catch{omissions.push({sceneId:scene.id,section:'speech'})}
  const actualCaptions=rendered.captions??estimatedCaptionCues(rendered,draft.width,draft.height,rendered.audioDurationSeconds??rendered.durationSeconds-1)
  const captions=actualCaptions.slice(0,20).map(c=>({startSeconds:c.startSeconds,endSeconds:c.endSeconds,...excerpt(c.text,200),...(c.translationText?{translation:excerpt(c.translationText,200)}:{})}))
  if(actualCaptions.length>20||captions.some(c=>c.truncated||c.translation?.truncated))omissions.push({sceneId:scene.id,section:'captions'})
  const layers=[...(scene.layers??[]).filter(l=>l.kind==='text'&&!l.hidden&&(l.opacity??1)>0).map(l=>({...l,timeDomain:'scene-seconds'})),...(draft.layers??[]).filter(l=>l.kind==='text'&&!l.hidden&&(l.opacity??1)>0&&l.startSeconds<offset+scene.durationSeconds&&l.startSeconds+l.durationSeconds>offset).map(l=>({...l,timeDomain:'film-seconds'}))]
  const textLayers=layers.slice(0,12).map(l=>({text:excerpt(l.text??'',200),timeDomain:l.timeDomain,startSeconds:l.startSeconds,durationSeconds:l.durationSeconds}))
  if(layers.length>12||textLayers.some(l=>l.text.truncated))omissions.push({sceneId:scene.id,section:'textLayers'})
  if(scene.visualBrief.length>400)omissions.push({sceneId:scene.id,section:'visualBrief'})

  const narration=excerpt(scene.narration??'',1000),row:Record<string,unknown>={sceneId:scene.id,filmStartSeconds:offset,durationSeconds:scene.durationSeconds,title:scene.title,label:scene.label,visualBrief:excerpt(scene.visualBrief,400),narration,narrationAudio:{artifactId:scene.audioArtifactId??null,durationSeconds:scene.audioDurationSeconds??null,muted:scene.voiceMuted??false,volume:scene.voiceVolume??1},cardSpecPresent:Boolean(scene.cardSpec),cardSpeechPresent:Boolean(scene.cardSpec&&scene.speechLinks),captionOrigin:scene.captions?'manual':rendered.captions?'speech-derived':'estimated',sceneTemplateKind:scene.sceneTemplate?.kind??null,bullets:(scene.bullets??[]).slice(0,8).map(b=>excerpt(b,200)),captions,textLayers,visuals:sceneVisuals(scene).map(v=>({artifactId:v.videoArtifactId??v.imageArtifactId,startSeconds:v.sourceStartSeconds,durationSeconds:v.durationSeconds,playbackRate:v.playbackRate,keepSourceAudio:v.keepSourceAudio,sourceVolume:v.sourceVolume,crop:v.crop})),citations}
  if((scene.bullets?.length??0)>8||(scene.bullets??[]).some(b=>b.length>200))omissions.push({sceneId:scene.id,section:'content'})
  if(narration.truncated)omissions.push({sceneId:scene.id,section:'content'})
  scenes.push(row);offset+=scene.durationSeconds
 }
 const packet={version:1,draftId:draft.id,revision:draft.revision,title:draft.title,settings:{width:draft.width,height:draft.height,fps:draft.fps,cardLayout:draft.cardLayout},exportFingerprint:fingerprint,authority:'Host-pinned draft fields and exact saved-source quote bindings; claims still require editorial judgment',sceneCount:draft.scenes.length,scenes,omissions,omittedSceneIds:draft.scenes.slice(8,16).map(s=>s.id),omittedSceneCount:Math.max(0,draft.scenes.length-8),nextSceneOffset:draft.scenes.length>8?8:null,complete:true}
 const bytes=()=>Buffer.byteLength(JSON.stringify(packet))
 // Never silently discard content. Omitted fields tell the reviewer exactly
 // which current bounded section must be read separately.
 for(const section of ['citations','captions','textLayers','visuals','visualBrief','narration','bullets'])for(const scene of [...scenes].reverse())if(bytes()>12000&&scene[section]!==undefined){delete scene[section];omissions.push({sceneId:String(scene.sceneId),section})}
 packet.complete=omissions.length===0&&packet.omittedSceneIds.length===0
 if(bytes()>12000){for(const [index,row]of scenes.entries())scenes[index]={sceneId:row.sceneId,filmStartSeconds:row.filmStartSeconds,durationSeconds:row.durationSeconds,cardSpecPresent:row.cardSpecPresent};omissions.splice(0,omissions.length,...scenes.map(row=>({sceneId:String(row.sceneId),section:'all-nonidentity-data'})));packet.complete=false}
 if(bytes()>12000)throw new Error('VIDEO_REVIEW_PACKET_BUDGET: Identity snapshot exceeds 12 KiB.')
 guard();const json=JSON.stringify(packet)
 return {packet,sha256:crypto.createHash('sha256').update(json).digest('hex'),json}
}
