import {assertArtifactId,finiteNumber,mediaRecord} from './media-contract.js'
import {assertVisualEffects,visualEffectsSchema} from './visual-effects.js'
import type {VisualEffects} from './visual-effects.js'
/** Original elapsed fade clock; no arbitrary curves or executable fields. */
export interface LayerFadeWindow {originId:string;startSeconds:number;durationSeconds:number}
export interface LayerFadeClock {durationSeconds:number;fadeInSeconds:number;fadeOutSeconds:number;fadeWindow?:LayerFadeWindow}
export interface LayerFrame {timeSeconds:number;x:number;y:number;width:number;height:number;opacity:number;easing:'linear'|'ease-in-out';easingRange?:[number,number]}
export interface VisualLayer {effects?:VisualEffects;id:string;title:string;kind:'text'|'rectangle'|'image'|'video';startSeconds:number;durationSeconds:number;x:number;y:number;width:number;height:number;opacity:number;zIndex:number;hidden:boolean;locked:boolean;color:string;text?:string;fontSize?:number;artifactId?:string;sourceStartSeconds?:number;playbackRate?:number;fadeInSeconds:number;fadeOutSeconds:number;fadeWindow?:LayerFadeWindow;keyframes?:LayerFrame[]}
export interface AudioLayer {id:string;title:string;artifactId:string;startSeconds:number;durationSeconds:number;sourceStartSeconds:number;playbackRate:number;volume:number;muted:boolean;locked:boolean;fadeInSeconds:number;fadeOutSeconds:number;fadeWindow?:LayerFadeWindow;ducking:boolean}
export interface LayerContainer {layers?:VisualLayer[];audioTracks?:AudioLayer[]}
export const layerId=(raw:unknown):string=>{if(typeof raw!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(raw))throw new TypeError('Invalid layer ID.');return raw}
const closed=(value:Record<string,unknown>,allowed:string[])=>{if(Object.keys(value).some(key=>!allowed.includes(key)))throw new TypeError('Unsupported layer field.')}
const text=(v:unknown,max:number)=>{if(typeof v!=='string'||v.length>max||/[\u0000-\u0008]/.test(v))throw new TypeError('Invalid layer text.');return v}
const bool=(v:unknown,fallback=false)=>{if(v===undefined)return fallback;if(typeof v!=='boolean')throw new TypeError('Invalid layer flag.');return v}
function box(v:Record<string,unknown>):Pick<VisualLayer,'x'|'y'|'width'|'height'|'opacity'>{
 const r={x:finiteNumber(v.x,'layer x',0,1),y:finiteNumber(v.y,'layer y',0,1),width:finiteNumber(v.width,'layer width',.02,1),height:finiteNumber(v.height,'layer height',.02,1),opacity:finiteNumber(v.opacity??1,'layer opacity',0,1)}
 if(r.x+r.width>1.000001||r.y+r.height>1.000001)throw new TypeError('Layer must fit inside the output frame.');return r
}
export function assertLayerFadeWindow(raw:unknown):LayerFadeWindow {
 const v=mediaRecord(raw);closed(v,['originId','startSeconds','durationSeconds'])
 const durationSeconds=finiteNumber(v.durationSeconds,'original fade duration',.1,180),startSeconds=finiteNumber(v.startSeconds,'original fade offset',0,180)
 if(startSeconds>=durationSeconds)throw new TypeError('Fade offset must be inside the original duration.')
 return {originId:layerId(v.originId),startSeconds,durationSeconds}
}
function timing(v:Record<string,unknown>){
 const durationSeconds=finiteNumber(v.durationSeconds,'layer duration',.1,180),fadeWindow=v.fadeWindow===undefined?undefined:assertLayerFadeWindow(v.fadeWindow)
 if(fadeWindow&&fadeWindow.startSeconds+durationSeconds>fadeWindow.durationSeconds+.000001)throw new TypeError('片段超过保留的原淡入淡出时间；请先明确重设效果。')
 const fadeLimit=Math.min(2,(fadeWindow?.durationSeconds??durationSeconds)/2)
 return {id:layerId(v.id),title:text(v.title,80),startSeconds:finiteNumber(v.startSeconds,'layer start',0,180),durationSeconds,fadeInSeconds:finiteNumber(v.fadeInSeconds??0,'fade in',0,fadeLimit),fadeOutSeconds:finiteNumber(v.fadeOutSeconds??0,'fade out',0,fadeLimit),...(fadeWindow?{fadeWindow}:{})}
}
/** The same closed linear envelope drives visual opacity and streamed audio gain. */
export function layerFadeGain(layer:LayerFadeClock,local:number):number {
 if(!Number.isFinite(local))throw new TypeError('Invalid fade time.')
 const time=(layer.fadeWindow?.startSeconds??0)+local,duration=layer.fadeWindow?.durationSeconds??layer.durationSeconds
 return Math.max(0,Math.min(1,layer.fadeInSeconds?time/layer.fadeInSeconds:1,layer.fadeOutSeconds?(duration-time)/layer.fadeOutSeconds:1))
}
export function assertVisualLayers(raw:unknown):VisualLayer[]{
 if(!Array.isArray(raw)||raw.length>8)throw new TypeError('At most eight visual layers per time container.')
 const result=raw.map(raw=>{const v=mediaRecord(raw);closed(v,['id','title','kind','startSeconds','durationSeconds','x','y','width','height','opacity','zIndex','hidden','locked','color','text','fontSize','artifactId','sourceStartSeconds','playbackRate','fadeInSeconds','fadeOutSeconds','fadeWindow','keyframes','effects'])
 if(typeof v.kind!=='string'||!['text','rectangle','image','video'].includes(v.kind))throw new TypeError('Unsupported visual layer.')
 if(typeof v.color!=='string'||!/^#[a-fA-F0-9]{6}$/.test(v.color))throw new TypeError('Layer color requires opaque hex.')
 const r:VisualLayer={...timing(v),...box(v),kind:v.kind as VisualLayer['kind'],color:v.color,zIndex:finiteNumber(v.zIndex??0,'layer order',0,31,true),hidden:bool(v.hidden),locked:bool(v.locked)}
 if(v.effects!==undefined)r.effects=assertVisualEffects(v.effects)
 if(r.kind==='text'){r.text=text(v.text,200);r.fontSize=finiteNumber(v.fontSize??32,'layer font size',12,96)}else if(v.text!==undefined||v.fontSize!==undefined)throw new TypeError('Text fields require a text layer.')
 if(r.kind==='image'||r.kind==='video')r.artifactId=assertArtifactId(v.artifactId);else if(v.artifactId!==undefined)throw new TypeError('Only media layers reference artifacts.')
 if(r.kind==='video'){r.sourceStartSeconds=finiteNumber(v.sourceStartSeconds??0,'layer source start',0,1800);r.playbackRate=finiteNumber(v.playbackRate??1,'layer speed',.25,2)}else if(v.sourceStartSeconds!==undefined||v.playbackRate!==undefined)throw new TypeError('Source time fields require video.')
 if(v.keyframes!==undefined){if(!Array.isArray(v.keyframes)||v.keyframes.length<2||v.keyframes.length>12)throw new TypeError('Explicit animation requires two to twelve keyframes.');r.keyframes=v.keyframes.map(raw=>{const f=mediaRecord(raw);closed(f,['timeSeconds','x','y','width','height','opacity','easing','easingRange']);if(typeof f.easing!=='string'||!['linear','ease-in-out'].includes(f.easing))throw new TypeError('Unknown animation easing.');const frame:LayerFrame={timeSeconds:finiteNumber(f.timeSeconds,'keyframe time',0,r.durationSeconds),...box(f),easing:f.easing as LayerFrame['easing']};if(f.easingRange!==undefined){if(frame.easing!=='ease-in-out'||!Array.isArray(f.easingRange)||f.easingRange.length!==2)throw new TypeError('Easing range requires two bounded endpoints and ease-in-out.');const start=finiteNumber(f.easingRange[0],'easing range start',0,1),end=finiteNumber(f.easingRange[1],'easing range end',0,1);if(start>=end)throw new TypeError('Easing range must increase.');frame.easingRange=[start,end]}return frame});if(r.keyframes.some((f,i)=>i>0&&f.timeSeconds<=r.keyframes![i-1].timeSeconds))throw new TypeError('Keyframes must have increasing times.')}
 return r});unique(result);return result
}
export function assertAudioLayers(raw:unknown):AudioLayer[]{
 if(!Array.isArray(raw)||raw.length>8)throw new TypeError('At most eight audio layers per time container.')
 const result=raw.map(raw=>{const v=mediaRecord(raw);closed(v,['id','title','artifactId','startSeconds','durationSeconds','sourceStartSeconds','playbackRate','volume','muted','locked','fadeInSeconds','fadeOutSeconds','fadeWindow','ducking']);return {...timing(v),artifactId:assertArtifactId(v.artifactId),sourceStartSeconds:finiteNumber(v.sourceStartSeconds??0,'audio source start',0,1800),playbackRate:finiteNumber(v.playbackRate??1,'audio rate',.25,2),volume:finiteNumber(v.volume??1,'audio volume',0,2),muted:bool(v.muted),locked:bool(v.locked),ducking:bool(v.ducking)}});unique(result);return result
}
function unique(values:{id:string}[]):void{if(new Set(values.map(v=>v.id)).size!==values.length)throw new TypeError('Duplicate layer identity.')}
export function layerAssets(container:LayerContainer):string[]{return [...(container.layers??[]).flatMap(l=>l.artifactId?[l.artifactId]:[]),...(container.audioTracks??[]).map(l=>l.artifactId)]}
export function layerProblems(container:LayerContainer,duration:number):string[]{return [...(container.layers??[]),...(container.audioTracks??[])].filter(l=>l.startSeconds+l.durationSeconds>duration+.00001).map(l=>`${l.title}：对象超过所属时间范围，请调整原有时间。`)}
export function assertLayerIdentities(value:LayerContainer&{scenes:LayerContainer[]}):void{
 const all=[...(value.layers??[]),...(value.audioTracks??[]),...value.scenes.flatMap(s=>[...(s.layers??[]),...(s.audioTracks??[])])];unique(all);if(all.length>64)throw new TypeError('At most sixty-four independent objects per composition.')
}
export function assertLayerComposition(value:LayerContainer&{scenes:(LayerContainer&{durationSeconds:number})[]}):void{
 assertLayerIdentities(value)
 const windows:{start:number;end:number}[]=[];let offset=0
 for(const scene of value.scenes){for(const layer of scene.layers??[])if(layer.kind==='video'&&!layer.hidden)windows.push({start:offset+layer.startSeconds,end:offset+layer.startSeconds+layer.durationSeconds});offset+=scene.durationSeconds}
 for(const layer of value.layers??[])if(layer.kind==='video'&&!layer.hidden)windows.push({start:layer.startSeconds,end:layer.startSeconds+layer.durationSeconds})
 const events=windows.flatMap(window=>[{time:window.start,change:1},{time:window.end,change:-1}]).sort((a,b)=>a.time-b.time||a.change-b.change);let active=0
 for(const event of events){active+=event.change;if(active>4)throw new TypeError('At most four simultaneous video overlay decoders.')}
 const errors=[...layerProblems(value,value.scenes.reduce((n,s)=>n+s.durationSeconds,0)),...value.scenes.flatMap(s=>layerProblems(s,s.durationSeconds))];if(errors.length)throw new Error(errors.join('\n'))
}
/** Normalize a restricted smoothstep without subtracting nearly equal cubic values. */
function easingFraction(frame:LayerFrame,t:number):number{
 if(frame.easing==='linear')return t
 const [start,end]=frame.easingRange??[0,1],span=end-start,step=span*t,base=6*start*(1-start)
 return t*(base+3*step*(1-2*start)-2*step*step)/(base+3*span*(1-2*start)-2*span*span)
}
export function visualLayerBox(layer:VisualLayer,local:number):Pick<VisualLayer,'x'|'y'|'width'|'height'|'opacity'>{
 let r={x:layer.x,y:layer.y,width:layer.width,height:layer.height,opacity:layer.opacity};const frames=layer.keyframes
 if(frames?.length){const next=frames.findIndex(f=>f.timeSeconds>local);if(next===0)r={...frames[0]};else if(next<0)r={...frames.at(-1)!};else{const a=frames[next-1],b=frames[next];let t=(local-a.timeSeconds)/(b.timeSeconds-a.timeSeconds);t=easingFraction(b,t);r={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,width:a.width+(b.width-a.width)*t,height:a.height+(b.height-a.height)*t,opacity:a.opacity+(b.opacity-a.opacity)*t}}}
 r.opacity*=layerFadeGain(layer,local);return {x:r.x,y:r.y,width:r.width,height:r.height,opacity:r.opacity}
}
export function activeVisualLayers(global:LayerContainer,scene:LayerContainer,time:number,local:number):{layer:VisualLayer;local:number}[]{return [...(scene.layers??[]).map(layer=>({layer,local:local-layer.startSeconds})),...(global.layers??[]).map(layer=>({layer,local:time-layer.startSeconds}))].filter(item=>!item.layer.hidden&&item.local>=0&&item.local<item.layer.durationSeconds).sort((a,b)=>a.layer.zIndex-b.layer.zIndex)}
export const layerFadeWindowSchema={type:'object',additionalProperties:false,required:['originId','startSeconds','durationSeconds'],properties:{originId:{type:'string',pattern:'^[a-zA-Z0-9-]{1,80}$'},startSeconds:{type:'number',minimum:0,maximum:180},durationSeconds:{type:'number',minimum:.1,maximum:180}}}
const number={type:'number'},boolean={type:'boolean'},string={type:'string'},id={type:'string',pattern:'^[a-zA-Z0-9-]{1,80}$'},color={type:'string',pattern:'^#[a-fA-F0-9]{6}$'},base={id,title:{type:'string',maxLength:80},startSeconds:number,durationSeconds:number,fadeInSeconds:number,fadeOutSeconds:number,fadeWindow:layerFadeWindowSchema}
export const visualLayersSchema={type:'array',maxItems:8,items:{type:'object',additionalProperties:false,required:['id','title','kind','startSeconds','durationSeconds','x','y','width','height','color'],properties:{...base,effects:visualEffectsSchema,kind:{enum:['text','rectangle','image','video']},x:number,y:number,width:number,height:number,opacity:number,zIndex:{type:'integer'},hidden:boolean,locked:boolean,color,text:{type:'string',maxLength:200},fontSize:number,artifactId:string,sourceStartSeconds:number,playbackRate:number,keyframes:{type:'array',minItems:2,maxItems:12,items:{type:'object',additionalProperties:false,required:['timeSeconds','x','y','width','height','opacity','easing'],properties:{timeSeconds:number,x:number,y:number,width:number,height:number,opacity:number,easing:{enum:['linear','ease-in-out']},easingRange:{type:'array',minItems:2,maxItems:2,items:{type:'number',minimum:0,maximum:1}}}}}}}}
export const audioLayersSchema={type:'array',maxItems:8,items:{type:'object',additionalProperties:false,required:['id','title','artifactId','startSeconds','durationSeconds'],properties:{...base,artifactId:string,sourceStartSeconds:number,playbackRate:number,volume:number,muted:boolean,locked:boolean,ducking:boolean}}}
