import {assertComposition,compositionAssets} from '../../media-native/src/composition-contract.js'
import {scienceState} from '../../media-native/src/science-spec.js'
import {productionHash} from './production-impact.js'
import {preparationHash,preparationId} from './news-preparation-contract.js'
import {assertArtifactId,finiteNumber,mediaRecord} from '../../media-native/src/media-contract.js'
import {STUDIO_EXPORT_RENDERER_VERSION} from './studio-store.js'
import type {VideoDraft,StudioScene} from './studio-contract.js'
export interface DiagramEvidence {id:string;sceneId:string;visualHash:string;rendererVersion:string;draftRevision:number;frames:{artifactId:string;sha256:string;seconds:number;width:number;height:number}[]}
export function assertDiagramEvidence(raw:unknown):DiagramEvidence{
 const e=mediaRecord(raw);if(Object.keys(e).some(k=>!['id','sceneId','visualHash','rendererVersion','draftRevision','frames'].includes(k))||(typeof e.rendererVersion!=='string'||e.rendererVersion.length>120)||!Array.isArray(e.frames)||e.frames.length!==3)throw new Error('Invalid native diagram evidence.')
 return {id:preparationId(e.id),sceneId:preparationId(e.sceneId),visualHash:preparationHash(e.visualHash),rendererVersion:e.rendererVersion,draftRevision:finiteNumber(e.draftRevision,'diagram draft revision',1,1000000,true),frames:e.frames.map(raw=>{const f=mediaRecord(raw);if(Object.keys(f).some(k=>!['artifactId','sha256','seconds','width','height'].includes(k)))throw new Error('Invalid diagram PNG.');return {artifactId:assertArtifactId(f.artifactId),sha256:preparationHash(f.sha256),seconds:finiteNumber(f.seconds,'diagram frame time',0,10),width:finiteNumber(f.width,'diagram width',320,1280,true),height:finiteNumber(f.height,'diagram height',180,1280,true)}})}
}
/** Pure capability check. Excludes general HTML, assets, decorative-only motion
 * and text-only event changes. No semantic truth or permission is inferred. */
export function diagramPreparationPlan(draft:VideoDraft,scene:StudioScene){
 if(scene!==draft.scenes.at(-1)||scene.durationSeconds<1||scene.durationSeconds>10||(draft.layers?.length??0)>0)throw new Error('DIAGRAM_SCOPE: Only one final scene of 1–10 seconds, without film layers, is supported.')
 const layers=(scene.layers??[]).filter(l=>!l.hidden&&l.opacity>0),diagrams=layers.filter(l=>l.kind==='diagram'&&l.science&&l.startSeconds===0&&l.durationSeconds>=scene.durationSeconds&&l.width*l.height>=.2)
 if(diagrams.length!==1||layers.some(l=>!['diagram','rectangle','text'].includes(l.kind))||!scene.label?.includes('机制图解'))throw new Error('DIAGRAM_SCOPE: One visible native diagram and a continuous 机制图解 label are required.')
 const spec=diagrams[0].science!,times=[0,scene.durationSeconds*.5,scene.durationSeconds-1/draft.fps]
 const states=times.map(t=>scienceState(spec,t));const facts=states.map(s=>s.kind==='events'?s.elements.filter(e=>e.kind!=='group').map(e=>({id:e.id,active:e.active,value:e.value,highlightLine:e.highlightLine})):s.kind==='measurement'?s.series:s)
 if(spec.kind==='measurement'||new Set(facts.map(s=>productionHash(s))).size<2)throw new Error('DIAGRAM_STATIC: Actual data/path/object state must progress within this scene; changed text or decoration alone is insufficient.')
 const {id:_id,visualBrief:_brief,sources:_sources,citations:_citations,endPolicy:_end,narrationOptions:_options,audioArtifactId:_audio,audioText:_audioText,audioDurationSeconds:_duration,sourceDurationSeconds:_sourceDuration,audioGeneration:_generation,speechCandidate:_candidate,speechAnchors:_anchors,speechCaptions:_speechCaptions,speechLinks:_links,sourceSpeech:_sourceSpeech,sourceCaptionBinding:_binding,speechPlaybackOrigin:_origin,voiceTiming:_timing,voiceSegments:_segments,...visual}=scene
 const composition=assertComposition({title:draft.title,width:draft.width,height:draft.height,fps:draft.fps,style:draft.style,watermark:draft.watermark,cardLayout:draft.cardLayout,music:false,scenes:[{...visual,narration:'',captions:[],audioTracks:[]}]})
 if(compositionAssets(composition).length)throw new Error('DIAGRAM_SCOPE: Native diagrams cannot claim source video or image provenance.')
 const visualHash=productionHash({rendererVersion:STUDIO_EXPORT_RENDERER_VERSION,composition,citations:scene.citations,sceneId:scene.id})
 return {composition,visualHash}
}
